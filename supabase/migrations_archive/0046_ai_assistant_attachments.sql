-- Asystent AI: zalaczniki rozmow, odczyt plikow i raporty z plikow.

insert into storage.buckets (id, name, public)
values ('ai-attachments', 'ai-attachments', false)
on conflict (id) do nothing;

create table if not exists public.ai_message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  message_id uuid references public.ai_messages(id) on delete set null,
  case_id uuid references public.cases(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint not null default 0,
  extracted_text text,
  extraction_status text not null default 'ready' check (extraction_status in ('ready', 'partial', 'failed')),
  extraction_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, storage_path)
);

create index if not exists ai_message_attachments_conversation_idx on public.ai_message_attachments(conversation_id, created_at desc);
create index if not exists ai_message_attachments_message_idx on public.ai_message_attachments(message_id) where message_id is not null;
create index if not exists ai_message_attachments_case_idx on public.ai_message_attachments(case_id, created_at desc) where case_id is not null;

alter table public.ai_message_attachments enable row level security;

drop policy if exists ai_message_attachments_select on public.ai_message_attachments;
create policy ai_message_attachments_select on public.ai_message_attachments
for select using (
  exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
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

drop policy if exists ai_message_attachments_insert on public.ai_message_attachments;
create policy ai_message_attachments_insert on public.ai_message_attachments
for insert with check (
  exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
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

drop policy if exists ai_message_attachments_update on public.ai_message_attachments;
create policy ai_message_attachments_update on public.ai_message_attachments
for update using (
  exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
) with check (
  exists (
    select 1 from public.ai_conversations c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = ai_message_attachments.conversation_id
      and c.organization_id = ai_message_attachments.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

grant select, insert, update on public.ai_message_attachments to authenticated;

drop policy if exists "ai-attachments select" on storage.objects;
create policy "ai-attachments select"
on storage.objects for select to authenticated
using (
  bucket_id = 'ai-attachments'
  and public.uuid_or_null((storage.foldername(name))[1]) in (
    select om.organization_id
    from public.organization_members om
    where om.user_id = auth.uid()
  )
);

drop policy if exists "ai-attachments insert" on storage.objects;
create policy "ai-attachments insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ai-attachments'
  and public.uuid_or_null((storage.foldername(name))[1]) in (
    select om.organization_id
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists "ai-attachments update" on storage.objects;
create policy "ai-attachments update"
on storage.objects for update to authenticated
using (
  bucket_id = 'ai-attachments'
  and public.uuid_or_null((storage.foldername(name))[1]) in (
    select om.organization_id
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

drop policy if exists "ai-attachments delete" on storage.objects;
create policy "ai-attachments delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'ai-attachments'
  and public.uuid_or_null((storage.foldername(name))[1]) in (
    select om.organization_id
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
  )
);

select '0046_ai_assistant_attachments: OK' as migration_status;
