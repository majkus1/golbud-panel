-- Daty zatrudnienia od–do w kartotece pracownika (prośba z 7.08).
--
-- Koniec umowy trafia do kalendarza jako termin kadrowy. Funkcja
-- `employee_hr_profiles_visible` (kalendarz) oddaje datę końca tylko zarządowi
-- i samemu pracownikowi — brygadzista widzi terminy BHP i badań swojej brygady,
-- ale nie to, do kiedy kto ma umowę.

alter table public.employee_profiles
  add column if not exists employment_start_date date,
  add column if not exists employment_end_date date;

alter table public.employee_profiles drop constraint if exists employee_profiles_employment_dates_check;
alter table public.employee_profiles
  add constraint employee_profiles_employment_dates_check
  check (employment_start_date is null or employment_end_date is null or employment_end_date >= employment_start_date);

-- Zmiana typu zwracanego wymaga usunięcia funkcji; uprawnienia jak w baseline.
drop function if exists public.employee_hr_profiles_visible(uuid);

create function public.employee_hr_profiles_visible(target_org uuid)
  returns table (
    id uuid,
    full_name text,
    crew_id uuid,
    manager_employee_id uuid,
    bhp_valid_until date,
    medical_valid_until date,
    employment_end_date date
  )
  language sql stable security definer
  set search_path to 'public'
as $$
  select
    ep.id,
    ep.full_name,
    ep.crew_id,
    ep.manager_employee_id,
    ep.bhp_valid_until,
    ep.medical_valid_until,
    case
      when public.my_role_in(target_org) = any (array['owner', 'office', 'manager']) or ep.user_id = auth.uid()
        then ep.employment_end_date
    end
  from public.employee_profiles ep
  where ep.organization_id = target_org
    and ep.active
    and public.can_view_employee_hr(ep.id, target_org);
$$;

alter function public.employee_hr_profiles_visible(uuid) owner to postgres;
revoke all on function public.employee_hr_profiles_visible(uuid) from public;
grant all on function public.employee_hr_profiles_visible(uuid) to anon;
grant all on function public.employee_hr_profiles_visible(uuid) to authenticated;
grant all on function public.employee_hr_profiles_visible(uuid) to service_role;

notify pgrst, 'reload schema';
