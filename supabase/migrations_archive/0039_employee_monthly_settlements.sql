-- Pelne miesieczne rozliczenia pracownikow: karty, migawki stawek,
-- automatyczne podsumowania, statusy akceptacji i historia zmian.

alter table public.employee_settlement_entries
  add column if not exists direction text,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.employee_settlement_entries
set direction = case
  when entry_type in ('zaliczka', 'wyplata', 'potracenie') then 'minus'
  else 'plus'
end
where direction is null;

alter table public.employee_settlement_entries
  alter column direction set default 'plus',
  alter column direction set not null;

alter table public.employee_settlement_entries
  drop constraint if exists employee_settlement_entries_direction_check;
alter table public.employee_settlement_entries
  add constraint employee_settlement_entries_direction_check check (direction in ('plus', 'minus'));

drop trigger if exists set_employee_settlement_entries_updated_at on public.employee_settlement_entries;
create trigger set_employee_settlement_entries_updated_at
before update on public.employee_settlement_entries
for each row execute function public.set_updated_at();

create table if not exists public.employee_monthly_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  period_month date not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid', 'closed')),
  employment_type_snapshot text not null,
  hourly_rate_snapshot numeric not null default 0 check (hourly_rate_snapshot >= 0),
  day_rate_snapshot numeric not null default 0 check (day_rate_snapshot >= 0),
  monthly_salary_snapshot numeric not null default 0 check (monthly_salary_snapshot >= 0),
  hours_total numeric(10,2) not null default 0 check (hours_total >= 0),
  work_days_total integer not null default 0 check (work_days_total >= 0),
  base_amount numeric(12,2) not null default 0,
  bonuses_total numeric(12,2) not null default 0,
  reimbursements_total numeric(12,2) not null default 0,
  corrections_plus_total numeric(12,2) not null default 0,
  deductions_total numeric(12,2) not null default 0,
  corrections_minus_total numeric(12,2) not null default 0,
  advances_total numeric(12,2) not null default 0,
  previous_payments_total numeric(12,2) not null default 0,
  gross_earnings numeric(12,2) not null default 0,
  amount_due numeric(12,2) not null default 0,
  final_payment_amount numeric(12,2),
  notes text,
  calculated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_id, period_month),
  check (period_month = date_trunc('month', period_month)::date)
);

create index if not exists employee_monthly_settlements_org_period_idx
  on public.employee_monthly_settlements(organization_id, period_month desc, status);
create index if not exists employee_monthly_settlements_employee_idx
  on public.employee_monthly_settlements(employee_id, period_month desc);

drop trigger if exists set_employee_monthly_settlements_updated_at on public.employee_monthly_settlements;
create trigger set_employee_monthly_settlements_updated_at
before update on public.employee_monthly_settlements
for each row execute function public.set_updated_at();

create table if not exists public.employee_settlement_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  settlement_id uuid references public.employee_monthly_settlements(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  period_month date not null,
  action text not null,
  summary text not null,
  before_data jsonb,
  after_data jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists employee_settlement_history_settlement_idx
  on public.employee_settlement_history(settlement_id, created_at desc);
create index if not exists employee_settlement_history_org_idx
  on public.employee_settlement_history(organization_id, created_at desc);

alter table public.employee_monthly_settlements enable row level security;
alter table public.employee_settlement_history enable row level security;

drop policy if exists employee_monthly_settlements_manage on public.employee_monthly_settlements;
create policy employee_monthly_settlements_manage on public.employee_monthly_settlements
for all using (
  public.is_member_of(organization_id) and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id) and public.can_see_all_cases(organization_id)
);

drop policy if exists employee_settlement_history_select on public.employee_settlement_history;
create policy employee_settlement_history_select on public.employee_settlement_history
for select using (
  public.is_member_of(organization_id) and public.can_see_all_cases(organization_id)
);

