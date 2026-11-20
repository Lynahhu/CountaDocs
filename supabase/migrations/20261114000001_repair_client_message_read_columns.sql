alter table public.client_messages
  add column if not exists manager_read_at timestamptz,
  add column if not exists client_read_at timestamptz;

notify pgrst, 'reload schema';
