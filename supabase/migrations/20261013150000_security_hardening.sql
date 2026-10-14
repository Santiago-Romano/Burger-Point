-- Security hardening for role bootstrap, owner protection and public order payloads.
-- This migration intentionally does not assign or revoke any real account.

-- Owners are configured explicitly by the deployment owner with service_role SQL.
-- Administrators can manage ordinary admin/operator accounts, but cannot demote or
-- delete a protected owner because protected owners remain administrators.
create table if not exists public.protected_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.protected_admins enable row level security;
revoke all on public.protected_admins from public, anon, authenticated;
revoke all on public.protected_admins from anon, authenticated;
grant all on public.protected_admins to service_role;

-- No public first-admin claim is allowed. The first owner must be inserted by an
-- operator with service_role access after verifying the owner's auth.users UUID:
--   insert into public.user_roles(user_id, role) values ('OWNER_UUID', 'admin');
--   insert into public.protected_admins(user_id) values ('OWNER_UUID');
create or replace function public.claim_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  if public.has_role(auth.uid(), 'admin') then
    return true;
  end if;

  if public.has_role(auth.uid(), 'operator') then
    return false;
  end if;

  insert into public.admin_access_requests (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  return false;
end;
$$;

revoke execute on function public.claim_admin() from public, anon;
grant execute on function public.claim_admin() to authenticated;

-- Validate every public insert, including direct PostgREST calls that bypass the UI.
-- Catalog price authority remains a deployment concern because the editable menu is
-- stored as JSONB; this trigger prevents malformed, negative and oversized payloads.
create or replace function public.validate_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  line jsonb;
  line_name text;
  line_qty numeric;
  line_price numeric;
  catalog_price numeric;
  line_extras jsonb;
  line_salsa jsonb;
begin
  if new.status <> 'nuevo'::public.order_status then
    raise exception 'new orders must start in nuevo status' using errcode = '23514';
  end if;

  if length(trim(new.customer_name)) not between 1 and 100 then
    raise exception 'invalid customer name' using errcode = '23514';
  end if;
  if length(trim(new.phone)) not between 6 and 30 then
    raise exception 'invalid phone' using errcode = '23514';
  end if;
  if new.delivery_type not in ('delivery', 'retiro') then
    raise exception 'invalid delivery type' using errcode = '23514';
  end if;
  if new.delivery_type = 'delivery'
     and (new.address is null or length(trim(new.address)) < 4 or new.zone is null) then
    raise exception 'delivery address is required' using errcode = '23514';
  end if;
  if new.delivery_type = 'retiro' and (new.address is not null or new.zone is not null) then
    raise exception 'pickup orders cannot include delivery fields' using errcode = '23514';
  end if;
  if jsonb_typeof(new.items) <> 'array' or jsonb_array_length(new.items) not between 1 and 50 then
    raise exception 'invalid order items' using errcode = '23514';
  end if;

  for line in select value from jsonb_array_elements(new.items) loop
    if jsonb_typeof(line) <> 'object' then
      raise exception 'each order item must be an object' using errcode = '23514';
    end if;

    line_name := line->>'name';
    if line_name is null or length(trim(line_name)) not between 1 and 200 then
      raise exception 'invalid order item name' using errcode = '23514';
    end if;

    -- When the editable catalog has been persisted, it is the server-side price
    -- authority. Fresh installations may not have a menu row yet, so the shape
    -- checks below still protect intake while the panel is being initialized.
    if exists (select 1 from public.menu_content where id = 1) then
      select catalog.price into catalog_price
      from (
        select (item->>'name') as name, nullif(item->>'price', '')::numeric as price
        from public.menu_content as menu,
             jsonb_array_elements(menu.items) as item
        where menu.id = 1
        union all
        select (variant->>'name') as name, nullif(variant->>'price', '')::numeric as price
        from public.menu_content as menu,
             jsonb_array_elements(menu.items) as item,
             jsonb_array_elements(coalesce(item->'variants', '[]'::jsonb)) as variant
        where menu.id = 1
      ) as catalog
      where catalog.name = line_name
      limit 1;

      if not found or catalog_price is null then
        raise exception 'order item is not in the published catalog' using errcode = '23514';
      end if;
    end if;

    if jsonb_typeof(line->'qty') <> 'number' then
      raise exception 'invalid order item quantity' using errcode = '23514';
    end if;
    line_qty := (line->>'qty')::numeric;
    if line_qty <> trunc(line_qty) or line_qty not between 1 and 50 then
      raise exception 'invalid order item quantity' using errcode = '23514';
    end if;

    if jsonb_typeof(line->'unit_price') not in ('number', 'null') then
      raise exception 'invalid order item price' using errcode = '23514';
    end if;
    if jsonb_typeof(line->'unit_price') = 'number' then
      line_price := (line->>'unit_price')::numeric;
      if line_price < 0 or line_price > 100000000 then
        raise exception 'invalid order item price' using errcode = '23514';
      end if;
    end if;

    line_extras := line->'extras';
    if line_extras is null or jsonb_typeof(line_extras) <> 'array'
       or jsonb_array_length(line_extras) > 20 then
      raise exception 'invalid order item extras' using errcode = '23514';
    end if;
    for line_salsa in select value from jsonb_array_elements(line_extras) loop
      if jsonb_typeof(line_salsa) <> 'string' or length(line_salsa #>> '{}') not between 1 and 100 then
        raise exception 'invalid order item extra' using errcode = '23514';
      end if;
    end loop;

    line_salsa := line->'salsa';
    if line_salsa is not null and jsonb_typeof(line_salsa) not in ('string', 'null') then
      raise exception 'invalid order item salsa' using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists validate_order_insert on public.orders;
create trigger validate_order_insert
before insert on public.orders
for each row execute function public.validate_order_insert();

-- Prevent administrators from demoting a protected owner through either admin RPC.
create or replace function public.set_user_app_role(_user_id uuid, _role public.app_role)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_is_admin boolean;
  target_is_owner boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if _user_id is null or not exists (select 1 from auth.users where id = _user_id) then
    return false;
  end if;

  lock table public.user_roles in share row exclusive mode;
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if _user_id = auth.uid() then
    raise exception 'cannot change your own role' using errcode = '22023';
  end if;

  select exists (select 1 from public.user_roles where user_id = _user_id and role = 'admin')
    into target_is_admin;
  select exists (select 1 from public.protected_admins where user_id = _user_id)
    into target_is_owner;

  if target_is_owner and _role is distinct from 'admin'::public.app_role then
    raise exception 'cannot revoke protected owner' using errcode = '42501';
  end if;
  if (_role = 'admin'::public.app_role or target_is_admin)
     and not exists (select 1 from public.protected_admins where user_id = auth.uid()) then
    raise exception 'protected owner required for admin role changes' using errcode = '42501';
  end if;
  if target_is_admin and _role is distinct from 'admin'::public.app_role
     and (select count(*) from public.user_roles where role = 'admin') <= 1 then
    raise exception 'cannot remove the last admin' using errcode = '22023';
  end if;

  delete from public.user_roles where user_id = _user_id;
  if _role is not null then
    insert into public.user_roles (user_id, role) values (_user_id, _role);
  end if;

  insert into public.admin_access_requests (user_id, status, reviewed_at, reviewed_by)
  values (_user_id, case when _role is null then 'rejected' else 'approved' end, now(), auth.uid())
  on conflict (user_id) do update
    set status = excluded.status, reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by;
  return true;
end;
$$;

revoke execute on function public.set_user_app_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_user_app_role(uuid, public.app_role) to authenticated;

create or replace function public.review_user_access_request(
  _user_id uuid,
  _approve boolean,
  _role public.app_role
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  request_status text;
  target_is_admin boolean;
  target_is_owner boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if _user_id is null or _approve is null or (_approve and _role is null) then
    return false;
  end if;

  lock table public.user_roles in share row exclusive mode;
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if _user_id = auth.uid() then
    raise exception 'cannot review your own access request' using errcode = '22023';
  end if;

  select status into request_status
  from public.admin_access_requests
  where user_id = _user_id
  for update;
  if not found or request_status <> 'pending' then
    return false;
  end if;

  select exists (select 1 from public.user_roles where user_id = _user_id and role = 'admin')
    into target_is_admin;
  select exists (select 1 from public.protected_admins where user_id = _user_id)
    into target_is_owner;
  if (_approve and _role = 'admin'::public.app_role or target_is_admin)
     and not exists (select 1 from public.protected_admins where user_id = auth.uid()) then
    raise exception 'protected owner required for admin role changes' using errcode = '42501';
  end if;
  if target_is_owner and _role is distinct from 'admin'::public.app_role then
    raise exception 'cannot revoke protected owner' using errcode = '42501';
  end if;
  if target_is_admin and _role is distinct from 'admin'::public.app_role
     and (select count(*) from public.user_roles where role = 'admin') <= 1 then
    raise exception 'cannot remove the last admin' using errcode = '22023';
  end if;

  if _approve then
    delete from public.user_roles where user_id = _user_id;
    insert into public.user_roles (user_id, role) values (_user_id, _role);
  end if;

  update public.admin_access_requests
  set status = case when _approve then 'approved' else 'rejected' end,
      reviewed_at = now(), reviewed_by = auth.uid()
  where user_id = _user_id;
  return true;
end;
$$;

revoke execute on function public.review_user_access_request(uuid, boolean, public.app_role)
  from public, anon;
grant execute on function public.review_user_access_request(uuid, boolean, public.app_role)
  to authenticated;

-- Retire the legacy boolean admin RPC from the earlier migration. It is not used
-- by the current panel and otherwise would provide a parallel path that does not
-- know about protected_admins.
revoke execute on function public.set_admin_user_access(uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.review_admin_access_request(uuid, boolean)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
