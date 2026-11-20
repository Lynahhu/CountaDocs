alter table public.client_notifications
  add column if not exists related_document_id uuid
  references public.client_documents(id) on delete set null;

grant update (name, company_name, email, phone, document_set)
  on public.clients to authenticated;

notify pgrst, 'reload schema';
