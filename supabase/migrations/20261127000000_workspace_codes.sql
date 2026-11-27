-- Workspace invite codes: each manager gets a unique code that clients scan/enter in the app
-- to connect to that specific manager's workspace.

create table if not exists public.workspace_codes (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references auth.users(id) on delete cascade,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for fast code lookup (clients entering/scanning codes)
create index if not exists idx_workspace_codes_code on public.workspace_codes(code);
-- Index for finding a manager's code
create index if not exists idx_workspace_codes_manager on public.workspace_codes(manager_id);

-- Each manager gets exactly one active code at a time
create unique index if not exists idx_workspace_codes_active_manager
  on public.workspace_codes(manager_id) where is_active = true;

-- RLS: managers can read/manage their own codes, anyone authenticated can look up a code
alter table public.workspace_codes enable row level security;

-- Managers can see their own codes
create policy "Managers can view own codes"
  on public.workspace_codes for select
  using (auth.uid() = manager_id);

-- Managers can insert their own codes
create policy "Managers can create own codes"
  on public.workspace_codes for insert
  with check (auth.uid() = manager_id);

-- Managers can update their own codes (e.g. deactivate)
create policy "Managers can update own codes"
  on public.workspace_codes for update
  using (auth.uid() = manager_id);

-- Anyone authenticated can look up a code (clients validating codes)
create policy "Authenticated users can look up codes by code value"
  on public.workspace_codes for select
  using (auth.role() = 'authenticated');

-- Auto-update updated_at timestamp
create or replace function public.update_workspace_codes_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger workspace_codes_updated_at
  before update on public.workspace_codes
  for each row
  execute function public.update_workspace_codes_updated_at();
