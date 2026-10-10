-- Configurable burger preparation and delivery delays, managed from the panel.

create table if not exists public.shop_settings (
  id smallint primary key default 1 check (id = 1),
  prep_minutes integer not null default 30 check (prep_minutes between 1 and 240),
  delivery_minutes integer not null default 20 check (delivery_minutes between 1 and 240),
  updated_at timestamptz not null default now()
);

insert into public.shop_settings (id) values (1)
on conflict (id) do nothing;

grant select, insert, update on public.shop_settings to authenticated;
alter table public.shop_settings enable row level security;

drop policy if exists "staff read settings" on public.shop_settings;
create policy "staff read settings" on public.shop_settings
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'));

drop policy if exists "staff insert settings" on public.shop_settings;
create policy "staff insert settings" on public.shop_settings
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'));

drop policy if exists "staff update settings" on public.shop_settings;
create policy "staff update settings" on public.shop_settings
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'));

-- Each order keeps the delay that was informed when it changed status, so later
-- changes to the settings do not alter orders that were already promised.
alter table public.orders
  add column if not exists delivery_eta_minutes integer;

alter table public.orders
  drop constraint if exists orders_prep_eta_minutes_check;

alter table public.orders
  add constraint orders_prep_eta_minutes_check
  check (prep_eta_minutes is null or prep_eta_minutes between 1 and 240);

alter table public.orders
  drop constraint if exists orders_delivery_eta_minutes_check;

alter table public.orders
  add constraint orders_delivery_eta_minutes_check
  check (delivery_eta_minutes is null or delivery_eta_minutes between 1 and 240);

-- The return type changes, so the function has to be dropped and recreated.
drop function if exists public.get_order_tracking(uuid);

create function public.get_order_tracking(_client_order_id uuid)
returns table (
  order_number integer,
  status public.order_status,
  prep_eta_minutes integer,
  delivery_eta_minutes integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    orders.order_number::integer,
    orders.status,
    orders.prep_eta_minutes,
    orders.delivery_eta_minutes
  from public.orders
  where orders.client_order_id = _client_order_id
  limit 1;
$$;

revoke execute on function public.get_order_tracking(uuid) from public;
grant execute on function public.get_order_tracking(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
