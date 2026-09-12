-- Akord: pracownicy rozliczani wylacznie wg wykonanych jednostek pracy (nie godzin/dni/pensji).
-- Nowy slownik czynnosci akordowych (wzorowany na catalog_items), dziennik wykonanej pracy
-- (z migawka stawki w momencie wpisu - pozniejsza zmiana stawki w sowniku nie przepisuje historii,
-- dokladnie jak w kosztorysie powykonawczym) oraz rozszerzenie rozliczen miesiecznych i rentownosci.

create table if not exists public.piecework_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  unit text not null default 'szt.' check (unit in ('m²', 'mb', 'szt.', 'kpl.', 'roboczogodz.', 'usługa')),
  rate numeric not null default 0 check (rate >= 0),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists piecework_activities_org_idx on public.piecework_activities(organization_id, sort_order);

create table if not exists public.employee_piecework_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  activity_id uuid not null references public.piecework_activities(id) on delete restrict,
  case_id uuid references public.cases(id) on delete set null,
  quantity numeric not null check (quantity > 0),
  unit_rate_snapshot numeric not null default 0 check (unit_rate_snapshot >= 0),
  entry_date date not null default (now()::date),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists employee_piecework_entries_org_date_idx
  on public.employee_piecework_entries(organization_id, entry_date desc);
create index if not exists employee_piecework_entries_employee_idx
  on public.employee_piecework_entries(employee_id, entry_date desc);
create index if not exists employee_piecework_entries_case_idx
  on public.employee_piecework_entries(case_id);

-- Nowy dedykowany typ zatrudnienia: pracownik rozliczany wylacznie akordowo.
alter table public.employee_profiles drop constraint if exists employee_profiles_employment_type_check;
alter table public.employee_profiles add constraint employee_profiles_employment_type_check
  check (employment_type in ('godzinowka', 'dniowka', 'etat', 'ryczalt', 'b2b', 'podwykonawca', 'akord', 'inne'));

-- Snapshoty akordu na karcie miesiecznej (do raportu i rozbicia w UI).
alter table public.employee_monthly_settlements
  add column if not exists piecework_total numeric(12,2) not null default 0,
  add column if not exists piecework_quantity_total numeric(10,2) not null default 0;

alter table public.piecework_activities enable row level security;
alter table public.employee_piecework_entries enable row level security;

-- piecework_activities: odczyt dla kazdego czlonka organizacji (potrzebne brygadzisice do logowania
-- pracy), zarzadzanie (dodawanie/edycja/usuwanie czynnosci) tylko dla roli zarzadczej.
drop policy if exists piecework_activities_select on public.piecework_activities;
create policy piecework_activities_select on public.piecework_activities
for select using (
  public.is_member_of(organization_id)
);

drop policy if exists piecework_activities_manage on public.piecework_activities;
create policy piecework_activities_manage on public.piecework_activities
for all using (
  public.is_member_of(organization_id) and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id) and public.can_see_all_cases(organization_id)
);

-- employee_piecework_entries: dokladnie ten sam wzorzec dostepu co `work_hours`
-- (migracje 0027 i 0033) - wpisuje brygadzista lub zarzad, kazdy widzi swoje budowy.
drop policy if exists employee_piecework_entries_select on public.employee_piecework_entries;
create policy employee_piecework_entries_select on public.employee_piecework_entries
for select using (
  public.is_member_of(organization_id)
  and (
    public.can_see_all_cases(organization_id)
    or created_by = auth.uid()
    or (case_id is not null and public.can_access_case_in_org(case_id, organization_id))
    or (case_id is null and public.my_role_in(organization_id) = 'brygadzista')
  )
);

drop policy if exists employee_piecework_entries_write on public.employee_piecework_entries;
create policy employee_piecework_entries_write on public.employee_piecework_entries
for all using (
  public.can_edit_work_hours(organization_id)
  and (
    public.can_see_all_cases(organization_id)
    or created_by = auth.uid()
    or case_id is null
    or public.can_access_case_in_org(case_id, organization_id)
  )
)
with check (
  public.can_edit_work_hours(organization_id)
  and (
    public.can_see_all_cases(organization_id)
    or created_by = auth.uid()
    or case_id is null
    or public.can_access_case_in_org(case_id, organization_id)
  )
);

grant select, insert, update, delete on public.piecework_activities to authenticated;
grant select, insert, update, delete on public.employee_piecework_entries to authenticated;

