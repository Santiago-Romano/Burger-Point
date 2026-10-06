grant usage on type public.app_role to authenticated;

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

  -- Operators already have panel access and should not create admin requests.
  if public.has_role(auth.uid(), 'operator') then
    return false;
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

create or replace function public.get_panel_access()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then 'none'
    when public.has_role(auth.uid(), 'admin') then 'admin'
    when public.has_role(auth.uid(), 'operator') then 'operator'
    else coalesce(
      (select request.status
       from public.admin_access_requests as request
       where request.user_id = auth.uid()),
      'none'
    )
  end;
$$;

revoke execute on function public.get_panel_access() from public, anon;
grant execute on function public.get_panel_access() to authenticated;

create or replace function public.list_access_users()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  role text,
  request_status text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return query
  select
    users.id,
    users.email::text,
    users.created_at,
    coalesce((
      select roles.role::text
      from public.user_roles as roles
      where roles.user_id = users.id
      order by (roles.role = 'admin') desc
      limit 1
    ), 'none'),
    requests.status
  from auth.users as users
  left join public.admin_access_requests as requests on requests.user_id = users.id
  order by users.created_at desc;
end;
$$;

revoke execute on function public.list_access_users() from public, anon;
grant execute on function public.list_access_users() to authenticated;

create or replace function public.set_user_app_role(_user_id uuid, _role public.app_role)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_is_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if _user_id is null or not exists (select 1 from auth.users where id = _user_id) then
    return false;
  end if;

  -- Serialize role changes and recheck the caller's role while locked.
  lock table public.user_roles in share row exclusive mode;

  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  if _user_id = auth.uid() then
    raise exception 'cannot change your own role' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.user_roles
    where user_id = _user_id and role = 'admin'
  ) into target_is_admin;

  if target_is_admin and _role is distinct from 'admin'::public.app_role
     and (select count(*) from public.user_roles where role = 'admin') <= 1 then
    raise exception 'cannot remove the last admin' using errcode = '22023';
  end if;

  delete from public.user_roles where user_id = _user_id;

  if _role is not null then
    insert into public.user_roles (user_id, role)
    values (_user_id, _role);
  end if;

  insert into public.admin_access_requests (
    user_id, status, reviewed_at, reviewed_by
  ) values (
    _user_id,
    case when _role is null then 'rejected' else 'approved' end,
    now(),
    auth.uid()
  )
  on conflict (user_id) do update
    set status = excluded.status,
        reviewed_at = excluded.reviewed_at,
        reviewed_by = excluded.reviewed_by;

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

  if _approve then
    select exists (
      select 1
      from public.user_roles
      where user_id = _user_id and role = 'admin'
    ) into target_is_admin;

    if target_is_admin and _role is distinct from 'admin'::public.app_role
       and (select count(*) from public.user_roles where role = 'admin') <= 1 then
      raise exception 'cannot remove the last admin' using errcode = '22023';
    end if;

    delete from public.user_roles where user_id = _user_id;
    insert into public.user_roles (user_id, role) values (_user_id, _role);
  end if;

  update public.admin_access_requests
  set status = case when _approve then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where user_id = _user_id;

  return true;
end;
$$;

revoke execute on function public.review_user_access_request(uuid, boolean, public.app_role)
  from public, anon;
grant execute on function public.review_user_access_request(uuid, boolean, public.app_role)
  to authenticated;

drop policy if exists "admin read" on public.orders;
drop policy if exists "admin update" on public.orders;
drop policy if exists "admin delete" on public.orders;
create policy "staff read orders" on public.orders
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'));
create policy "staff update orders" on public.orders
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'));
create policy "admin delete orders" on public.orders
  for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "admins insert menu" on public.menu_content;
drop policy if exists "admins update menu" on public.menu_content;
create policy "staff insert menu" on public.menu_content
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'));
create policy "staff update menu" on public.menu_content
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'));

drop policy if exists "admins upload menu images" on storage.objects;
drop policy if exists "admins update menu images" on storage.objects;
drop policy if exists "admins delete menu images" on storage.objects;
create policy "staff upload menu images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'menu-images'
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'))
  );
create policy "staff update menu images" on storage.objects
  for update to authenticated using (
    bucket_id = 'menu-images'
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'))
  ) with check (
    bucket_id = 'menu-images'
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'))
  );
create policy "staff delete menu images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'menu-images'
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'operator'))
  );

notify pgrst, 'reload schema';
