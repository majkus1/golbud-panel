-- Przypisanie wielu osób do sprawy (m2m).

create table if not exists public.case_assignees (
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (case_id, user_id)
);

create index if not exists case_assignees_case_idx on public.case_assignees(case_id);
create index if not exists case_assignees_user_idx on public.case_assignees(user_id);

alter table public.case_assignees enable row level security;

-- Każdy member organizacji może czytać przypisania spraw swojej org
create policy case_assignees_select on public.case_assignees
  for select using (
    exists (
      select 1 from public.cases c
      join public.organization_members om on om.organization_id = c.organization_id
      where c.id = case_assignees.case_id and om.user_id = auth.uid()
    )
  );

-- Dodawać mogą owner / office / manager
create policy case_assignees_insert on public.case_assignees
  for insert with check (
    exists (
      select 1 from public.cases c
      join public.organization_members om on om.organization_id = c.organization_id
      where c.id = case_assignees.case_id
        and om.user_id = auth.uid()
        and om.role in ('owner', 'office', 'manager')
    )
  );

-- Usuwać mogą owner / office / manager
create policy case_assignees_delete on public.case_assignees
  for delete using (
    exists (
      select 1 from public.cases c
      join public.organization_members om on om.organization_id = c.organization_id
      where c.id = case_assignees.case_id
        and om.user_id = auth.uid()
        and om.role in ('owner', 'office', 'manager')
    )
  );

grant all on public.case_assignees to authenticated;
