-- Wynagrodzenia sa osobna domena uprawnien. Biuro zachowuje HR i finanse
-- operacyjne, ale nie moze czytac ani zmieniac danych placowych.

create or replace function public.can_view_payroll(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_member_of(target_org)
    and public.my_role_in(target_org) in ('owner', 'manager');
$$;

revoke all on function public.can_view_payroll(uuid) from public;
grant execute on function public.can_view_payroll(uuid) to authenticated;

create or replace function public.can_view_labor_costs(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_member_of(target_org)
    and public.my_role_in(target_org) in ('owner', 'office', 'manager');
$$;

revoke all on function public.can_view_labor_costs(uuid) from public;
grant execute on function public.can_view_labor_costs(uuid) to authenticated;

create table if not exists public.employee_compensation (
  employee_id uuid primary key references public.employee_profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  hourly_rate numeric check (hourly_rate is null or hourly_rate >= 0),
  day_rate numeric check (day_rate is null or day_rate >= 0),
  monthly_salary numeric check (monthly_salary is null or monthly_salary >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_id)
);

create index if not exists employee_compensation_org_idx
  on public.employee_compensation(organization_id);

insert into public.employee_compensation (
  employee_id, organization_id, hourly_rate, day_rate, monthly_salary, created_by, updated_by
)
select id, organization_id, hourly_rate, day_rate, monthly_salary, created_by, created_by
from public.employee_profiles
on conflict (employee_id) do update set
  organization_id = excluded.organization_id,
  hourly_rate = excluded.hourly_rate,
  day_rate = excluded.day_rate,
  monthly_salary = excluded.monthly_salary,
  updated_at = now();

do $$
begin
  if (select count(*) from public.employee_profiles) <>
     (select count(*) from public.employee_compensation)
     or exists (
       select 1
       from public.employee_profiles ep
       left join public.employee_compensation ec on ec.employee_id = ep.id
       where ec.employee_id is null
          or ec.organization_id is distinct from ep.organization_id
          or ec.hourly_rate is distinct from ep.hourly_rate
          or ec.day_rate is distinct from ep.day_rate
          or ec.monthly_salary is distinct from ep.monthly_salary
     ) then
    raise exception 'Nie przeniesiono wszystkich stawek pracownikow';
  end if;
end;
$$;

alter table public.employee_compensation enable row level security;

drop policy if exists employee_compensation_payroll on public.employee_compensation;
create policy employee_compensation_payroll on public.employee_compensation
for all using (public.can_view_payroll(organization_id))
with check (
  public.can_view_payroll(organization_id)
  and exists (
    select 1 from public.employee_profiles ep
    where ep.id = employee_id and ep.organization_id = organization_id
  )
);

grant select, insert, update, delete on public.employee_compensation to authenticated;

create or replace function public.save_employee_compensation(
  target_org uuid,
  target_employee uuid,
  target_hourly_rate numeric,
  target_day_rate numeric,
  target_monthly_salary numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_payroll(target_org) then
    raise exception 'Brak uprawnien do wynagrodzen';
  end if;
  if coalesce(target_hourly_rate, 0) < 0
     or coalesce(target_day_rate, 0) < 0
     or coalesce(target_monthly_salary, 0) < 0 then
    raise exception 'Stawka nie moze byc ujemna';
  end if;
  if not exists (
    select 1 from public.employee_profiles ep
    where ep.id = target_employee and ep.organization_id = target_org
  ) then
    raise exception 'Nie znaleziono pracownika w organizacji';
  end if;

  insert into public.employee_compensation (
    employee_id, organization_id, hourly_rate, day_rate, monthly_salary,
    created_by, updated_by
  ) values (
    target_employee, target_org, target_hourly_rate, target_day_rate,
    target_monthly_salary, auth.uid(), auth.uid()
  )
  on conflict (employee_id) do update set
    hourly_rate = excluded.hourly_rate,
    day_rate = excluded.day_rate,
    monthly_salary = excluded.monthly_salary,
    updated_by = auth.uid(),
    updated_at = now()
  where public.employee_compensation.organization_id = target_org;
end;
$$;

revoke all on function public.save_employee_compensation(uuid, uuid, numeric, numeric, numeric) from public;
grant execute on function public.save_employee_compensation(uuid, uuid, numeric, numeric, numeric) to authenticated;

-- Bezpieczna agregacja do rentownosci. Nie zwraca pracownika, stawki ani skladnika placy.
create or replace function public.payroll_labor_costs_aggregated(target_org uuid)
returns table (case_id uuid, cost_date date, amount numeric)
language sql
security definer
stable
set search_path = public
as $$
  with matched_hours as (
    select wh.id, wh.case_id, wh.work_date, wh.hours, ep.id as employee_id,
      ep.employment_type, ec.hourly_rate, ec.day_rate, ec.monthly_salary
    from public.work_hours wh
    join public.employee_profiles ep on ep.organization_id = wh.organization_id
      and (ep.id = wh.employee_id or (wh.employee_id is null and lower(regexp_replace(trim(wh.worker_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(ep.full_name), '\s+', ' ', 'g'))))
    left join public.employee_compensation ec on ec.employee_id = ep.id and ec.organization_id = ep.organization_id
    where wh.organization_id = target_org and wh.case_id is not null and wh.hours > 0
  ),
  month_hours as (
    select employee_id, date_trunc('month', work_date)::date as month_start, sum(hours) as total
    from matched_hours group by employee_id, date_trunc('month', work_date)::date
  ),
  day_hours as (
    select employee_id, work_date, sum(hours) as total
    from matched_hours group by employee_id, work_date
  ),
  hour_costs as (
    select mh.case_id, mh.work_date as cost_date,
      case
        when ms.id is not null and mon.total > 0 then ms.base_amount * (mh.hours / mon.total)
        when mh.employment_type = 'godzinowka' then mh.hours * coalesce(mh.hourly_rate, 0)
        when mh.employment_type = 'dniowka' and dy.total > 0 then coalesce(mh.day_rate, 0) * (mh.hours / dy.total)
        when coalesce(mh.monthly_salary, 0) > 0 and mon.total > 0 then mh.monthly_salary * (mh.hours / mon.total)
        else mh.hours * coalesce(mh.hourly_rate, 0)
      end as amount
    from matched_hours mh
    join month_hours mon on mon.employee_id = mh.employee_id and mon.month_start = date_trunc('month', mh.work_date)::date
    join day_hours dy on dy.employee_id = mh.employee_id and dy.work_date = mh.work_date
    left join public.employee_monthly_settlements ms on ms.employee_id = mh.employee_id
      and ms.organization_id = target_org and ms.period_month = mon.month_start
  ),
  settlement_costs as (
    select ese.case_id, ese.entry_date as cost_date,
      case
        when ese.entry_type = 'potracenie' or (ese.entry_type = 'korekta' and ese.direction = 'minus') then -ese.amount
        when ese.entry_type in ('zaliczka', 'wyplata') then 0
        else ese.amount
      end as amount
    from public.employee_settlement_entries ese
    where ese.organization_id = target_org and ese.case_id is not null
  ),
  piecework_costs as (
    select epe.case_id, epe.entry_date as cost_date, epe.quantity * epe.unit_rate_snapshot as amount
    from public.employee_piecework_entries epe
    where epe.organization_id = target_org and epe.case_id is not null
  )
  select costs.case_id, costs.cost_date, round(sum(costs.amount), 2) as amount
  from (
    select * from hour_costs
    union all select * from settlement_costs
    union all select * from piecework_costs
  ) costs
  where public.can_view_labor_costs(target_org)
  group by costs.case_id, costs.cost_date
  order by costs.cost_date, costs.case_id;
$$;

revoke all on function public.payroll_labor_costs_aggregated(uuid) from public;
grant execute on function public.payroll_labor_costs_aggregated(uuid) to authenticated;

-- Tabele rozliczen indywidualnych sa dostepne tylko dla wlasciciela i kierownika.
drop policy if exists employee_settlement_entries_manage on public.employee_settlement_entries;
drop policy if exists employee_settlement_entries_payroll on public.employee_settlement_entries;
create policy employee_settlement_entries_payroll on public.employee_settlement_entries
for all using (public.can_view_payroll(organization_id))
with check (
  public.can_view_payroll(organization_id)
  and exists (
    select 1 from public.employee_profiles ep
    where ep.id = employee_id and ep.organization_id = organization_id
  )
);

drop policy if exists employee_monthly_settlements_manage on public.employee_monthly_settlements;
drop policy if exists employee_monthly_settlements_payroll on public.employee_monthly_settlements;
create policy employee_monthly_settlements_payroll on public.employee_monthly_settlements
for all using (public.can_view_payroll(organization_id))
with check (
  public.can_view_payroll(organization_id)
  and exists (
    select 1 from public.employee_profiles ep
    where ep.id = employee_id and ep.organization_id = organization_id
  )
);

drop policy if exists employee_settlement_history_select on public.employee_settlement_history;
drop policy if exists employee_settlement_history_payroll on public.employee_settlement_history;
create policy employee_settlement_history_payroll on public.employee_settlement_history
for select using (public.can_view_payroll(organization_id));

-- Stawka akordowa jest placowa. Tabela z kwotami jest prywatna, a role
-- operacyjne dostaja osobne RPC bez stawki.
drop policy if exists piecework_activities_select on public.piecework_activities;
drop policy if exists piecework_activities_manage on public.piecework_activities;
drop policy if exists piecework_activities_payroll on public.piecework_activities;
create policy piecework_activities_payroll on public.piecework_activities
for all using (public.can_view_payroll(organization_id))
with check (public.can_view_payroll(organization_id));

drop policy if exists employee_piecework_entries_select on public.employee_piecework_entries;
drop policy if exists employee_piecework_entries_write on public.employee_piecework_entries;
drop policy if exists employee_piecework_entries_payroll on public.employee_piecework_entries;
create policy employee_piecework_entries_payroll on public.employee_piecework_entries
for all using (public.can_view_payroll(organization_id))
with check (public.can_view_payroll(organization_id));

create or replace function public.piecework_activities_operational(target_org uuid)
returns table (
  id uuid, organization_id uuid, name text, unit text, sort_order integer,
  active boolean, created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select pa.id, pa.organization_id, pa.name, pa.unit, pa.sort_order, pa.active, pa.created_at
  from public.piecework_activities pa
  where pa.organization_id = target_org
    and public.is_member_of(target_org)
  order by pa.sort_order, pa.name;
$$;

revoke all on function public.piecework_activities_operational(uuid) from public;
grant execute on function public.piecework_activities_operational(uuid) to authenticated;

create or replace function public.employee_work_profiles_visible(target_org uuid)
returns table (
  id uuid, organization_id uuid, full_name text, crew_id uuid,
  employment_type text, active boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select ep.id, ep.organization_id, ep.full_name, ep.crew_id, ep.employment_type, ep.active
  from public.employee_profiles ep
  where ep.organization_id = target_org
    and ep.active
    and public.can_edit_work_hours(target_org)
  order by ep.full_name;
$$;

revoke all on function public.employee_work_profiles_visible(uuid) from public;
grant execute on function public.employee_work_profiles_visible(uuid) to authenticated;

create or replace function public.employee_piecework_entries_operational(
  target_org uuid, date_from date, date_to date
)
returns table (
  id uuid, organization_id uuid, employee_id uuid, activity_id uuid,
  case_id uuid, quantity numeric, entry_date date, note text,
  created_by uuid, created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select pe.id, pe.organization_id, pe.employee_id, pe.activity_id,
    pe.case_id, pe.quantity, pe.entry_date, pe.note, pe.created_by, pe.created_at
  from public.employee_piecework_entries pe
  where pe.organization_id = target_org
    and pe.entry_date between date_from and date_to
    and public.is_member_of(target_org)
    and (
      public.can_view_payroll(target_org)
      or public.can_see_all_cases(target_org)
      or pe.created_by = auth.uid()
      or (pe.case_id is not null and public.can_access_case_in_org(pe.case_id, target_org))
      or (pe.case_id is null and public.my_role_in(target_org) = 'brygadzista')
    )
  order by pe.entry_date desc, pe.created_at desc;
$$;

revoke all on function public.employee_piecework_entries_operational(uuid, date, date) from public;
grant execute on function public.employee_piecework_entries_operational(uuid, date, date) to authenticated;

create or replace function public.add_employee_piecework_entry(
  target_org uuid,
  target_employee uuid,
  target_activity uuid,
  target_case uuid,
  target_quantity numeric,
  target_date date,
  target_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  activity_rate numeric;
  result_id uuid;
begin
  if not public.can_edit_work_hours(target_org) then
    raise exception 'Brak uprawnien do rejestrowania pracy';
  end if;
  if target_quantity is null or target_quantity <= 0 then
    raise exception 'Ilosc musi byc wieksza od zera';
  end if;
  if target_case is not null
     and not (public.can_see_all_cases(target_org) or public.can_access_case_in_org(target_case, target_org)) then
    raise exception 'Brak dostepu do sprawy';
  end if;
  if not exists (
    select 1 from public.employee_profiles ep
    where ep.id = target_employee and ep.organization_id = target_org and ep.active
  ) then
    raise exception 'Nie znaleziono pracownika w organizacji';
  end if;
  select pa.rate into activity_rate
  from public.piecework_activities pa
  where pa.id = target_activity and pa.organization_id = target_org and pa.active;
  if activity_rate is null then
    raise exception 'Nie znaleziono czynnosci akordowej';
  end if;

  insert into public.employee_piecework_entries (
    organization_id, employee_id, activity_id, case_id, quantity,
    unit_rate_snapshot, entry_date, note, created_by
  ) values (
    target_org, target_employee, target_activity, target_case, target_quantity,
    activity_rate, coalesce(target_date, current_date), nullif(trim(target_note), ''), auth.uid()
  ) returning id into result_id;
  return result_id;
end;
$$;

revoke all on function public.add_employee_piecework_entry(uuid, uuid, uuid, uuid, numeric, date, text) from public;
grant execute on function public.add_employee_piecework_entry(uuid, uuid, uuid, uuid, numeric, date, text) to authenticated;

create or replace function public.delete_employee_piecework_entry(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data public.employee_piecework_entries%rowtype;
begin
  select * into row_data from public.employee_piecework_entries where id = target_id;
  if row_data.id is null then return; end if;
  if not public.is_member_of(row_data.organization_id)
     or not (
       public.can_view_payroll(row_data.organization_id)
       or public.can_see_all_cases(row_data.organization_id)
       or (public.can_edit_work_hours(row_data.organization_id) and row_data.created_by = auth.uid())
     ) then
    raise exception 'Brak uprawnien do usuniecia wpisu';
  end if;
  delete from public.employee_piecework_entries where id = target_id;
end;
$$;

revoke all on function public.delete_employee_piecework_entry(uuid) from public;
grant execute on function public.delete_employee_piecework_entry(uuid) to authenticated;

-- Reczne pozycje rozliczen pracownikow w raporcie finansowym rowniez sa placowe.
drop policy if exists financial_control_items_manage on public.financial_control_items;
drop policy if exists financial_control_items_select on public.financial_control_items;
drop policy if exists financial_control_items_insert on public.financial_control_items;
drop policy if exists financial_control_items_update on public.financial_control_items;
drop policy if exists financial_control_items_delete on public.financial_control_items;
create policy financial_control_items_select on public.financial_control_items
for select using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
  and (section <> 'employee_settlement' or public.can_view_payroll(organization_id))
);
create policy financial_control_items_insert on public.financial_control_items
for insert with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
  and (section <> 'employee_settlement' or public.can_view_payroll(organization_id))
);
create policy financial_control_items_update on public.financial_control_items
for update using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
  and (section <> 'employee_settlement' or public.can_view_payroll(organization_id))
) with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
  and (section <> 'employee_settlement' or public.can_view_payroll(organization_id))
);
create policy financial_control_items_delete on public.financial_control_items
for delete using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
  and (section <> 'employee_settlement' or public.can_view_payroll(organization_id))
);

-- Logi placowe sa filtrowane w bazie, nie tylko w interfejsie.
alter table public.organization_activity_log
  add column if not exists data_scope text not null default 'operational'
  check (data_scope in ('operational', 'payroll'));

update public.organization_activity_log
set data_scope = 'payroll'
where action in ('employee_rates_changed', 'employee_compensation_changed')
   or entity_type in ('employee_monthly_settlement', 'employee_settlement_entry', 'employee_compensation');

drop policy if exists org_activity_log_select on public.organization_activity_log;
create policy org_activity_log_select on public.organization_activity_log
for select using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
  and (data_scope = 'operational' or public.can_view_payroll(organization_id))
);

-- Trigger profilu nie moze juz odnosic sie do kolumn przeniesionych do tabeli prywatnej.
create or replace function public.trg_log_employee_profile_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.hr_compliance_from_document', true) = 'true' then return NEW; end if;
  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'hr', 'employee_created', 'Dodano pracownika: ' || NEW.full_name,
      NEW.role_title || ' · ' || NEW.department || case when NEW.has_system_access then ' · ma dostep do systemu' else ' · bez dostepu' end,
      null, 'employee_profile', NEW.id,
      jsonb_build_object('department', NEW.department, 'role_title', NEW.role_title, 'has_system_access', NEW.has_system_access), NEW.created_by
    );
  elsif TG_OP = 'UPDATE' then
    if OLD.active = true and NEW.active = false then
      perform public.log_organization_activity(NEW.organization_id, 'hr', 'employee_archived', 'Zarchiwizowano pracownika: ' || NEW.full_name, NEW.role_title || ' · ' || NEW.department, null, 'employee_profile', NEW.id, null);
    elsif OLD.has_system_access is distinct from NEW.has_system_access or OLD.user_id is distinct from NEW.user_id then
      perform public.log_organization_activity(NEW.organization_id, 'hr', 'employee_access_changed', 'Zmieniono dostep pracownika: ' || NEW.full_name, case when NEW.has_system_access then 'Przyznano dostep do systemu' else 'Odebrano/odlaczono dostep do systemu' end, null, 'employee_profile', NEW.id, jsonb_build_object('old_has_access', OLD.has_system_access, 'new_has_access', NEW.has_system_access));
    elsif OLD.bhp_valid_until is distinct from NEW.bhp_valid_until or OLD.medical_valid_until is distinct from NEW.medical_valid_until then
      perform public.log_organization_activity(NEW.organization_id, 'hr', 'employee_compliance_changed', 'Zmieniono terminy HR: ' || NEW.full_name, 'BHP: ' || coalesce(OLD.bhp_valid_until::text, 'brak') || ' -> ' || coalesce(NEW.bhp_valid_until::text, 'brak') || ' · badania: ' || coalesce(OLD.medical_valid_until::text, 'brak') || ' -> ' || coalesce(NEW.medical_valid_until::text, 'brak'), null, 'employee_profile', NEW.id, null);
    end if;
  end if;
  return NEW;
end;
$$;

create or replace function public.trg_log_employee_compensation_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare employee_name text;
declare log_id uuid;
begin
  select full_name into employee_name from public.employee_profiles where id = NEW.employee_id;
  if TG_OP = 'UPDATE' and
     OLD.hourly_rate is not distinct from NEW.hourly_rate and
     OLD.day_rate is not distinct from NEW.day_rate and
     OLD.monthly_salary is not distinct from NEW.monthly_salary then
    return NEW;
  end if;
  log_id := public.log_organization_activity(
    NEW.organization_id, 'hr', 'employee_compensation_changed',
    'Zmieniono stawki pracownika: ' || coalesce(employee_name, 'pracownik'),
    'Zmieniono poufne dane wynagrodzenia', null, 'employee_compensation', NEW.employee_id,
    jsonb_build_object('changed', true), coalesce(NEW.updated_by, NEW.created_by, auth.uid())
  );
  update public.organization_activity_log set data_scope = 'payroll' where id = log_id;
  return NEW;
end;
$$;

drop trigger if exists log_employee_compensation_activity on public.employee_compensation;
create trigger log_employee_compensation_activity
after insert or update on public.employee_compensation
for each row execute function public.trg_log_employee_compensation_activity();

-- Kalkulacja miesiaca pobiera stawki tylko z prywatnej tabeli i sama sprawdza role.
create or replace function public.refresh_employee_monthly_settlement(
  p_employee_id uuid, p_period_month date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  emp public.employee_profiles%rowtype;
  comp public.employee_compensation%rowtype;
  period_start date := date_trunc('month', p_period_month)::date;
  period_end date := (date_trunc('month', p_period_month) + interval '1 month')::date;
  existing public.employee_monthly_settlements%rowtype;
  total_hours numeric := 0; total_days integer := 0;
  piecework_amount numeric := 0; piecework_qty numeric := 0; base_value numeric := 0;
  bonuses numeric := 0; reimbursements numeric := 0; corrections_plus numeric := 0;
  deductions numeric := 0; corrections_minus numeric := 0; advances numeric := 0;
  previous_payments numeric := 0; gross_value numeric := 0; due_value numeric := 0; result_id uuid;
begin
  select * into emp from public.employee_profiles where id = p_employee_id;
  if emp.id is null then raise exception 'Nie znaleziono pracownika'; end if;
  if not public.can_view_payroll(emp.organization_id) then raise exception 'Brak uprawnien do rozliczen'; end if;
  select * into comp from public.employee_compensation
  where employee_id = emp.id and organization_id = emp.organization_id;

  select * into existing from public.employee_monthly_settlements
  where organization_id = emp.organization_id and employee_id = emp.id and period_month = period_start;
  if existing.id is not null and existing.status <> 'draft' then return existing.id; end if;

  select coalesce(sum(wh.hours), 0), count(distinct wh.work_date)::integer
  into total_hours, total_days from public.work_hours wh
  where wh.organization_id = emp.organization_id and wh.work_date >= period_start and wh.work_date < period_end
    and wh.hours > 0 and (wh.employee_id = emp.id or (wh.employee_id is null and lower(regexp_replace(trim(wh.worker_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(emp.full_name), '\s+', ' ', 'g'))));

  select coalesce(sum(pe.quantity * pe.unit_rate_snapshot), 0), coalesce(sum(pe.quantity), 0)
  into piecework_amount, piecework_qty from public.employee_piecework_entries pe
  where pe.employee_id = emp.id and pe.entry_date >= period_start and pe.entry_date < period_end;

  if emp.employment_type = 'godzinowka' then base_value := total_hours * coalesce(comp.hourly_rate, 0);
  elsif emp.employment_type = 'dniowka' then base_value := total_days * coalesce(comp.day_rate, 0);
  elsif emp.employment_type = 'akord' then base_value := piecework_amount;
  elsif coalesce(comp.monthly_salary, 0) > 0 then base_value := comp.monthly_salary;
  else base_value := total_hours * coalesce(comp.hourly_rate, 0); end if;

  select coalesce(sum(amount) filter (where entry_type = 'premia'), 0), coalesce(sum(amount) filter (where entry_type = 'zwrot_kosztow'), 0),
    coalesce(sum(amount) filter (where entry_type = 'korekta' and direction = 'plus'), 0), coalesce(sum(amount) filter (where entry_type = 'potracenie'), 0),
    coalesce(sum(amount) filter (where entry_type = 'korekta' and direction = 'minus'), 0), coalesce(sum(amount) filter (where entry_type = 'zaliczka'), 0),
    coalesce(sum(amount) filter (where entry_type = 'wyplata'), 0)
  into bonuses, reimbursements, corrections_plus, deductions, corrections_minus, advances, previous_payments
  from public.employee_settlement_entries where employee_id = emp.id and entry_date >= period_start and entry_date < period_end;

  gross_value := base_value + bonuses + reimbursements + corrections_plus;
  due_value := greatest(0, gross_value - deductions - corrections_minus - advances - previous_payments);
  insert into public.employee_monthly_settlements (
    organization_id, employee_id, period_month, status, employment_type_snapshot, hourly_rate_snapshot, day_rate_snapshot, monthly_salary_snapshot,
    hours_total, work_days_total, piecework_total, piecework_quantity_total, base_amount, bonuses_total, reimbursements_total,
    corrections_plus_total, deductions_total, corrections_minus_total, advances_total, previous_payments_total, gross_earnings, amount_due, calculated_at, created_by
  ) values (
    emp.organization_id, emp.id, period_start, 'draft', emp.employment_type, coalesce(comp.hourly_rate, 0), coalesce(comp.day_rate, 0), coalesce(comp.monthly_salary, 0),
    round(total_hours, 2), total_days, round(piecework_amount, 2), round(piecework_qty, 2), round(base_value, 2), round(bonuses, 2), round(reimbursements, 2),
    round(corrections_plus, 2), round(deductions, 2), round(corrections_minus, 2), round(advances, 2), round(previous_payments, 2), round(gross_value, 2), round(due_value, 2), now(), auth.uid()
  ) on conflict (organization_id, employee_id, period_month) do update set
    employment_type_snapshot = excluded.employment_type_snapshot, hourly_rate_snapshot = excluded.hourly_rate_snapshot,
    day_rate_snapshot = excluded.day_rate_snapshot, monthly_salary_snapshot = excluded.monthly_salary_snapshot,
    hours_total = excluded.hours_total, work_days_total = excluded.work_days_total, piecework_total = excluded.piecework_total,
    piecework_quantity_total = excluded.piecework_quantity_total, base_amount = excluded.base_amount, bonuses_total = excluded.bonuses_total,
    reimbursements_total = excluded.reimbursements_total, corrections_plus_total = excluded.corrections_plus_total, deductions_total = excluded.deductions_total,
    corrections_minus_total = excluded.corrections_minus_total, advances_total = excluded.advances_total,
    previous_payments_total = excluded.previous_payments_total, gross_earnings = excluded.gross_earnings,
    amount_due = excluded.amount_due, calculated_at = now()
  returning id into result_id;
  return result_id;
end;
$$;

revoke all on function public.refresh_employee_monthly_settlement(uuid, date) from public;
grant execute on function public.refresh_employee_monthly_settlement(uuid, date) to authenticated;

-- Starsza funkcja zmiany statusu dzialala jako SECURITY DEFINER i sprawdzala
-- szerokie uprawnienie zarzadcze. Zastepujemy je uprawnieniem placowym, aby
-- rola office nie mogla obejsc RLS przez reczne wywolanie RPC.
create or replace function public.set_employee_monthly_settlement_status(
  p_settlement_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  card public.employee_monthly_settlements%rowtype;
begin
  if p_status not in ('draft', 'approved', 'paid', 'closed') then
    raise exception 'Nieprawidlowy status';
  end if;

  select * into card
  from public.employee_monthly_settlements
  where id = p_settlement_id;

  if card.id is null then raise exception 'Nie znaleziono karty'; end if;
  if not public.can_view_payroll(card.organization_id) then
    raise exception 'Brak uprawnien do rozliczen';
  end if;

  if p_status = 'approved' and card.status = 'draft' then
    perform public.refresh_employee_monthly_settlement(card.employee_id, card.period_month);
  elsif p_status = 'paid' and card.status <> 'approved' then
    raise exception 'Najpierw zatwierdz karte';
  elsif p_status = 'closed' and card.status <> 'paid' then
    raise exception 'Najpierw oznacz wyplate';
  elsif p_status = 'draft' and card.status not in ('approved', 'paid') then
    raise exception 'Tej karty nie mozna ponownie otworzyc';
  end if;

  update public.employee_monthly_settlements set
    status = p_status,
    approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) when p_status = 'draft' then null else approved_at end,
    approved_by = case when p_status = 'approved' then coalesce(approved_by, auth.uid()) when p_status = 'draft' then null else approved_by end,
    paid_at = case when p_status = 'paid' then now() when p_status in ('draft', 'approved') then null else paid_at end,
    paid_by = case when p_status = 'paid' then auth.uid() when p_status in ('draft', 'approved') then null else paid_by end,
    final_payment_amount = case when p_status = 'paid' then amount_due when p_status in ('draft', 'approved') then null else final_payment_amount end,
    closed_at = case when p_status = 'closed' then now() else closed_at end,
    closed_by = case when p_status = 'closed' then auth.uid() else closed_by end
  where id = p_settlement_id;
end;
$$;

revoke all on function public.set_employee_monthly_settlement_status(uuid, text) from public;
grant execute on function public.set_employee_monthly_settlement_status(uuid, text) to authenticated;

alter table public.employee_profiles
  drop column if exists hourly_rate,
  drop column if exists day_rate,
  drop column if exists monthly_salary;

select '0059_office_payroll_separation: OK' as migration_status;
