-- Wielu przypisanych do zadania (m2m).
-- Migruje też istniejące assignee_id -> junction table.

create table if not exists public.case_task_assignees (
  task_id uuid not null references public.case_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (task_id, user_id)
);

create index if not exists task_assignees_task_idx on public.case_task_assignees(task_id);
create index if not exists task_assignees_user_idx on public.case_task_assignees(user_id);

alter table public.case_task_assignees enable row level security;

create policy task_assignees_select on public.case_task_assignees
  for select using (
    exists (
      select 1 from public.case_tasks ct
      join public.organization_members om on om.organization_id = ct.organization_id
      where ct.id = case_task_assignees.task_id and om.user_id = auth.uid()
    )
  );

create policy task_assignees_insert on public.case_task_assignees
  for insert with check (
    exists (
      select 1 from public.case_tasks ct
      join public.organization_members om on om.organization_id = ct.organization_id
      where ct.id = case_task_assignees.task_id and om.user_id = auth.uid()
    )
  );

create policy task_assignees_delete on public.case_task_assignees
  for delete using (
    exists (
      select 1 from public.case_tasks ct
      join public.organization_members om on om.organization_id = ct.organization_id
      where ct.id = case_task_assignees.task_id and om.user_id = auth.uid()
    )
  );

grant all on public.case_task_assignees to authenticated;

-- Migracja istniejących przypisań
insert into public.case_task_assignees (task_id, user_id)
select id, assignee_id from public.case_tasks
where assignee_id is not null
on conflict do nothing;

-- Zaktualizuj politykę case_tasks_select — uwzględnij junction table dla sales/member
drop policy if exists case_tasks_select on public.case_tasks;
create policy case_tasks_select on public.case_tasks
  for select using (
    exists (
      select 1 from public.organization_members om
      where om.user_id = auth.uid()
        and om.organization_id = case_tasks.organization_id
        and (
          om.role in ('owner', 'office', 'manager')
          or case_tasks.assignee_id = auth.uid()
          or case_tasks.created_by = auth.uid()
          or exists (
            select 1 from public.case_task_assignees cta
            where cta.task_id = case_tasks.id and cta.user_id = auth.uid()
          )
        )
    )
  );
