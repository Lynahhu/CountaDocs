create index if not exists clients_manager_created_idx
  on public.clients (manager_id, created_at desc);
