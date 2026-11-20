alter table public.client_documents
  add column if not exists category text not null default 'Other';

alter table public.client_documents
  drop constraint if exists client_documents_category_check;

update public.client_documents
set category = 'Other'
where category is null
   or category not in ('bank_statements', 'invoices', 'tax_forms', 'payroll', 'receipts', 'other', 'Other');

alter table public.client_documents
  alter column category set default 'Other',
  alter column category set not null;

alter table public.client_documents
  add constraint client_documents_category_check
  check (category in ('bank_statements', 'invoices', 'tax_forms', 'payroll', 'receipts', 'other', 'Other'));

create table if not exists public.client_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  manager_read_at timestamptz,
  client_read_at timestamptz
);

create index if not exists client_messages_thread_created_idx
  on public.client_messages (client_id, created_at);

alter table public.client_messages enable row level security;
revoke all on public.client_messages from anon, authenticated;
grant select on public.client_messages to authenticated;
grant insert (client_id, sender_id, body) on public.client_messages to authenticated;
grant all on public.client_messages to service_role;

drop policy if exists "Workspace members view client messages" on public.client_messages;
create policy "Workspace members view client messages"
  on public.client_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.clients as client
      where client.id = client_messages.client_id
        and client.manager_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.client_members as member
      where member.client_id = client_messages.client_id
        and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "Workspace members send client messages" on public.client_messages;
create policy "Workspace members send client messages"
  on public.client_messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.clients as client
      where client.id = client_messages.client_id
        and (
          client.manager_id = (select auth.uid())
          or exists (
            select 1
            from public.client_members as member
            where member.client_id = client.id
              and member.user_id = (select auth.uid())
          )
        )
    )
  );

create or replace function public.mark_client_messages_read(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  manager_user_id uuid;
  updated_count integer;
begin
  select client.manager_id
  into manager_user_id
  from public.clients as client
  where client.id = p_client_id;

  if manager_user_id is null then
    raise exception 'Client workspace not found';
  end if;

  if manager_user_id = (select auth.uid()) then
    update public.client_messages
    set manager_read_at = now()
    where client_id = p_client_id
      and sender_id <> (select auth.uid())
      and manager_read_at is null;
  elsif exists (
    select 1
    from public.client_members as member
    where member.client_id = p_client_id
      and member.user_id = (select auth.uid())
  ) then
    update public.client_messages
    set client_read_at = now()
    where client_id = p_client_id
      and sender_id <> (select auth.uid())
      and client_read_at is null;
  else
    raise exception 'Not authorized to read this conversation';
  end if;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.mark_client_messages_read(uuid) from public, anon;
grant execute on function public.mark_client_messages_read(uuid) to authenticated;

create or replace function public.set_client_message_sender_read_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  manager_user_id uuid;
begin
  select client.manager_id
  into manager_user_id
  from public.clients as client
  where client.id = new.client_id;

  if new.sender_id = manager_user_id then
    new.manager_read_at = now();
  else
    new.client_read_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.set_client_message_sender_read_at() from public, anon, authenticated;

drop trigger if exists client_messages_set_sender_read_at on public.client_messages;
create trigger client_messages_set_sender_read_at
  before insert on public.client_messages
  for each row execute function public.set_client_message_sender_read_at();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'client_messages'
  ) then
    alter publication supabase_realtime add table public.client_messages;
  end if;
end;
$$;
