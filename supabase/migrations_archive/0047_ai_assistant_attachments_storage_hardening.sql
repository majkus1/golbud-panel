-- Asystent AI: utwardzenie dostepu do zalacznikow (storage + metadane) tylko dla rol zaradczych.

drop policy if exists "ai-attachments select" on storage.objects;
create policy "ai-attachments select"
on storage.objects for select to authenticated
using (
  bucket_id = 'ai-attachments'
  and public.uuid_or_null((storage.foldername(name))[1]) in (
    select om.organization_id
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_message_attachments_select on public.ai_message_attachments;
create policy ai_message_attachments_select on public.ai_message_attachments
for select using (
  exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_message_attachments_insert on public.ai_message_attachments;
create policy ai_message_attachments_insert on public.ai_message_attachments
for insert with check (
  exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

select '0047_ai_assistant_attachments_storage_hardening: OK' as migration_status;
