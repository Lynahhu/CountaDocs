alter table public.client_messages
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists client_id uuid references public.clients(id) on delete cascade,
  add column if not exists sender_id uuid references auth.users(id) on delete cascade,
  add column if not exists body text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists manager_read_at timestamptz,
  add column if not exists client_read_at timestamptz;

notify pgrst, 'reload schema';
