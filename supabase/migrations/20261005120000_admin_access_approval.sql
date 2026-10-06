create table if not exists public.admin_access_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

alter table public.admin_access_requests enable row level security;
revoke all on table public.admin_access_requests from public, anon, authenticated;

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

  if exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.admin_access_requests (user_id)
    values (auth.uid())
    on conflict (user_id) do nothing;
    return false;
  end if;

  insert into public.user_roles (user_id, role)
  values (auth.uid(), 'admin')
  on conflict (user_id, role) do nothing;

  return public.has_role(auth.uid(), 'admin');
end;
$$;

revoke execute on function public.claim_admin() from public, anon;
grant execute on function public.claim_admin() to authenticated;

create or replace function public.get_admin_access_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then 'none'
    when public.has_role(auth.uid(), 'admin') then 'approved'
    else coalesce(
      (select request.status
       from public.admin_access_requests as request
       where request.user_id = auth.uid()),
      'none'
    )
  end;
$$;

revoke execute on function public.get_admin_access_status() from public, anon;
grant execute on function public.get_admin_access_status() to authenticated;

create or replace function public.list_admin_access_requests()
returns table (user_id uuid, email text, requested_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return query
  select request.user_id, users.email::text, request.requested_at
  from public.admin_access_requests as request
  join auth.users as users on users.id = request.user_id
  where request.status = 'pending'
  order by request.requested_at asc;
end;
$$;

revoke execute on function public.list_admin_access_requests() from public, anon;
grant execute on function public.list_admin_access_requests() to authenticated;

create or replace function public.review_admin_access_request(_user_id uuid, _approve boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  request_status text;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  select status into request_status
  from public.admin_access_requests
  where user_id = _user_id
  for update;

  if not found or request_status <> 'pending' then
    return false;
  end if;

  if _approve then
    insert into public.user_roles (user_id, role)
    values (_user_id, 'admin')
    on conflict (user_id, role) do nothing;
  end if;

  update public.admin_access_requests
  set status = case when _approve then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where user_id = _user_id;

  return true;
end;
$$;

revoke execute on function public.review_admin_access_request(uuid, boolean) from public, anon;
grant execute on function public.review_admin_access_request(uuid, boolean) to authenticated;
