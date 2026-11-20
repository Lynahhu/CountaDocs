create table if not exists public.client_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  category text not null default 'Other' check (
    category in ('bank_statements', 'invoices', 'tax_forms', 'payroll', 'receipts', 'other', 'Other')
  ),
  created_at timestamptz not null default now()
);

create index if not exists client_documents_client_created_idx
  on public.client_documents (client_id, created_at desc);

alter table public.client_notifications
  add column if not exists related_document_id uuid
  references public.client_documents(id) on delete set null;

alter table public.client_documents enable row level security;

revoke all on public.client_documents from anon, authenticated;
grant select, insert, delete on public.client_documents to authenticated;
grant all on public.client_documents to service_role;

drop policy if exists "Workspace members view client documents" on public.client_documents;
create policy "Workspace members view client documents"
  on public.client_documents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.clients as client
      where client.id = client_documents.client_id
        and client.manager_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.client_members as member
      where member.client_id = client_documents.client_id
        and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "Workspace members upload client documents" on public.client_documents;
create policy "Workspace members upload client documents"
  on public.client_documents
  for insert
  to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1
      from public.clients as client
      where client.id = client_documents.client_id
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

drop policy if exists "Managers delete client documents" on public.client_documents;
create policy "Managers delete client documents"
  on public.client_documents
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.clients as client
      where client.id = client_documents.client_id
        and client.manager_id = (select auth.uid())
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-documents',
  'client-documents',
  false,
  20971520,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Workspace members upload client document files" on storage.objects;
create policy "Workspace members upload client document files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'client-documents'
    and exists (
      select 1
      from public.clients as client
      where client.id::text = split_part(name, '/', 1)
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

drop policy if exists "Workspace members read client document files" on storage.objects;
create policy "Workspace members read client document files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'client-documents'
    and exists (
      select 1
      from public.clients as client
      where client.id::text = split_part(name, '/', 1)
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

drop policy if exists "Managers delete client document files" on storage.objects;
create policy "Managers delete client document files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'client-documents'
    and exists (
      select 1
      from public.clients as client
      where client.id::text = split_part(name, '/', 1)
        and client.manager_id = (select auth.uid())
    )
  );

create or replace function public.notify_manager_of_client_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_record public.clients%rowtype;
begin
  select *
  into client_record
  from public.clients
  where id = new.client_id;

  if new.uploaded_by <> client_record.manager_id then
    insert into public.client_notifications (
      client_id,
      created_by,
      title,
      body,
      related_document_id
    )
    values (
      new.client_id,
      client_record.manager_id,
      'Document uploaded',
      format('%s uploaded %s', client_record.name, new.file_name),
      new.id
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_manager_of_client_document() from public, anon, authenticated;

drop trigger if exists client_documents_notify_manager on public.client_documents;
create trigger client_documents_notify_manager
  after insert on public.client_documents
  for each row execute function public.notify_manager_of_client_document();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'client_documents'
  ) then
    alter publication supabase_realtime add table public.client_documents;
  end if;
end;
$$;
