-- Naprawa: RLS Asystenta AI nie byl zsynchronizowany z dostepem na poziomie aplikacji.
--
-- Migracja 0044 (a po niej 0050 - prywatne rozmowy) ograniczyly polityki RLS na
-- ai_conversations / ai_messages / ai_generated_artifacts / ai_message_attachments
-- oraz storage bucket "ai-attachments" na sztywno do `role in ('owner','office','manager')`.
--
-- Pozniej w `lib/ai-assistant.ts` (ASSISTANT_ALLOWED_ROLES) dostep do Asystenta AI
-- zostal rozszerzony o role 'sales' i 'brygadzista', ale RLS w bazie nie zostal
-- zaktualizowany. Poniewaz API-routes Asystenta AI uzywaja klienta z sesja uzytkownika
-- (podlegajacego RLS, nie service-role), efekt byl taki, ze handlowiec/brygadzista
-- widzieli panel Asystenta w UI, ale kazda operacja (nowa rozmowa, wiadomosc, raport,
-- zalacznik) byla odrzucana przez baze.
--
-- Ta migracja wprowadza jedno, wspoldzielone helper-function (analogicznie do
-- `can_see_all_cases`), zeby lista rol Asystenta AI byla zdefiniowana w JEDNYM miejscu
-- i nie rozjezdzala sie ponownie miedzy tabelami/politykami w przyszlosci.

create or replace function public.can_use_ai_assistant(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.my_role_in(target_org) in ('owner', 'office', 'manager', 'sales', 'brygadzista');
$$;

revoke all on function public.can_use_ai_assistant(uuid) from public;
grant execute on function public.can_use_ai_assistant(uuid) to authenticated;

-- ai_conversations -----------------------------------------------------------

drop policy if exists ai_conversations_select on public.ai_conversations;
create policy ai_conversations_select on public.ai_conversations
for select using (
  ai_conversations.created_by = auth.uid()
  and public.can_use_ai_assistant(ai_conversations.organization_id)
);

drop policy if exists ai_conversations_insert on public.ai_conversations;
create policy ai_conversations_insert on public.ai_conversations
for insert with check (
  ai_conversations.created_by = auth.uid()
  and public.can_use_ai_assistant(ai_conversations.organization_id)
);

drop policy if exists ai_conversations_update on public.ai_conversations;
create policy ai_conversations_update on public.ai_conversations
for update using (
  ai_conversations.created_by = auth.uid()
  and public.can_use_ai_assistant(ai_conversations.organization_id)
) with check (
  ai_conversations.created_by = auth.uid()
  and public.can_use_ai_assistant(ai_conversations.organization_id)
);

drop policy if exists ai_conversations_delete on public.ai_conversations;
create policy ai_conversations_delete on public.ai_conversations
for delete using (
  ai_conversations.created_by = auth.uid()
  and public.can_use_ai_assistant(ai_conversations.organization_id)
);

-- ai_messages ------------------------------------------------------------------

drop policy if exists ai_messages_select on public.ai_messages;
create policy ai_messages_select on public.ai_messages
for select using (
  exists (
    select 1 from public.ai_conversations c
    where c.id = ai_messages.conversation_id
      and c.created_by = auth.uid()
      and public.can_use_ai_assistant(c.organization_id)
  )
);

drop policy if exists ai_messages_insert on public.ai_messages;
create policy ai_messages_insert on public.ai_messages
for insert with check (
  exists (
    select 1 from public.ai_conversations c
    where c.id = ai_messages.conversation_id
      and c.organization_id = ai_messages.organization_id
      and c.created_by = auth.uid()
      and public.can_use_ai_assistant(c.organization_id)
  )
);

-- ai_generated_artifacts ---------------------------------------------------------

drop policy if exists ai_generated_artifacts_select on public.ai_generated_artifacts;
create policy ai_generated_artifacts_select on public.ai_generated_artifacts
for select using (
  ai_generated_artifacts.created_by = auth.uid()
  and public.can_use_ai_assistant(ai_generated_artifacts.organization_id)
);

drop policy if exists ai_generated_artifacts_insert on public.ai_generated_artifacts;
create policy ai_generated_artifacts_insert on public.ai_generated_artifacts
for insert with check (
  ai_generated_artifacts.created_by = auth.uid()
  and public.can_use_ai_assistant(ai_generated_artifacts.organization_id)
);

-- ai_message_attachments ---------------------------------------------------------

drop policy if exists ai_message_attachments_select on public.ai_message_attachments;
create policy ai_message_attachments_select on public.ai_message_attachments
for select using (
  ai_message_attachments.created_by = auth.uid()
  and exists (
    select 1 from public.ai_conversations c
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and c.created_by = auth.uid()
      and public.can_use_ai_assistant(c.organization_id)
  )
);

drop policy if exists ai_message_attachments_insert on public.ai_message_attachments;
create policy ai_message_attachments_insert on public.ai_message_attachments
for insert with check (
  ai_message_attachments.created_by = auth.uid()
  and exists (
    select 1 from public.ai_conversations c
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and c.created_by = auth.uid()
      and public.can_use_ai_assistant(c.organization_id)
  )
);

drop policy if exists ai_message_attachments_update on public.ai_message_attachments;
create policy ai_message_attachments_update on public.ai_message_attachments
for update using (
  ai_message_attachments.created_by = auth.uid()
  and exists (
    select 1 from public.ai_conversations c
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and c.created_by = auth.uid()
      and public.can_use_ai_assistant(c.organization_id)
  )
) with check (
  ai_message_attachments.created_by = auth.uid()
  and exists (
    select 1 from public.ai_conversations c
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and c.created_by = auth.uid()
      and public.can_use_ai_assistant(c.organization_id)
  )
);

-- storage: ai-attachments ---------------------------------------------------------
-- Ta sama funkcja `owns_ai_attachment_object` (0050), tylko z rozszerzona lista rol.

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
    where c.id = public.uuid_or_null((storage.foldername(name))[2])
      and c.organization_id = public.uuid_or_null((storage.foldername(name))[1])
      and c.created_by = auth.uid()
      and public.can_use_ai_assistant(c.organization_id)
  );
$$;

revoke all on function public.owns_ai_attachment_object(text) from public;
grant execute on function public.owns_ai_attachment_object(text) to authenticated;

select '0057_ai_assistant_role_access_fix: OK' as migration_status;
