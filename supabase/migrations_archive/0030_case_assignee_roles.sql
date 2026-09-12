-- Rozróżnienie: odpowiedzialni (lead) vs przypisani do realizacji (field).
-- Oba typy dają widoczność sprawy (RLS is_case_assignee); UI i powiadomienia rozdzielone.

alter table public.case_assignees
  add column if not exists assignment_role text not null default 'field'
  check (assignment_role in ('lead', 'field'));

comment on column public.case_assignees.assignment_role is
  'lead = odpowiedzialny (prowadzący sprawę); field = przypisany do realizacji (teren)';

-- Handlowiec może zarządzać zespołem na sprawach, które utworzył lub które prowadzi.
drop policy if exists case_assignees_insert on public.case_assignees;
create policy case_assignees_insert on public.case_assignees
for insert with check (
  exists (
    select 1 from public.cases c
    where c.id = case_assignees.case_id
      and public.is_member_of(c.organization_id)
      and (
        public.my_role_in(c.organization_id) in ('owner', 'office', 'manager')
        or (
          public.my_role_in(c.organization_id) = 'sales'
          and (c.created_by = auth.uid() or public.is_case_assignee(c.id))
        )
      )
  )
);

drop policy if exists case_assignees_delete on public.case_assignees;
create policy case_assignees_delete on public.case_assignees
for delete using (
  exists (
    select 1 from public.cases c
    where c.id = case_assignees.case_id
      and public.is_member_of(c.organization_id)
      and (
        public.my_role_in(c.organization_id) in ('owner', 'office', 'manager')
        or (
          public.my_role_in(c.organization_id) = 'sales'
          and (c.created_by = auth.uid() or public.is_case_assignee(c.id))
        )
      )
  )
);

-- Aktualizacja roli (np. przeniesienie między listami w edycji).
drop policy if exists case_assignees_update on public.case_assignees;
create policy case_assignees_update on public.case_assignees
for update using (
  exists (
    select 1 from public.cases c
    where c.id = case_assignees.case_id
      and public.is_member_of(c.organization_id)
      and (
        public.my_role_in(c.organization_id) in ('owner', 'office', 'manager')
        or (
          public.my_role_in(c.organization_id) = 'sales'
          and (c.created_by = auth.uid() or public.is_case_assignee(c.id))
        )
      )
  )
)
with check (
  exists (
    select 1 from public.cases c
    where c.id = case_assignees.case_id
      and public.is_member_of(c.organization_id)
      and (
        public.my_role_in(c.organization_id) in ('owner', 'office', 'manager')
        or (
          public.my_role_in(c.organization_id) = 'sales'
          and (c.created_by = auth.uid() or public.is_case_assignee(c.id))
        )
      )
  )
);
