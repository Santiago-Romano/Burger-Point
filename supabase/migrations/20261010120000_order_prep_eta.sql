alter table public.orders
  add column if not exists prep_eta_minutes integer;

alter table public.orders
  drop constraint if exists orders_prep_eta_minutes_check;

alter table public.orders
  add constraint orders_prep_eta_minutes_check
  check (prep_eta_minutes is null or prep_eta_minutes in (20, 30, 40));

create or replace function public.get_order_tracking(_client_order_id uuid)
returns table (order_number integer, status public.order_status, prep_eta_minutes integer)
language sql
stable
security definer
set search_path = public
as $$
  select orders.order_number::integer, orders.status, orders.prep_eta_minutes
  from public.orders
  where orders.client_order_id = _client_order_id
  limit 1;
$$;

revoke execute on function public.get_order_tracking(uuid) from public;
grant execute on function public.get_order_tracking(uuid) to anon, authenticated;
