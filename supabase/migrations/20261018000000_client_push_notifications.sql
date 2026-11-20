create table public.clients (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  company_name text not null,
  email text not null,
  phone text not null,
  document_set text not null,
  requests integer not null default 1 check (requests >= 0),
  whatsapp_opt_in boolean not null default false,
  whatsapp_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  constraint clients_whatsapp_opt_in_timestamp check (
    (whatsapp_opt_in and whatsapp_opt_in_at is not null)
    or (not whatsapp_opt_in and whatsapp_opt_in_at is null)
  )
);

create or replace function public.sync_client_whatsapp_consent_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.whatsapp_opt_in and not old.whatsapp_opt_in then
    new.whatsapp_opt_in_at = now();
  elsif not new.whatsapp_opt_in then
    new.whatsapp_opt_in_at = null;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_client_whatsapp_consent_timestamp() from public, anon, authenticated;

create trigger clients_sync_whatsapp_consent_timestamp
  before update of whatsapp_opt_in on public.clients
  for each row execute function public.sync_client_whatsapp_consent_timestamp();

create unique index clients_manager_email_idx
  on public.clients (manager_id, lower(email));

create table public.client_members (
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);

create index client_members_user_id_idx on public.client_members (user_id);

create table public.client_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sound_key text not null default 'bell'
    check (sound_key in ('bell', 'soft_chime', 'double_bell')),
  updated_at timestamptz not null default now()
);

create table public.client_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index client_push_tokens_user_id_idx on public.client_push_tokens (user_id);

create table public.client_notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index client_notifications_client_created_idx
  on public.client_notifications (client_id, created_at desc);

alter table public.clients enable row level security;
alter table public.client_members enable row level security;
alter table public.client_notification_preferences enable row level security;
alter table public.client_push_tokens enable row level security;
alter table public.client_notifications enable row level security;

revoke all on public.clients from anon, authenticated;
revoke all on public.client_members from anon, authenticated;
revoke all on public.client_notification_preferences from anon, authenticated;
revoke all on public.client_push_tokens from anon, authenticated;
revoke all on public.client_notifications from anon, authenticated;

grant select, insert, delete on public.clients to authenticated;
grant update (whatsapp_opt_in) on public.clients to authenticated;
grant select on public.client_members to authenticated;
grant select, insert, update on public.client_notification_preferences to authenticated;
grant select, insert, update, delete on public.client_push_tokens to authenticated;
grant select on public.client_notifications to authenticated;
grant all on public.clients, public.client_members, public.client_notification_preferences,
  public.client_push_tokens, public.client_notifications to service_role;

create policy "Managers manage their client records"
  on public.clients
  for all
  to authenticated
  using (manager_id = (select auth.uid()))
  with check (manager_id = (select auth.uid()));

create policy "Clients can view linked client records"
  on public.clients
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.client_members as member
      where member.client_id = clients.id
        and member.user_id = (select auth.uid())
    )
  );

create policy "Linked clients manage their WhatsApp consent"
  on public.clients
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.client_members as member
      where member.client_id = clients.id
        and member.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.client_members as member
      where member.client_id = clients.id
        and member.user_id = (select auth.uid())
    )
  );

create policy "Users view their own client links"
  on public.client_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users manage their own notification preferences"
  on public.client_notification_preferences
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users manage their own push tokens"
  on public.client_push_tokens
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Clients view notifications for their linked records"
  on public.client_notifications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.client_members as member
      where member.client_id = client_notifications.client_id
        and member.user_id = (select auth.uid())
    )
  );

create policy "Managers view notifications they sent"
  on public.client_notifications
  for select
  to authenticated
  using (created_by = (select auth.uid()));

create or replace function public.claim_client_memberships()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before linking a client account.';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = (select auth.uid())
      and auth_user.email_confirmed_at is not null
  ) then
    raise exception 'Confirm your email before linking a client account.';
  end if;

  insert into public.client_members (client_id, user_id)
  select client.id, (select auth.uid())
  from public.clients as client
  join auth.users as auth_user
    on auth_user.id = (select auth.uid())
   and lower(auth_user.email) = lower(client.email)
  on conflict (client_id, user_id) do nothing;

  get diagnostics linked_count = row_count;
  return linked_count;
end;
$$;

revoke all on function public.claim_client_memberships() from public, anon;
grant execute on function public.claim_client_memberships() to authenticated;

create or replace function public.link_verified_client_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.client_members (client_id, user_id)
  select new.id, auth_user.id
  from auth.users as auth_user
  where auth_user.email_confirmed_at is not null
    and lower(auth_user.email) = lower(new.email)
  on conflict (client_id, user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.link_verified_client_email() from public, anon, authenticated;

create trigger clients_link_verified_email
  after insert or update of email on public.clients
  for each row execute function public.link_verified_client_email();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'client_notifications'
  ) then
    alter publication supabase_realtime add table public.client_notifications;
  end if;
end;
$$;
