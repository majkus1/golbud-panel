-- Asystent AI: wspoldzielone rozmowy organizacji, wiadomosci i wygenerowane raporty.

alter table public.organization_activity_log drop constraint if exists organization_activity_log_category_check;
alter table public.organization_activity_log add constraint organization_activity_log_category_check check (category in (
  'sprawa', 'platnosc', 'faktura', 'magazyn', 'sprzet', 'czas', 'zespol', 'firma',
  'przypisanie', 'prace_dodatkowe', 'zadanie', 'rozliczenia', 'rentownosc', 'hr', 'ai'
));

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid references public.cases(id) on delete cascade,
  context_type text not null default 'global' check (context_type in ('global', 'case')),
  title text not null default 'Nowa rozmowa AI',
  created_by uuid references auth.users(id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_org_idx on public.ai_conversations(organization_id, last_message_at desc);
create index if not exists ai_conversations_case_idx on public.ai_conversations(case_id, last_message_at desc) where case_id is not null;

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  case_id uuid references public.cases(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  meta jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_idx on public.ai_messages(conversation_id, created_at);
create index if not exists ai_messages_org_idx on public.ai_messages(organization_id, created_at desc);

create table if not exists public.ai_generated_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  case_id uuid references public.cases(id) on delete cascade,
  artifact_type text not null check (artifact_type in ('pdf', 'xlsx')),
  report_type text not null,
  title text not null,
  storage_path text,
  file_name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ai_generated_artifacts_org_idx on public.ai_generated_artifacts(organization_id, created_at desc);
create index if not exists ai_generated_artifacts_case_idx on public.ai_generated_artifacts(case_id, created_at desc) where case_id is not null;

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_generated_artifacts enable row level security;

drop policy if exists ai_conversations_select on public.ai_conversations;
create policy ai_conversations_select on public.ai_conversations
for select using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and (
        om.role in ('owner', 'office', 'manager')
        or (
          ai_conversations.case_id is not null
          and exists (
            select 1 from public.case_assignees ca
            where ca.case_id = ai_conversations.case_id
              and ca.user_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists ai_conversations_insert on public.ai_conversations;
create policy ai_conversations_insert on public.ai_conversations
for insert with check (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and (
        om.role in ('owner', 'office', 'manager')
        or (
          ai_conversations.case_id is not null
          and exists (
            select 1 from public.case_assignees ca
            where ca.case_id = ai_conversations.case_id
              and ca.user_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists ai_conversations_update on public.ai_conversations;
create policy ai_conversations_update on public.ai_conversations
for update using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and (
        om.role in ('owner', 'office', 'manager')
        or (
          ai_conversations.case_id is not null
          and exists (
            select 1 from public.case_assignees ca
            where ca.case_id = ai_conversations.case_id
              and ca.user_id = auth.uid()
          )
        )
      )
  )
) with check (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_conversations.organization_id
      and om.user_id = auth.uid()
      and (
        om.role in ('owner', 'office', 'manager')
        or (
          ai_conversations.case_id is not null
          and exists (
            select 1 from public.case_assignees ca
            where ca.case_id = ai_conversations.case_id
              and ca.user_id = auth.uid()
          )
        )
      )
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
      and (
        om.role in ('owner', 'office', 'manager')
        or (
          c.case_id is not null
          and exists (
            select 1 from public.case_assignees ca
            where ca.case_id = c.case_id
              and ca.user_id = auth.uid()
          )
        )
      )
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
      and (
        om.role in ('owner', 'office', 'manager')
        or (
          c.case_id is not null
          and exists (
            select 1 from public.case_assignees ca
            where ca.case_id = c.case_id
              and ca.user_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists ai_generated_artifacts_select on public.ai_generated_artifacts;
create policy ai_generated_artifacts_select on public.ai_generated_artifacts
for select using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_generated_artifacts.organization_id
      and om.user_id = auth.uid()
      and (
        om.role in ('owner', 'office', 'manager')
        or (
          ai_generated_artifacts.case_id is not null
          and exists (
            select 1 from public.case_assignees ca
            where ca.case_id = ai_generated_artifacts.case_id
              and ca.user_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists ai_generated_artifacts_insert on public.ai_generated_artifacts;
create policy ai_generated_artifacts_insert on public.ai_generated_artifacts
for insert with check (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = ai_generated_artifacts.organization_id
      and om.user_id = auth.uid()
      and (
        om.role in ('owner', 'office', 'manager')
        or (
          ai_generated_artifacts.case_id is not null
          and exists (
            select 1 from public.case_assignees ca
            where ca.case_id = ai_generated_artifacts.case_id
              and ca.user_id = auth.uid()
          )
        )
      )
  )
);

grant select, insert, update on public.ai_conversations to authenticated;
grant select, insert on public.ai_messages to authenticated;
grant select, insert on public.ai_generated_artifacts to authenticated;

create or replace function public.trg_touch_ai_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_conversations
  set last_message_at = NEW.created_at, updated_at = now()
  where id = NEW.conversation_id;
  return NEW;
end;
$$;

drop trigger if exists touch_ai_conversation on public.ai_messages;
create trigger touch_ai_conversation
after insert on public.ai_messages
for each row execute function public.trg_touch_ai_conversation();

select '0043_ai_assistant: OK' as migration_status;
