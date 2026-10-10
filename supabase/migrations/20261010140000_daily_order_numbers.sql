-- Restart visible order numbers every day in the restaurant's local timezone.
create table if not exists public.daily_order_counters (
  order_date date primary key,
  last_number integer not null check (last_number >= 0)
);

-- Renumber today's existing orders so the first day's counter starts cleanly.
with numbered as (
  select id,
    row_number() over (order by created_at, id)::integer as daily_number
  from public.orders
  where (created_at at time zone 'America/Argentina/Buenos_Aires')::date =
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
)
update public.orders as o
set order_number = numbered.daily_number
from numbered
where o.id = numbered.id;

insert into public.daily_order_counters (order_date, last_number)
values (
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  (
    select count(*)::integer from public.orders
    where (created_at at time zone 'America/Argentina/Buenos_Aires')::date =
      (now() at time zone 'America/Argentina/Buenos_Aires')::date
  )
)
on conflict (order_date) do update set last_number = excluded.last_number;

create or replace function public.assign_daily_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  local_order_date date := (new.created_at at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  insert into public.daily_order_counters (order_date, last_number)
  values (local_order_date, 1)
  on conflict (order_date) do update
  set last_number = public.daily_order_counters.last_number + 1
  returning last_number into new.order_number;

  return new;
end;
$$;

drop trigger if exists orders_assign_daily_number on public.orders;
create trigger orders_assign_daily_number
before insert on public.orders
for each row execute function public.assign_daily_order_number();

revoke all on public.daily_order_counters from public, anon, authenticated;
grant all on public.daily_order_counters to service_role;
