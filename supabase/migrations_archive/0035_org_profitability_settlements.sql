-- Struktura firmy, rozliczenia pracownikow/podwykonawcow i koszty budow.
-- Fundament pod rentownosc budow, faktury hurtowni, zaliczki i hierarchie pracownikow.

create table if not exists public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  crew_id uuid references public.crews(id) on delete set null,
  manager_employee_id uuid references public.employee_profiles(id) on delete set null,
  full_name text not null,
  role_title text not null default 'pracownik',
  department text not null default 'realizacja' check (
    department in ('zarzad', 'biuro', 'handlowcy', 'kierownicy', 'brygada', 'podwykonawcy', 'bhp', 'inne')
  ),
  employment_type text not null default 'godzinowka' check (
    employment_type in ('godzinowka', 'dniowka', 'etat', 'ryczalt', 'b2b', 'podwykonawca', 'inne')
  ),
  has_system_access boolean not null default false,
  hourly_rate numeric check (hourly_rate is null or hourly_rate >= 0),
  day_rate numeric check (day_rate is null or day_rate >= 0),
  monthly_salary numeric check (monthly_salary is null or monthly_salary >= 0),
  phone text,
  email text,
  bhp_valid_until date,
  medical_valid_until date,
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists employee_profiles_org_idx on public.employee_profiles(organization_id, active);
create index if not exists employee_profiles_manager_idx on public.employee_profiles(manager_employee_id);
create index if not exists employee_profiles_crew_idx on public.employee_profiles(crew_id);

drop trigger if exists set_employee_profiles_updated_at on public.employee_profiles;
create trigger set_employee_profiles_updated_at
before update on public.employee_profiles
for each row execute function public.set_updated_at();

alter table public.work_hours
  add column if not exists employee_id uuid references public.employee_profiles(id) on delete set null;

create index if not exists work_hours_employee_idx on public.work_hours(employee_id);

create table if not exists public.employee_settlement_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  entry_type text not null check (
    entry_type in ('zaliczka', 'wyplata', 'premia', 'potracenie', 'zwrot_kosztow', 'korekta')
  ),
  amount numeric not null check (amount >= 0),
  entry_date date not null default (now()::date),
  title text not null default '',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists employee_settlement_entries_org_date_idx
  on public.employee_settlement_entries(organization_id, entry_date desc);
create index if not exists employee_settlement_entries_employee_idx
  on public.employee_settlement_entries(employee_id, entry_date desc);
create index if not exists employee_settlement_entries_case_idx
  on public.employee_settlement_entries(case_id);

create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  supplier_name text not null,
  invoice_number text,
  invoice_date date not null default (now()::date),
  due_date date,
  category text not null default 'materialy' check (
    category in ('materialy', 'robocizna', 'sprzet', 'transport', 'podwykonawca', 'inne')
  ),
  net_total numeric check (net_total is null or net_total >= 0),
  gross_total numeric not null default 0 check (gross_total >= 0),
  paid_amount numeric not null default 0 check (paid_amount >= 0),
  status text not null default 'nieoplacona' check (status in ('nieoplacona', 'czesciowo', 'oplacona')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supplier_invoices_org_date_idx on public.supplier_invoices(organization_id, invoice_date desc);
create index if not exists supplier_invoices_case_idx on public.supplier_invoices(case_id);
create index if not exists supplier_invoices_category_idx on public.supplier_invoices(organization_id, category);

drop trigger if exists set_supplier_invoices_updated_at on public.supplier_invoices;
create trigger set_supplier_invoices_updated_at
before update on public.supplier_invoices
for each row execute function public.set_updated_at();

create table if not exists public.subcontractor_settlement_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  subcontractor_id uuid references public.subcontractors(id) on delete set null,
  case_subcontractor_id uuid references public.case_subcontractors(id) on delete set null,
  entry_type text not null default 'zaliczka' check (
    entry_type in ('zaliczka', 'wyplata', 'rozliczenie_koncowe', 'dopłata', 'potracenie', 'korekta')
  ),
  amount numeric not null check (amount >= 0),
  entry_date date not null default (now()::date),
  title text not null default '',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists subcontractor_settlement_entries_org_date_idx
  on public.subcontractor_settlement_entries(organization_id, entry_date desc);
create index if not exists subcontractor_settlement_entries_case_idx
  on public.subcontractor_settlement_entries(case_id);
create index if not exists subcontractor_settlement_entries_sub_idx
  on public.subcontractor_settlement_entries(subcontractor_id);

create table if not exists public.case_direct_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  cost_type text not null default 'inne' check (
    cost_type in ('materialy', 'robocizna', 'podwykonawcy', 'transport', 'sprzet', 'inne')
  ),
  title text not null,
  amount numeric not null check (amount >= 0),
  cost_date date not null default (now()::date),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists case_direct_costs_case_idx on public.case_direct_costs(case_id);
create index if not exists case_direct_costs_org_type_idx on public.case_direct_costs(organization_id, cost_type);

alter table public.employee_profiles enable row level security;
alter table public.employee_settlement_entries enable row level security;
alter table public.supplier_invoices enable row level security;
alter table public.subcontractor_settlement_entries enable row level security;
alter table public.case_direct_costs enable row level security;

drop policy if exists employee_profiles_manage on public.employee_profiles;
create policy employee_profiles_manage on public.employee_profiles
for all using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

drop policy if exists employee_settlement_entries_manage on public.employee_settlement_entries;
create policy employee_settlement_entries_manage on public.employee_settlement_entries
for all using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

drop policy if exists supplier_invoices_manage on public.supplier_invoices;
create policy supplier_invoices_manage on public.supplier_invoices
for all using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

drop policy if exists subcontractor_settlement_entries_manage on public.subcontractor_settlement_entries;
create policy subcontractor_settlement_entries_manage on public.subcontractor_settlement_entries
for all using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

drop policy if exists case_direct_costs_manage on public.case_direct_costs;
create policy case_direct_costs_manage on public.case_direct_costs
for all using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

grant select, insert, update, delete on public.employee_profiles to authenticated;
grant select, insert, update, delete on public.employee_settlement_entries to authenticated;
grant select, insert, update, delete on public.supplier_invoices to authenticated;
grant select, insert, update, delete on public.subcontractor_settlement_entries to authenticated;
grant select, insert, update, delete on public.case_direct_costs to authenticated;
