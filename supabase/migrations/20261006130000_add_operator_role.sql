alter type public.app_role add value if not exists 'operator';

notify pgrst, 'reload schema';
