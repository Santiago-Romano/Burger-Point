create table public.menu_content (
  id smallint primary key default 1 check (id = 1),
  items jsonb not null,
  updated_at timestamptz not null default now()
);

grant select on public.menu_content to anon, authenticated;
grant insert, update on public.menu_content to authenticated;
alter table public.menu_content enable row level security;

create policy "public can read menu" on public.menu_content
  for select to anon, authenticated using (true);
create policy "admins insert menu" on public.menu_content
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "admins update menu" on public.menu_content
  for update to authenticated using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "public can view menu images" on storage.objects
  for select to public using (bucket_id = 'menu-images');
create policy "admins upload menu images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'menu-images' and public.has_role(auth.uid(), 'admin')
  );
create policy "admins update menu images" on storage.objects
  for update to authenticated using (
    bucket_id = 'menu-images' and public.has_role(auth.uid(), 'admin')
  ) with check (
    bucket_id = 'menu-images' and public.has_role(auth.uid(), 'admin')
  );
create policy "admins delete menu images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'menu-images' and public.has_role(auth.uid(), 'admin')
  );

alter publication supabase_realtime add table public.menu_content;