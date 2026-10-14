-- Run only against a disposable local/staging Supabase database as a role allowed
-- to SET ROLE. The transaction rolls back all test rows and menu mutations.
begin;

insert into public.menu_content(id, items) values (
  1,
  '[{"name":"Burger de prueba","price":1000,"enabled":true,"category":"burgers","extras":[{"label":"Queso","price":250}],"sauces":true,"sauceOptions":["BBQ"]}]'::jsonb
)
on conflict (id) do update set items = excluded.items;

-- Anonymous/authenticated public clients must not have table-level INSERT rights.
set role anon;
do $$
begin
  begin
    insert into public.orders(client_order_id, customer_name, phone, delivery_type, items, payment)
    values ('11111111-1111-4111-8111-111111111111', 'Cliente', '11111111', 'retiro', '[]', 'Efectivo');
    raise exception 'FAIL: anon can insert into orders';
  exception when insufficient_privilege then
    raise notice 'PASS: anon insert rejected';
  end;
end;
$$;
reset role;

set role authenticated;
do $$
begin
  begin
    insert into public.orders(client_order_id, customer_name, phone, delivery_type, items, payment)
    values ('11111111-1111-4111-8111-111111111112', 'Cliente', '11111111', 'retiro', '[]', 'Efectivo');
    raise exception 'FAIL: authenticated client can insert into orders';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated insert rejected';
  end;
end;
$$;
reset role;

-- Trusted server inserts are normalized from the current catalog, not client price.
set role service_role;
insert into public.orders(client_order_id, customer_name, phone, delivery_type, items, payment)
values (
  '22222222-2222-4222-8222-222222222222', 'Cliente', '11111111', 'retiro',
  '[{"name":"Burger de prueba","qty":2,"unit_price":1,"extras":["Queso"],"salsa":"BBQ","unexpected":"discard me"}]'::jsonb,
  'Efectivo'
);
reset role;

do $$
declare actual public.orders%rowtype;
begin
  select * into actual from public.orders
  where client_order_id = '22222222-2222-4222-8222-222222222222';
  if actual.items_subtotal <> 2500 or actual.total_amount <> 2500 then
    raise exception 'FAIL: totals not recalculated';
  end if;
  if (actual.items->0->>'unit_price')::numeric <> 1250 then
    raise exception 'FAIL: line price not recalculated';
  end if;
  if actual.items->0 ? 'unexpected' then
    raise exception 'FAIL: unrecognized client field persisted';
  end if;
  raise notice 'PASS: trigger recalculated item price and total';
end;
$$;

-- Unknown products and missing catalog data fail closed.
set role service_role;
do $$
begin
  begin
    insert into public.orders(client_order_id, customer_name, phone, delivery_type, items, payment)
    values (
      '33333333-3333-4333-8333-333333333333', 'Cliente', '11111111', 'retiro',
      '[{"name":"Producto inventado","qty":1,"unit_price":1,"extras":[],"salsa":null}]'::jsonb,
      'Efectivo'
    );
    raise exception 'FAIL: unknown catalog item accepted';
  exception when check_violation then
    raise notice 'PASS: unknown catalog item rejected';
  end;
end;
$$;

reset role;
delete from public.menu_content where id = 1;
set role service_role;
do $$
begin
  begin
    insert into public.orders(client_order_id, customer_name, phone, delivery_type, items, payment)
    values (
      '44444444-4444-4444-8444-444444444444', 'Cliente', '11111111', 'retiro',
      '[{"name":"Burger de prueba","qty":1,"unit_price":1000,"extras":[],"salsa":null}]'::jsonb,
      'Efectivo'
    );
    raise exception 'FAIL: order accepted without a catalog';
  exception when check_violation then
    raise notice 'PASS: missing catalog rejected';
  end;
end;
$$;
reset role;

rollback;
