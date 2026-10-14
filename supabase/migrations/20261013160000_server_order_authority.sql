-- Route public checkout through the trusted server runtime. Anonymous and regular
-- authenticated clients must not be able to bypass catalog/delivery recalculation.
revoke insert on table public.orders from public, anon, authenticated;
drop policy if exists "anyone can place order" on public.orders;
revoke usage, select on sequence public.orders_order_number_seq from public, anon, authenticated;
grant insert on table public.orders to service_role;
grant usage, select on sequence public.orders_order_number_seq to service_role;

alter table public.orders
  add column if not exists items_subtotal numeric(14, 2),
  add column if not exists total_amount numeric(14, 2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_amounts_consistent_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_amounts_consistent_check
      check (
        (items_subtotal is null and total_amount is null)
        or (
          items_subtotal is not null and items_subtotal >= 0
          and total_amount is not null and total_amount >= 0
          and total_amount = items_subtotal + coalesce(delivery_fee, 0)
        )
      );
  end if;
end;
$$;

comment on column public.orders.items_subtotal is
  'Catalog-authoritative sum of line unit prices (including selected priced extras) times quantity; NULL on legacy rows.';
comment on column public.orders.total_amount is
  'Server-calculated order total including the server-verified delivery fee; NULL on legacy rows.';

create or replace function public.validate_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  menu_items jsonb;
  order_line jsonb;
  normalized_items jsonb := '[]'::jsonb;
  line_name text;
  line_qty numeric;
  catalog_price numeric;
  product jsonb;
  line_extras jsonb;
  line_extra jsonb;
  configured_extra jsonb;
  extra_label text;
  extra_price numeric;
  extras_total numeric;
  line_salsa text;
  sauce_options jsonb;
  promo_days jsonb;
  line_unit_price numeric;
  items_subtotal numeric := 0;
  extra_count integer;
  unique_extra_count integer;
begin
  if new.status <> 'nuevo'::public.order_status then
    raise exception 'new orders must start in nuevo status' using errcode = '23514';
  end if;

  if new.customer_name is null or length(trim(new.customer_name)) not between 1 and 100 then
    raise exception 'invalid customer name' using errcode = '23514';
  end if;
  if new.phone is null or length(trim(new.phone)) not between 6 and 30
     or length(regexp_replace(new.phone, '[^0-9]', '', 'g')) < 8 then
    raise exception 'invalid phone' using errcode = '23514';
  end if;
  if new.payment not in ('Efectivo', 'Tarjeta', 'Mercado Pago', 'Transferencia') then
    raise exception 'invalid payment method' using errcode = '23514';
  end if;
  if new.notes is not null and length(new.notes) > 500 then
    raise exception 'invalid order notes' using errcode = '23514';
  end if;

  if new.delivery_type = 'delivery' then
    if new.address is null or length(trim(new.address)) not between 4 and 200
       or new.zone is null
       or new.zone not in ('Ituzaingó', 'Castelar', 'Padua', 'Udaondo', 'Villa Tesei') then
      raise exception 'invalid delivery address or zone' using errcode = '23514';
    end if;
    if new.delivery_distance_meters is null or new.delivery_fee is null then
      raise exception 'delivery quote must be recalculated on the server' using errcode = '23514';
    end if;
  elsif new.delivery_type = 'retiro' then
    if new.address is not null or new.zone is not null
       or new.delivery_distance_meters is not null or new.delivery_fee is not null then
      raise exception 'pickup orders cannot include delivery fields' using errcode = '23514';
    end if;
  else
    raise exception 'invalid delivery type' using errcode = '23514';
  end if;

  if jsonb_typeof(new.items) is distinct from 'array'
     or jsonb_array_length(new.items) not between 1 and 50 then
    raise exception 'invalid order items' using errcode = '23514';
  end if;

  -- Never fall back to client prices when the published catalog is absent.
  select menu.items into menu_items
  from public.menu_content as menu
  where menu.id = 1;
  if not found or jsonb_typeof(menu_items) is distinct from 'array' then
    raise exception 'published catalog is required to accept orders' using errcode = '23514';
  end if;

  for order_line in select value from jsonb_array_elements(new.items) loop
    if jsonb_typeof(order_line) is distinct from 'object' then
      raise exception 'each order item must be an object' using errcode = '23514';
    end if;
    line_name := order_line->>'name';
    if line_name is null or length(trim(line_name)) not between 1 and 200 then
      raise exception 'invalid order item name' using errcode = '23514';
    end if;
    if jsonb_typeof(order_line->'qty') is distinct from 'number' then
      raise exception 'invalid order item quantity' using errcode = '23514';
    end if;
    line_qty := (order_line->>'qty')::numeric;
    if line_qty <> trunc(line_qty) or line_qty not between 1 and 50 then
      raise exception 'invalid order item quantity' using errcode = '23514';
    end if;

    product := null;
    catalog_price := null;
    select candidate.price, candidate.product
      into catalog_price, product
    from (
      select coalesce(
               nullif(variant->>'price', '')::numeric,
               nullif(menu_item->>'price', '')::numeric
             ) as price,
             menu_item as product
      from jsonb_array_elements(menu_items) as products(menu_item)
      cross join lateral jsonb_array_elements(
        coalesce(menu_item->'variants', '[]'::jsonb)
      ) as variants(variant)
      where variant->>'name' = line_name
      union all
      select nullif(menu_item->>'price', '')::numeric as price,
             menu_item as product
      from jsonb_array_elements(menu_items) as products(menu_item)
      where menu_item->>'name' = line_name
    ) as candidate
    where candidate.price is not null
    limit 1;

    if not found or catalog_price is null or catalog_price < 0 or catalog_price > 100000000 then
      raise exception 'order item is not priced in the published catalog' using errcode = '23514';
    end if;
    if coalesce((product->>'enabled')::boolean, true) is false then
      raise exception 'order item is disabled' using errcode = '23514';
    end if;

    if product->>'category' = 'promos' then
      promo_days := product->'promoDays';
      if jsonb_typeof(promo_days) is distinct from 'array'
         or not promo_days @> jsonb_build_array(
           extract(dow from (now() at time zone 'America/Argentina/Buenos_Aires'))::integer
         ) then
        raise exception 'promotion is not available today' using errcode = '23514';
      end if;
    end if;

    line_extras := order_line->'extras';
    if jsonb_typeof(line_extras) is distinct from 'array'
       or jsonb_array_length(line_extras) > 20 then
      raise exception 'invalid order item extras' using errcode = '23514';
    end if;
    select count(*), count(distinct value #>> '{}')
      into extra_count, unique_extra_count
    from jsonb_array_elements(line_extras);
    if extra_count <> unique_extra_count then
      raise exception 'duplicate order item extra' using errcode = '23514';
    end if;

    extras_total := 0;
    for line_extra in select value from jsonb_array_elements(line_extras) loop
      if jsonb_typeof(line_extra) is distinct from 'string' then
        raise exception 'invalid order item extra' using errcode = '23514';
      end if;
      extra_label := line_extra #>> '{}';
      if length(extra_label) not between 1 and 100 then
        raise exception 'invalid order item extra' using errcode = '23514';
      end if;
      configured_extra := null;
      select value into configured_extra
      from jsonb_array_elements(coalesce(product->'extras', '[]'::jsonb)) as extras(value)
      where value->>'label' = extra_label
      limit 1;
      if configured_extra is null then
        raise exception 'order extra is not in the catalog' using errcode = '23514';
      end if;
      if configured_extra->'price' is null or configured_extra->'price' = 'null'::jsonb then
        extra_price := 0;
      elsif jsonb_typeof(configured_extra->'price') = 'number' then
        extra_price := (configured_extra->>'price')::numeric;
      else
        raise exception 'invalid catalog extra price' using errcode = '23514';
      end if;
      if extra_price < 0 or extra_price > 100000000 then
        raise exception 'invalid catalog extra price' using errcode = '23514';
      end if;
      extras_total := extras_total + extra_price;
    end loop;

    line_salsa := null;
    if order_line->'salsa' is not null and order_line->'salsa' <> 'null'::jsonb
       and nullif(order_line->>'salsa', '') is not null then
      if jsonb_typeof(order_line->'salsa') is distinct from 'string'
         or length(order_line->>'salsa') > 100
         or coalesce((product->>'sauces')::boolean, false) is not true then
        raise exception 'invalid order item salsa' using errcode = '23514';
      end if;
      line_salsa := order_line->>'salsa';
      sauce_options := product->'sauceOptions';
      if sauce_options is null or sauce_options = 'null'::jsonb then
        sauce_options := '["Mayonesa", "Mostaza", "BBQ", "Ketchup", "Ninguna de las anteriores"]'::jsonb;
      end if;
      if jsonb_typeof(sauce_options) is distinct from 'array'
         or not sauce_options @> jsonb_build_array(line_salsa) then
        raise exception 'salsa is not in the published catalog' using errcode = '23514';
      end if;
    end if;

    line_unit_price := round(catalog_price + extras_total, 2);
    if line_unit_price < 0 or line_unit_price > 100000000 then
      raise exception 'invalid calculated unit price' using errcode = '23514';
    end if;
    items_subtotal := items_subtotal + line_unit_price * line_qty;
    if items_subtotal > 100000000000 then
      raise exception 'order total exceeds the allowed limit' using errcode = '23514';
    end if;

    -- Persist only the supported order fields and authoritative server price.
    normalized_items := normalized_items || jsonb_build_array(
      jsonb_build_object(
        'name', trim(line_name),
        'qty', line_qty,
        'unit_price', line_unit_price,
        'extras', line_extras,
        'salsa', line_salsa
      )
    );
  end loop;

  new.items := normalized_items;
  new.items_subtotal := items_subtotal;
  new.total_amount := items_subtotal + coalesce(new.delivery_fee, 0);
  return new;
end;
$$;

-- Defense in depth: even trusted server inserts are normalized and constrained by
-- the current published menu. Existing role and RLS policies remain unchanged.
drop trigger if exists validate_order_insert on public.orders;
create trigger validate_order_insert
before insert on public.orders
for each row execute function public.validate_order_insert();

notify pgrst, 'reload schema';
