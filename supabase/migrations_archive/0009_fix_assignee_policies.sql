-- Fix: rekursja w politykach RLS na case_tasks <-> case_task_assignees.
--
-- Polityka case_tasks_select w migracji 0007 odwołuje się do case_task_assignees,
-- a polityka case_task_assignees_select odwołuje się do case_tasks. PostgreSQL
-- wykonuje to rekurencyjnie i zapytania kończą się błędem 500.
--
-- Rozwiązanie: użyć funkcji SECURITY DEFINER, które omijają RLS (dokładnie ten sam
-- wzorzec, który już działa dla is_member_of / is_owner_of na organization_members).
--
-- Uruchom JEDEN RAZ w Supabase SQL Editor. Bezpieczne, idempotentne.

-- 1) Helper: czy bieżący user jest przypisany do zadania
create or replace function public.is_task_assignee(target_task uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.case_task_assignees
    where task_id = target_task and user_id = auth.uid()
  );
$$;

revoke all on function public.is_task_assignee(uuid) from public;
grant execute on function public.is_task_assignee(uuid) to authenticated;

-- 2) Helper: czy bieżący user jest przypisany do sprawy
create or replace function public.is_case_assignee(target_case uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.case_assignees
    where case_id = target_case and user_id = auth.uid()
  );
$$;

revoke all on function public.is_case_assignee(uuid) from public;
grant execute on function public.is_case_assignee(uuid) to authenticated;

-- 3) Helper: rola bieżącego usera w organizacji
create or replace function public.my_role_in(target_org uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.organization_members
  where user_id = auth.uid() and organization_id = target_org
  limit 1;
$$;

revoke all on function public.my_role_in(uuid) from public;
grant execute on function public.my_role_in(uuid) to authenticated;

-- 4) Polityka case_tasks_select bez rekursji
drop policy if exists case_tasks_select on public.case_tasks;
create policy case_tasks_select on public.case_tasks
  for select using (
    public.is_member_of(organization_id)
    and (
      public.my_role_in(organization_id) in ('owner', 'office', 'manager')
      or assignee_id = auth.uid()
      or created_by = auth.uid()
      or public.is_task_assignee(id)
    )
  );

-- 5) Polityki case_task_assignees — używają is_member_of zamiast joinu z case_tasks
drop policy if exists task_assignees_select on public.case_task_assignees;
drop policy if exists task_assignees_insert on public.case_task_assignees;
drop policy if exists task_assignees_delete on public.case_task_assignees;

create policy task_assignees_select on public.case_task_assignees
  for select using (
    exists (
      select 1 from public.case_tasks ct
      where ct.id = case_task_assignees.task_id
        and public.is_member_of(ct.organization_id)
    )
  );

create policy task_assignees_insert on public.case_task_assignees
  for insert with check (
    exists (
      select 1 from public.case_tasks ct
      where ct.id = case_task_assignees.task_id
        and public.is_member_of(ct.organization_id)
    )
  );

create policy task_assignees_delete on public.case_task_assignees
  for delete using (
    exists (
      select 1 from public.case_tasks ct
      where ct.id = case_task_assignees.task_id
        and public.is_member_of(ct.organization_id)
    )
  );

-- 6) Polityki case_assignees — analogicznie, przez SECURITY DEFINER helpery
drop policy if exists case_assignees_select on public.case_assignees;
drop policy if exists case_assignees_insert on public.case_assignees;
drop policy if exists case_assignees_delete on public.case_assignees;

create policy case_assignees_select on public.case_assignees
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = case_assignees.case_id
        and public.is_member_of(c.organization_id)
    )
  );

create policy case_assignees_insert on public.case_assignees
  for insert with check (
    exists (
      select 1 from public.cases c
      where c.id = case_assignees.case_id
        and public.my_role_in(c.organization_id) in ('owner', 'office', 'manager')
    )
  );

create policy case_assignees_delete on public.case_assignees
  for delete using (
    exists (
      select 1 from public.cases c
      where c.id = case_assignees.case_id
        and public.my_role_in(c.organization_id) in ('owner', 'office', 'manager')
    )
  );
