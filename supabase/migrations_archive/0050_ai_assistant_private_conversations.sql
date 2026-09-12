-- Asystent AI: prywatna historia rozmow per uzytkownik.
-- Do tej pory rozmowy/wiadomosci/zalaczniki/raporty AI byly widoczne dla kazdej osoby
-- z rola zarzadcza (owner/office/manager) w organizacji - czyli byly de facto wspoldzielone.
-- Ta migracja wymusza na poziomie RLS, ze kazdy uzytkownik widzi WYLACZNIE wlasne rozmowy
-- (te, ktore sam zalozyl), niezaleznie od roli. Dotyczy to zarowno asystenta globalnego,
-- jak i asystenta przy konkretnej sprawie. Rola zarzadcza jest nadal wymagana, zeby w ogole
-- korzystac z Asystenta AI, ale nie daje wgladu w rozmowy innych osob - to nie jest modul
-- audytu (taki modul, jesli powstanie, powinien byc osobny i jawnie opisany).

-- ai_conversations -----------------------------------------------------------

drop policy if exists ai_conversations_select on public.ai_conversations;
create policy ai_conversations_select on public.ai_conversations
for select using (
  ai_conversations.created_by = auth.uid()
  and exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_conversations_insert on public.ai_conversations;
create policy ai_conversations_insert on public.ai_conversations
for insert with check (
  ai_conversations.created_by = auth.uid()
  and exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_conversations_update on public.ai_conversations;
create policy ai_conversations_update on public.ai_conversations
for update using (
  ai_conversations.created_by = auth.uid()
  and exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
) with check (
  ai_conversations.created_by = auth.uid()
  and exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_conversations_delete on public.ai_conversations;
create policy ai_conversations_delete on public.ai_conversations
for delete using (
  ai_conversations.created_by = auth.uid()
  and exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

-- ai_messages ------------------------------------------------------------------
-- Wiadomosci nie maja wlasnego "wlasciciela" wprost (odpowiedz asystenta ma created_by = null),
-- wiec dostep zawsze wynika z wlasnosci rozmowy nadrzednej.

drop policy if exists ai_messages_select on public.ai_messages;
create policy ai_messages_select on public.ai_messages
for select using (
  exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_messages.conversation_id
      and c.created_by = auth.uid()
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_messages_insert on public.ai_messages;
create policy ai_messages_insert on public.ai_messages
for insert with check (
  exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_messages.conversation_id
      and c.organization_id = ai_messages.organization_id
      and c.created_by = auth.uid()
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

-- ai_generated_artifacts ---------------------------------------------------------

drop policy if exists ai_generated_artifacts_select on public.ai_generated_artifacts;
create policy ai_generated_artifacts_select on public.ai_generated_artifacts
for select using (
  ai_generated_artifacts.created_by = auth.uid()
  and exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_generated_artifacts.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_generated_artifacts_insert on public.ai_generated_artifacts;
create policy ai_generated_artifacts_insert on public.ai_generated_artifacts
for insert with check (
  ai_generated_artifacts.created_by = auth.uid()
  and exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_generated_artifacts.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

-- ai_message_attachments ---------------------------------------------------------

drop policy if exists ai_message_attachments_select on public.ai_message_attachments;
create policy ai_message_attachments_select on public.ai_message_attachments
for select using (
  ai_message_attachments.created_by = auth.uid()
  and exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and c.created_by = auth.uid()
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_message_attachments_insert on public.ai_message_attachments;
create policy ai_message_attachments_insert on public.ai_message_attachments
for insert with check (
  ai_message_attachments.created_by = auth.uid()
  and exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and c.created_by = auth.uid()
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_message_attachments_update on public.ai_message_attachments;
create policy ai_message_attachments_update on public.ai_message_attachments
for update using (
  ai_message_attachments.created_by = auth.uid()
  and exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and c.created_by = auth.uid()
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
) with check (
  ai_message_attachments.created_by = auth.uid()
  and exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and c.created_by = auth.uid()
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

-- storage: ai-attachments ---------------------------------------------------------
-- Sciezka pliku: {organization_id}/{conversation_id}/{uuid}-{nazwa_pliku}.
-- Dostep tylko dla osoby, ktora zalozyla dana rozmowe (czyli faktycznego wlasciciela plikow).

create or replace function public.owns_ai_attachment_object(name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = public.uuid_or_null((storage.foldername(name))[2])
      and c.organization_id = public.uuid_or_null((storage.foldername(name))[1])
      and c.created_by = auth.uid()
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  );
$$;

revoke all on function public.owns_ai_attachment_object(text) from public;
grant execute on function public.owns_ai_attachment_object(text) to authenticated;

drop policy if exists "ai-attachments select" on storage.objects;
create policy "ai-attachments select"
on storage.objects for select to authenticated
using (
  bucket_id = 'ai-attachments'
  and public.owns_ai_attachment_object(name)
);

drop policy if exists "ai-attachments insert" on storage.objects;
create policy "ai-attachments insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ai-attachments'
  and public.owns_ai_attachment_object(name)
);

drop policy if exists "ai-attachments update" on storage.objects;
create policy "ai-attachments update"
on storage.objects for update to authenticated
using (
  bucket_id = 'ai-attachments'
  and public.owns_ai_attachment_object(name)
);

drop policy if exists "ai-attachments delete" on storage.objects;
create policy "ai-attachments delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'ai-attachments'
  and public.owns_ai_attachment_object(name)
);

select '0050_ai_assistant_private_conversations: OK' as migration_status;
