alter table public.client_messages enable row level security;

revoke all on public.client_messages from anon, authenticated;
grant select on public.client_messages to authenticated;
grant insert (client_id, sender_id, sender_role, body) on public.client_messages to authenticated;
grant update (body, manager_read_at, client_read_at) on public.client_messages to authenticated;
grant delete on public.client_messages to authenticated;
grant all on public.client_messages to service_role;

drop policy if exists "Workspace members update client message read status" on public.client_messages;
drop policy if exists "Managers edit their own client messages" on public.client_messages;
create policy "Managers edit their own client messages"
  on public.client_messages
  for update
  to authenticated
  using (
    sender_id = (select auth.uid())
    and sender_role = 'manager'
    and exists (
      select 1
      from public.clients as client
      where client.id = client_messages.client_id
        and client.manager_id = (select auth.uid())
    )
  )
  with check (
    sender_id = (select auth.uid())
    and sender_role = 'manager'
    and exists (
      select 1
      from public.clients as client
      where client.id = client_messages.client_id
        and client.manager_id = (select auth.uid())
    )
  );

drop policy if exists "Managers delete their own client messages" on public.client_messages;
create policy "Managers delete their own client messages"
  on public.client_messages
  for delete
  to authenticated
  using (
    sender_id = (select auth.uid())
    and sender_role = 'manager'
    and exists (
      select 1
      from public.clients as client
      where client.id = client_messages.client_id
        and client.manager_id = (select auth.uid())
    )
  );