grant select, insert, update, delete on public.employee_monthly_settlements to authenticated;
grant select on public.employee_settlement_history to authenticated;

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

  if emp.employment_type = 'godzinowka' then
    base_value := total_hours * coalesce(emp.hourly_rate, 0);
  elsif emp.employment_type = 'dniowka' then
    base_value := total_days * coalesce(emp.day_rate, 0);
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
    hours_total, work_days_total, base_amount, bonuses_total, reimbursements_total,
    corrections_plus_total, deductions_total, corrections_minus_total, advances_total,
    previous_payments_total, gross_earnings, amount_due, calculated_at, created_by
  ) values (
    emp.organization_id, emp.id, period_start, 'draft',
    emp.employment_type, coalesce(emp.hourly_rate, 0), coalesce(emp.day_rate, 0), coalesce(emp.monthly_salary, 0),
    round(total_hours, 2), total_days, round(base_value, 2), round(bonuses, 2), round(reimbursements, 2),
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

revoke all on function public.refresh_employee_monthly_settlement(uuid, date) from public;
grant execute on function public.refresh_employee_monthly_settlement(uuid, date) to authenticated;

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
  if p_status not in ('draft', 'approved', 'paid', 'closed') then raise exception 'Nieprawidlowy status'; end if;
  select * into card from public.employee_monthly_settlements where id = p_settlement_id;
  if card.id is null then raise exception 'Nie znaleziono karty'; end if;
  if not (public.is_member_of(card.organization_id) and public.can_see_all_cases(card.organization_id)) then
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

create or replace function public.trg_lock_employee_entries_for_closed_month()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eid uuid := coalesce(NEW.employee_id, OLD.employee_id);
  edate date := coalesce(NEW.entry_date, OLD.entry_date);
begin
  if TG_OP <> 'INSERT' and exists (
    select 1 from public.employee_monthly_settlements s
    where s.employee_id = OLD.employee_id
      and s.period_month = date_trunc('month', OLD.entry_date)::date
      and s.status <> 'draft'
  ) then
    raise exception 'Miesiac jest zatwierdzony. Cofnij karte do wersji roboczej przed zmiana wpisow.';
  end if;
  if TG_OP <> 'DELETE' and exists (
    select 1 from public.employee_monthly_settlements s
    where s.employee_id = NEW.employee_id
      and s.period_month = date_trunc('month', NEW.entry_date)::date
      and s.status <> 'draft'
  ) then
    raise exception 'Miesiac jest zatwierdzony. Cofnij karte do wersji roboczej przed zmiana wpisow.';
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists lock_employee_entries_for_closed_month on public.employee_settlement_entries;
create trigger lock_employee_entries_for_closed_month
before insert or update or delete on public.employee_settlement_entries
for each row execute function public.trg_lock_employee_entries_for_closed_month();

create or replace function public.trg_employee_settlement_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_json jsonb := case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end;
  new_json jsonb := case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end;
  row_data public.employee_monthly_settlements%rowtype;
  action_name text;
begin
  row_data := coalesce(NEW, OLD);
  action_name := case
    when TG_OP = 'INSERT' then 'created'
    when TG_OP = 'DELETE' then 'deleted'
    when OLD.status is distinct from NEW.status then 'status_changed'
    else 'recalculated'
  end;
  insert into public.employee_settlement_history (
    organization_id, settlement_id, employee_id, period_month, action, summary,
    before_data, after_data, created_by
  ) values (
    row_data.organization_id,
    case when TG_OP = 'DELETE' then null else row_data.id end,
    row_data.employee_id,
    row_data.period_month,
    action_name,
    case
      when action_name = 'status_changed' then 'Zmiana statusu: ' || OLD.status || ' -> ' || NEW.status
      when action_name = 'created' then 'Utworzono miesieczna karte rozliczeniowa'
      when action_name = 'deleted' then 'Usunieto miesieczna karte rozliczeniowa'
      else 'Przeliczono miesieczna karte rozliczeniowa'
    end,
    old_json,
    new_json,
    auth.uid()
  );
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists employee_settlement_history_trigger on public.employee_monthly_settlements;
create trigger employee_settlement_history_trigger
after insert or update or delete on public.employee_monthly_settlements
for each row execute function public.trg_employee_settlement_history();

create or replace function public.trg_employee_settlement_entry_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  entry_row public.employee_settlement_entries%rowtype;
  card_id uuid;
  action_name text;
begin
  entry_row := coalesce(NEW, OLD);
  select id into card_id
  from public.employee_monthly_settlements
  where organization_id = entry_row.organization_id
    and employee_id = entry_row.employee_id
    and period_month = date_trunc('month', entry_row.entry_date)::date;
  action_name := case when TG_OP = 'INSERT' then 'entry_created' when TG_OP = 'DELETE' then 'entry_deleted' else 'entry_updated' end;
  insert into public.employee_settlement_history (
    organization_id, settlement_id, employee_id, period_month, action, summary,
    before_data, after_data, created_by
  ) values (
    entry_row.organization_id, card_id, entry_row.employee_id, date_trunc('month', entry_row.entry_date)::date,
    action_name,
    case when TG_OP = 'DELETE' then 'Usunieto wpis: ' else 'Zapisano wpis: ' end || entry_row.entry_type || ' ' || entry_row.amount::text || ' PLN',
    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
    auth.uid()
  );
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists employee_settlement_entry_history_trigger on public.employee_settlement_entries;
create trigger employee_settlement_entry_history_trigger
after insert or update or delete on public.employee_settlement_entries
for each row execute function public.trg_employee_settlement_entry_history();

-- Powiaz stare wpisy godzin z kartami pracownikow, gdy nazwa jest jednoznaczna.
update public.work_hours wh
set employee_id = emp.id
from public.employee_profiles emp
where wh.employee_id is null
  and wh.organization_id = emp.organization_id
  and lower(regexp_replace(trim(wh.worker_name), '\s+', ' ', 'g')) =
      lower(regexp_replace(trim(emp.full_name), '\s+', ' ', 'g'))
  and not exists (
    select 1 from public.employee_profiles other
    where other.organization_id = emp.organization_id and other.id <> emp.id
      and lower(regexp_replace(trim(other.full_name), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(emp.full_name), '\s+', ' ', 'g'))
  );

-- Dziennik ogolny dostaje osobna kategorie rozliczen.
alter table public.organization_activity_log drop constraint if exists organization_activity_log_category_check;
alter table public.organization_activity_log add constraint organization_activity_log_category_check check (category in (
  'sprawa', 'platnosc', 'faktura', 'magazyn', 'sprzet', 'czas', 'zespol', 'firma',
  'przypisanie', 'prace_dodatkowe', 'zadanie', 'rozliczenia'
));

create or replace function public.trg_log_employee_monthly_settlement_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_name text;
begin
  select full_name into employee_name from public.employee_profiles where id = coalesce(NEW.employee_id, OLD.employee_id);
  perform public.log_organization_activity(
    coalesce(NEW.organization_id, OLD.organization_id),
    'rozliczenia',
    case when TG_OP = 'INSERT' then 'created' when OLD.status is distinct from NEW.status then 'status_changed' else 'recalculated' end,
    coalesce(employee_name, 'Pracownik') || ' - ' || to_char(coalesce(NEW.period_month, OLD.period_month), 'MM/YYYY'),
    case when TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status
      then 'Status: ' || OLD.status || ' -> ' || NEW.status
      else 'Do wyplaty: ' || coalesce(NEW.amount_due, OLD.amount_due)::text || ' PLN'
    end,
    null, 'employee_monthly_settlement', coalesce(NEW.id, OLD.id), null
  );
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists log_employee_monthly_settlement_activity on public.employee_monthly_settlements;
create trigger log_employee_monthly_settlement_activity
after insert or update on public.employee_monthly_settlements
for each row execute function public.trg_log_employee_monthly_settlement_activity();
