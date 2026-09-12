-- Czytelny katalog członków organizacji i uzupełnienie prowadzących handlowców.
-- Funkcja zwraca wyłącznie bezpieczne dane identyfikacyjne, bez pól HR i wynagrodzeń.

create or replace function public.organization_member_directory(target_org uuid)
returns table (
  organization_id uuid,
  user_id uuid,
  role text,
  email text,
  display_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    member.organization_id,
    member.user_id,
    member.role,
    directory.email,
    coalesce(
      nullif(btrim(employee.full_name), ''),
      nullif(directory.email, ''),
      member.user_id::text
    ) as display_name
  from public.organization_members member
  join public.user_directory_profiles directory on directory.user_id = member.user_id
  left join public.employee_profiles employee
    on employee.organization_id = member.organization_id
   and employee.user_id = member.user_id
  where member.organization_id = target_org
    and public.is_member_of(target_org);
$$;

revoke all on function public.organization_member_directory(uuid) from public, anon;
grant execute on function public.organization_member_directory(uuid) to authenticated;

-- Jeżeli autor-handlowiec był już przypisany terenowo, awansuj przypisanie do lead.
-- Nie dotykaj spraw, które mają już jawnie wskazaną osobę prowadzącą.
update public.case_assignees assignee
set assignment_role = 'lead'
from public.cases case_row
join public.organization_members member
  on member.organization_id = case_row.organization_id
 and member.user_id = case_row.created_by
 and member.role = 'sales'
where assignee.case_id = case_row.id
  and assignee.user_id = case_row.created_by
  and not exists (
    select 1
    from public.case_assignees existing_lead
    where existing_lead.case_id = case_row.id
      and existing_lead.assignment_role = 'lead'
  );

-- Dla pozostałych historycznych spraw bez prowadzącego dopisz autora-handlowca.
insert into public.case_assignees (case_id, user_id, assignment_role)
select case_row.id, case_row.created_by, 'lead'
from public.cases case_row
join public.organization_members member
  on member.organization_id = case_row.organization_id
 and member.user_id = case_row.created_by
 and member.role = 'sales'
where case_row.created_by is not null
  and not exists (
    select 1
    from public.case_assignees existing_lead
    where existing_lead.case_id = case_row.id
      and existing_lead.assignment_role = 'lead'
  )
on conflict (case_id, user_id) do nothing;

