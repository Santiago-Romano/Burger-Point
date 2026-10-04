create type public.app_role as enum ('admin');
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- First signed-in user becomes the shop admin (only while no admin exists)
create or replace function public.claim_admin()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.user_roles where role = 'admin') then
    return public.has_role(auth.uid(), 'admin');
  end if;
  insert into public.user_roles(user_id, role) values (auth.uid(), 'admin');
  return true;
end $$;
revoke execute on function public.claim_admin() from public, anon;
grant execute on function public.claim_admin() to authenticated;

create type public.order_status as enum ('nuevo','en_cocina','enviado','entregado','cancelado');
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number serial,
  created_at timestamptz not null default now(),
  customer_name text not null,
  phone text not null,
  delivery_type text not null default 'delivery',
  address text,
  zone text,
  payment text not null,
  notes text,
  items jsonb not null,
  status public.order_status not null default 'nuevo'
);
grant insert on public.orders to anon, authenticated;
grant select, update, delete on public.orders to authenticated;
grant usage on sequence public.orders_order_number_seq to anon, authenticated;
grant all on public.orders to service_role;
alter table public.orders enable row level security;
create policy "anyone can place order" on public.orders for insert to anon, authenticated
  with check (status = 'nuevo' and length(customer_name) between 1 and 100 and length(phone) between 6 and 30 and jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50);
create policy "admin read" on public.orders for select to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "admin update" on public.orders for update to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "admin delete" on public.orders for delete to authenticated using (public.has_role(auth.uid(),'admin'));
alter publication supabase_realtime add table public.orders;