-- Naprawa usuwania rozmow Asystenta AI.
-- Wczesniejsze migracje dawaly select/insert/update, ale brakowalo delete policy i grantu,
-- przez co UI mogl pokazywac sukces mimo pozostawienia rozmowy w bazie.

drop policy if exists ai_conversations_delete on public.ai_conversations;
create policy ai_conversations_delete on public.ai_conversations
for delete using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

grant delete on public.ai_conversations to authenticated;

select '0045_ai_assistant_delete_conversations: OK' as migration_status;
