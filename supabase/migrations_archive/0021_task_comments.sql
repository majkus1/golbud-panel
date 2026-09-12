-- Dyskusja w zadaniach: komentarze z załącznikami + stan odczytu (nieprzeczytane) + realtime.
-- Idempotentna. Uruchom JEDEN RAZ w Supabase SQL Editor (po 0020).

-- ── Komentarze do zadań ───────────────────────────────────────────────────────
create table if not exists public.case_task_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.case_tasks(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  body text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists case_task_comments_task_idx on public.case_task_comments(task_id, created_at);
create index if not exists case_task_comments_org_idx on public.case_task_comments(organization_id, created_at);

-- ── Załączniki / zdjęcia w komentarzu ─────────────────────────────────────────
create table if not exists public.case_task_comment_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  comment_id uuid not null references public.case_task_comments(id) on delete cascade,
  task_id uuid not null references public.case_tasks(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists case_task_comment_attachments_comment_idx on public.case_task_comment_attachments(comment_id);

-- ── Stan odczytu wątku per użytkownik ─────────────────────────────────────────
create table if not exists public.case_task_reads (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.case_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists case_task_reads_user_idx on public.case_task_reads(user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.case_task_comments enable row level security;
alter table public.case_task_comment_attachments enable row level security;
alter table public.case_task_reads enable row level security;

-- Komentarze: widoczne dla członków org, którzy widzą dane zadanie (spójnie z case_tasks_select).
drop policy if exists case_task_comments_select on public.case_task_comments;
create policy case_task_comments_select on public.case_task_comments
for select using (
  public.is_member_of(organization_id)
  and exists (
    select 1 from public.case_tasks ct
    where ct.id = case_task_comments.task_id
      and (
        public.can_see_all_cases(ct.organization_id)
        or ct.assignee_id = auth.uid()
        or ct.created_by = auth.uid()
        or public.is_task_assignee(ct.id)
      )
  )
);

drop policy if exists case_task_comments_insert on public.case_task_comments;
create policy case_task_comments_insert on public.case_task_comments
for insert with check (
  public.is_member_of(organization_id)
  and user_id = auth.uid()
);

drop policy if exists case_task_comments_delete on public.case_task_comments;
create policy case_task_comments_delete on public.case_task_comments
for delete using (user_id = auth.uid());

-- Załączniki komentarzy: zgodnie z dostępem do komentarza.
drop policy if exists case_task_comment_attachments_select on public.case_task_comment_attachments;
create policy case_task_comment_attachments_select on public.case_task_comment_attachments
for select using (
  exists (
    select 1 from public.case_task_comments c
    where c.id = case_task_comment_attachments.comment_id
      and public.is_member_of(c.organization_id)
  )
);

drop policy if exists case_task_comment_attachments_insert on public.case_task_comment_attachments;
create policy case_task_comment_attachments_insert on public.case_task_comment_attachments
for insert with check (
  public.is_member_of(organization_id)
  and exists (
    select 1 from public.case_task_comments c
    where c.id = case_task_comment_attachments.comment_id and c.user_id = auth.uid()
  )
);

drop policy if exists case_task_comment_attachments_delete on public.case_task_comment_attachments;
create policy case_task_comment_attachments_delete on public.case_task_comment_attachments
for delete using (
  exists (
    select 1 from public.case_task_comments c
    where c.id = case_task_comment_attachments.comment_id and c.user_id = auth.uid()
  )
);

-- Stan odczytu: każdy zarządza tylko własnym.
drop policy if exists case_task_reads_all on public.case_task_reads;
create policy case_task_reads_all on public.case_task_reads
for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member_of(organization_id));

grant select, insert, update, delete on public.case_task_comments to authenticated;
grant select, insert, update, delete on public.case_task_comment_attachments to authenticated;
grant select, insert, update, delete on public.case_task_reads to authenticated;

-- ── Realtime: włącz nasłuch zmian komentarzy ─────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'case_task_comments'
  ) then
    alter publication supabase_realtime add table public.case_task_comments;
  end if;
end$$;
