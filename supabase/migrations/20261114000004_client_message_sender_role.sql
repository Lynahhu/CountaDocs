alter table public.client_messages
  add column if not exists sender_role text;

update public.client_messages as message
set sender_role = case
  when exists (
    select 1
    from public.clients as client
    where client.id = message.client_id
      and client.manager_id = message.sender_id
  ) then 'manager'
  else 'client'
end
where message.sender_role is null;

alter table public.client_messages
  alter column sender_role set not null;

revoke all on public.client_messages from anon, authenticated;
grant select on public.client_messages to authenticated;
grant insert (client_id, sender_id, sender_role, body) on public.client_messages to authenticated;
grant update (manager_read_at, client_read_at) on public.client_messages to authenticated;
grant all on public.client_messages to service_role;

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
          (
            sender_role = 'manager'
            and client.manager_id = (select auth.uid())
          )
          or (
            sender_role = 'client'
            and exists (
              select 1
              from public.client_members as member
              where member.client_id = client.id
                and member.user_id = (select auth.uid())
            )
          )
        )
    )
  );

notify pgrst, 'reload schema';
