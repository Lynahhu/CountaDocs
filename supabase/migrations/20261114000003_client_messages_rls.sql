alter table public.client_messages enable row level security;

revoke all on public.client_messages from anon, authenticated;
grant select on public.client_messages to authenticated;
grant insert (client_id, sender_id, body) on public.client_messages to authenticated;
grant update (manager_read_at, client_read_at) on public.client_messages to authenticated;

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

drop policy if exists "Workspace members update client message read status" on public.client_messages;
create policy "Workspace members update client message read status"
  on public.client_messages
  for update
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
  )
  with check (
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

notify pgrst, 'reload schema';
