-- Asystent AI: ogranicz dostep tylko do ról zarządczych (owner/office/manager).

drop policy if exists ai_conversations_select on public.ai_conversations;
create policy ai_conversations_select on public.ai_conversations
for select using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_conversations_insert on public.ai_conversations;
create policy ai_conversations_insert on public.ai_conversations
for insert with check (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_conversations_update on public.ai_conversations;
create policy ai_conversations_update on public.ai_conversations
for update using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
) with check (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_messages_select on public.ai_messages;
create policy ai_messages_select on public.ai_messages
for select using (
  exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_messages.conversation_id
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
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_generated_artifacts_select on public.ai_generated_artifacts;
create policy ai_generated_artifacts_select on public.ai_generated_artifacts
for select using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_generated_artifacts.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists ai_generated_artifacts_insert on public.ai_generated_artifacts;
create policy ai_generated_artifacts_insert on public.ai_generated_artifacts
for insert with check (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_generated_artifacts.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

select '0044_ai_assistant_management_only: OK' as migration_status;
