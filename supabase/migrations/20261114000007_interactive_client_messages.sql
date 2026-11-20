alter table public.client_messages
  add column if not exists reply_to_message_id uuid references public.client_messages(id) on delete set null,
  add column if not exists forwarded_from_message_id uuid references public.client_messages(id) on delete set null,
  add column if not exists pinned_at timestamptz;

create index if not exists client_messages_pinned_thread_idx
  on public.client_messages (client_id, pinned_at desc)
  where pinned_at is not null;

revoke all on public.client_messages from anon, authenticated;
grant select on public.client_messages to authenticated;
grant insert (client_id, sender_id, sender_role, body, reply_to_message_id, forwarded_from_message_id)
  on public.client_messages to authenticated;
grant update (body, manager_read_at, client_read_at) on public.client_messages to authenticated;
grant delete on public.client_messages to authenticated;
grant all on public.client_messages to service_role;

create or replace function public.validate_client_message_references()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  referenced_client_id uuid;
begin
  if new.reply_to_message_id is not null then
    select message.client_id
    into referenced_client_id
    from public.client_messages as message
    where message.id = new.reply_to_message_id;

    if referenced_client_id is distinct from new.client_id then
      raise exception 'Reply target must belong to the same conversation';
    end if;
  end if;

  if new.forwarded_from_message_id is not null then
    if new.sender_role <> 'manager'
      or new.sender_id is distinct from (select auth.uid())
      or not exists (
        select 1
        from public.client_messages as source_message
        join public.clients as source_client on source_client.id = source_message.client_id
        where source_message.id = new.forwarded_from_message_id
          and source_client.manager_id = (select auth.uid())
      )
    then
      raise exception 'Forward source must be in a conversation managed by the sender';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_client_message_references() from public, anon, authenticated;

drop trigger if exists client_messages_validate_references on public.client_messages;
create trigger client_messages_validate_references
  before insert on public.client_messages
  for each row execute function public.validate_client_message_references();

create or replace function public.set_client_message_pinned(
  p_message_id uuid,
  p_pinned boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_manager_id uuid;
  updated_pinned_at timestamptz;
begin
  select client.manager_id
  into message_manager_id
  from public.client_messages as message
  join public.clients as client on client.id = message.client_id
  where message.id = p_message_id;

  if message_manager_id is null or message_manager_id is distinct from (select auth.uid()) then
    raise exception 'Not authorized to pin this message';
  end if;

  update public.client_messages as message
  set pinned_at = case
    when p_pinned then coalesce(message.pinned_at, now())
    else null
  end
  where message.id = p_message_id
  returning message.pinned_at into updated_pinned_at;

  return updated_pinned_at;
end;
$$;

revoke all on function public.set_client_message_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_client_message_pinned(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
