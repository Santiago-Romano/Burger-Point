create or replace function public.list_admin_access_users()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  is_admin boolean,
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
    exists (
      select 1
      from public.user_roles as roles
      where roles.user_id = users.id and roles.role = 'admin'
    ),
    requests.status
  from auth.users as users
  left join public.admin_access_requests as requests on requests.user_id = users.id
  order by users.created_at desc;
end;
$$;

revoke execute on function public.list_admin_access_users() from public, anon;
grant execute on function public.list_admin_access_users() to authenticated;

create or replace function public.set_admin_user_access(_user_id uuid, _is_admin boolean)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  if _user_id is null or _is_admin is null
     or not exists (select 1 from auth.users where id = _user_id) then
    return false;
  end if;

  -- Serialize permission changes so two admins cannot remove the final
  -- administrators at the same time.
  lock table public.user_roles in share row exclusive mode;

  if _is_admin then
    insert into public.user_roles (user_id, role)
    values (_user_id, 'admin')
    on conflict (user_id, role) do nothing;

    insert into public.admin_access_requests (
      user_id, status, reviewed_at, reviewed_by
    ) values (
      _user_id, 'approved', now(), auth.uid()
    )
    on conflict (user_id) do update
      set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid();

    return true;
  end if;

  if _user_id = auth.uid() then
    raise exception 'cannot revoke your own admin access' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.user_roles
    where user_id = _user_id and role = 'admin'
  ) then
    if (select count(*) from public.user_roles where role = 'admin') <= 1 then
      raise exception 'cannot revoke the last admin' using errcode = '22023';
    end if;

    delete from public.user_roles
    where user_id = _user_id and role = 'admin';
  end if;

  insert into public.admin_access_requests (
    user_id, status, reviewed_at, reviewed_by
  ) values (
    _user_id, 'rejected', now(), auth.uid()
  )
  on conflict (user_id) do update
    set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid();

  return true;
end;
$$;

revoke execute on function public.set_admin_user_access(uuid, boolean) from public, anon;
grant execute on function public.set_admin_user_access(uuid, boolean) to authenticated;