-- Rozszerzenie kalkulacji rozliczenia miesiecznego o galaz akordowa oraz snapshoty ilosci/kwoty.
create or replace function public.refresh_employee_monthly_settlement(
  p_employee_id uuid,
  p_period_month date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  emp public.employee_profiles%rowtype;
  period_start date := date_trunc('month', p_period_month)::date;
  period_end date := (date_trunc('month', p_period_month) + interval '1 month')::date;
  existing public.employee_monthly_settlements%rowtype;
  total_hours numeric := 0;
  total_days integer := 0;
  piecework_amount numeric := 0;
  piecework_qty numeric := 0;
  base_value numeric := 0;
  bonuses numeric := 0;
  reimbursements numeric := 0;
  corrections_plus numeric := 0;
  deductions numeric := 0;
  corrections_minus numeric := 0;
  advances numeric := 0;
  previous_payments numeric := 0;
  gross_value numeric := 0;
  due_value numeric := 0;
  result_id uuid;
begin
  select * into emp from public.employee_profiles where id = p_employee_id;
  if emp.id is null then raise exception 'Nie znaleziono pracownika'; end if;
  if not (public.is_member_of(emp.organization_id) and public.can_see_all_cases(emp.organization_id)) then
    raise exception 'Brak uprawnien do rozliczen';
  end if;

  select * into existing
  from public.employee_monthly_settlements
  where organization_id = emp.organization_id and employee_id = emp.id and period_month = period_start;

  if existing.id is not null and existing.status <> 'draft' then
    return existing.id;
  end if;

  select coalesce(sum(wh.hours), 0), count(distinct wh.work_date)::integer
  into total_hours, total_days
  from public.work_hours wh
  where wh.organization_id = emp.organization_id
    and wh.work_date >= period_start and wh.work_date < period_end
    and wh.hours > 0
    and (
      wh.employee_id = emp.id
      or (
        wh.employee_id is null
        and lower(regexp_replace(trim(wh.worker_name), '\s+', ' ', 'g')) =
            lower(regexp_replace(trim(emp.full_name), '\s+', ' ', 'g'))
      )
    );

  select coalesce(sum(pe.quantity * pe.unit_rate_snapshot), 0), coalesce(sum(pe.quantity), 0)
  into piecework_amount, piecework_qty
  from public.employee_piecework_entries pe
  where pe.employee_id = emp.id
    and pe.entry_date >= period_start and pe.entry_date < period_end;

  if emp.employment_type = 'godzinowka' then
    base_value := total_hours * coalesce(emp.hourly_rate, 0);
  elsif emp.employment_type = 'dniowka' then
    base_value := total_days * coalesce(emp.day_rate, 0);
  elsif emp.employment_type = 'akord' then
    base_value := piecework_amount;
  elsif coalesce(emp.monthly_salary, 0) > 0 then
    base_value := emp.monthly_salary;
  else
    base_value := total_hours * coalesce(emp.hourly_rate, 0);
  end if;

  select
    coalesce(sum(amount) filter (where entry_type = 'premia'), 0),
    coalesce(sum(amount) filter (where entry_type = 'zwrot_kosztow'), 0),
    coalesce(sum(amount) filter (where entry_type = 'korekta' and direction = 'plus'), 0),
    coalesce(sum(amount) filter (where entry_type = 'potracenie'), 0),
    coalesce(sum(amount) filter (where entry_type = 'korekta' and direction = 'minus'), 0),
    coalesce(sum(amount) filter (where entry_type = 'zaliczka'), 0),
    coalesce(sum(amount) filter (where entry_type = 'wyplata'), 0)
  into bonuses, reimbursements, corrections_plus, deductions, corrections_minus, advances, previous_payments
  from public.employee_settlement_entries
  where employee_id = emp.id and entry_date >= period_start and entry_date < period_end;

  gross_value := base_value + bonuses + reimbursements + corrections_plus;
  due_value := greatest(0, gross_value - deductions - corrections_minus - advances - previous_payments);

  insert into public.employee_monthly_settlements (
    organization_id, employee_id, period_month, status,
    employment_type_snapshot, hourly_rate_snapshot, day_rate_snapshot, monthly_salary_snapshot,
    hours_total, work_days_total, piecework_total, piecework_quantity_total, base_amount, bonuses_total, reimbursements_total,
    corrections_plus_total, deductions_total, corrections_minus_total, advances_total,
    previous_payments_total, gross_earnings, amount_due, calculated_at, created_by
  ) values (
    emp.organization_id, emp.id, period_start, 'draft',
    emp.employment_type, coalesce(emp.hourly_rate, 0), coalesce(emp.day_rate, 0), coalesce(emp.monthly_salary, 0),
    round(total_hours, 2), total_days, round(piecework_amount, 2), round(piecework_qty, 2), round(base_value, 2), round(bonuses, 2), round(reimbursements, 2),
    round(corrections_plus, 2), round(deductions, 2), round(corrections_minus, 2), round(advances, 2),
    round(previous_payments, 2), round(gross_value, 2), round(due_value, 2), now(), auth.uid()
  )
  on conflict (organization_id, employee_id, period_month) do update set
    employment_type_snapshot = excluded.employment_type_snapshot,
    hourly_rate_snapshot = excluded.hourly_rate_snapshot,
    day_rate_snapshot = excluded.day_rate_snapshot,
    monthly_salary_snapshot = excluded.monthly_salary_snapshot,
    hours_total = excluded.hours_total,
    work_days_total = excluded.work_days_total,
    piecework_total = excluded.piecework_total,
    piecework_quantity_total = excluded.piecework_quantity_total,
    base_amount = excluded.base_amount,
    bonuses_total = excluded.bonuses_total,
    reimbursements_total = excluded.reimbursements_total,
    corrections_plus_total = excluded.corrections_plus_total,
    deductions_total = excluded.deductions_total,
    corrections_minus_total = excluded.corrections_minus_total,
    advances_total = excluded.advances_total,
    previous_payments_total = excluded.previous_payments_total,
    gross_earnings = excluded.gross_earnings,
    amount_due = excluded.amount_due,
    calculated_at = now()
  returning id into result_id;

  return result_id;
end;
$$;

select '0053_piecework_akord: OK' as migration_status;
