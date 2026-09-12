-- Kalendarz firmy: pracownik ma widziec WLASNE terminy BHP/badan, a brygadzista
-- terminy osob z wlasnej brygady (ten sam crew_id) lub bezposrednich podwladnych
-- (manager_employee_id). Podwykonawca (rola zewnetrzna) nie ma dostepu w ogole.
--
-- Wazne: NIE rozszerzamy zwyklej polityki RLS na cala tabele employee_profiles /
-- employee_documents, bo te tabele zawieraja wrazliwe dane (stawki godzinowe,
-- wynagrodzenie miesieczne, telefon, notatki, umowy, zalaczniki) ktore inne
-- zapytania w apce pobieraja przez `select("*")` (np. /time). Gdyby polityka RLS
-- pozwolila brygadziscie SELECT-owac wiersze kolegow z brygady, kazde takie
-- zapytanie ujawnilyby rowniez ich wynagrodzenie. Zamiast tego udostepniamy dwie
-- funkcje SECURITY DEFINER, ktore zwracaja wylacznie bezpieczne kolumny potrzebne
-- do terminow w kalendarzu — baza tabel zostaje bez zmian (nadal tylko
-- owner/office/manager maja bezposredni dostep SELECT/INSERT/UPDATE/DELETE).

create or replace function public.can_view_employee_hr(target_employee_id uuid, target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.employee_profiles target
    where target.id = target_employee_id
      and target.organization_id = target_org
      and public.is_member_of(target_org)
      and (
        public.can_see_all_cases(target_org)
        or target.user_id = auth.uid()
        or (
          public.my_role_in(target_org) = 'brygadzista'
          and exists (
            select 1
            from public.employee_profiles me
            where me.organization_id = target_org
              and me.user_id = auth.uid()
              and (
                (me.crew_id is not null and me.crew_id = target.crew_id)
                or target.manager_employee_id = me.id
              )
          )
        )
      )
  );
$$;

revoke all on function public.can_view_employee_hr(uuid, uuid) from public;
grant execute on function public.can_view_employee_hr(uuid, uuid) to authenticated;

create or replace function public.employee_hr_profiles_visible(target_org uuid)
returns table (
  id uuid,
  full_name text,
  crew_id uuid,
  manager_employee_id uuid,
  bhp_valid_until date,
  medical_valid_until date
)
language sql
security definer
stable
set search_path = public
as $$
  select ep.id, ep.full_name, ep.crew_id, ep.manager_employee_id, ep.bhp_valid_until, ep.medical_valid_until
  from public.employee_profiles ep
  where ep.organization_id = target_org
    and ep.active
    and public.can_view_employee_hr(ep.id, target_org);
$$;

revoke all on function public.employee_hr_profiles_visible(uuid) from public;
grant execute on function public.employee_hr_profiles_visible(uuid) to authenticated;

-- Tylko typy dokumentow istotne dla terminow odnawialnych (bez umow, anekso i
-- innych zalacznikow) — spojnie z lib/hr.ts RENEWABLE_DOCUMENT_TYPES.
create or replace function public.employee_hr_documents_visible(target_org uuid)
returns table (
  id uuid,
  employee_id uuid,
  document_type text,
  title text,
  valid_until date,
  requires_renewal boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select d.id, d.employee_id, d.document_type, d.title, d.valid_until, d.requires_renewal
  from public.employee_documents d
  where d.organization_id = target_org
    and d.status = 'active'
    and d.requires_renewal
    and d.document_type in ('bhp', 'medical', 'training', 'qualification', 'certificate')
    and public.can_view_employee_hr(d.employee_id, target_org);
$$;

revoke all on function public.employee_hr_documents_visible(uuid) from public;
grant execute on function public.employee_hr_documents_visible(uuid) to authenticated;
