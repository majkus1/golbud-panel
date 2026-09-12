-- Rozszerzenie rentownosci: plany budzetowe, import faktur i reguly kategorii.

create table if not exists public.case_profitability_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  planned_revenue numeric not null default 0 check (planned_revenue >= 0),
  planned_material_cost numeric not null default 0 check (planned_material_cost >= 0),
  planned_labor_cost numeric not null default 0 check (planned_labor_cost >= 0),
  planned_subcontractor_cost numeric not null default 0 check (planned_subcontractor_cost >= 0),
  planned_equipment_cost numeric not null default 0 check (planned_equipment_cost >= 0),
  planned_transport_cost numeric not null default 0 check (planned_transport_cost >= 0),
  planned_other_cost numeric not null default 0 check (planned_other_cost >= 0),
  contingency_pct numeric not null default 8 check (contingency_pct >= 0 and contingency_pct <= 100),
  progress_pct numeric not null default 0 check (progress_pct >= 0 and progress_pct <= 100),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, case_id)
);

create index if not exists case_profitability_plans_org_idx
  on public.case_profitability_plans(organization_id);
create index if not exists case_profitability_plans_case_idx
  on public.case_profitability_plans(case_id);

drop trigger if exists set_case_profitability_plans_updated_at on public.case_profitability_plans;
create trigger set_case_profitability_plans_updated_at
before update on public.case_profitability_plans
for each row execute function public.set_updated_at();

create table if not exists public.supplier_invoice_category_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pattern text not null,
  match_field text not null default 'all' check (match_field in ('all', 'supplier', 'number', 'notes')),
  category text not null check (category in ('materialy', 'robocizna', 'sprzet', 'transport', 'podwykonawca', 'inne')),
  priority integer not null default 100,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists supplier_invoice_category_rules_org_idx
  on public.supplier_invoice_category_rules(organization_id, active, priority);

create table if not exists public.supplier_invoice_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null default 'csv' check (source in ('csv', 'xlsx', 'ocr', 'manual')),
  file_name text,
  row_count integer not null default 0 check (row_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists supplier_invoice_import_batches_org_idx
  on public.supplier_invoice_import_batches(organization_id, created_at desc);

alter table public.supplier_invoices
  add column if not exists import_batch_id uuid references public.supplier_invoice_import_batches(id) on delete set null,
  add column if not exists source text not null default 'manual' check (source in ('manual', 'csv', 'xlsx', 'ocr')),
  add column if not exists category_confidence numeric check (category_confidence is null or (category_confidence >= 0 and category_confidence <= 1)),
  add column if not exists category_reason text,
  add column if not exists raw_import_data jsonb;

create index if not exists supplier_invoices_import_batch_idx
  on public.supplier_invoices(import_batch_id);
create index if not exists supplier_invoices_org_supplier_number_idx
  on public.supplier_invoices(organization_id, supplier_name, invoice_number);

alter table public.case_profitability_plans enable row level security;
alter table public.supplier_invoice_category_rules enable row level security;
alter table public.supplier_invoice_import_batches enable row level security;

drop policy if exists case_profitability_plans_manage on public.case_profitability_plans;
create policy case_profitability_plans_manage on public.case_profitability_plans
for all using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

drop policy if exists supplier_invoice_category_rules_manage on public.supplier_invoice_category_rules;
create policy supplier_invoice_category_rules_manage on public.supplier_invoice_category_rules
for all using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

drop policy if exists supplier_invoice_import_batches_manage on public.supplier_invoice_import_batches;
create policy supplier_invoice_import_batches_manage on public.supplier_invoice_import_batches
for all using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

grant select, insert, update, delete on public.case_profitability_plans to authenticated;
grant select, insert, update, delete on public.supplier_invoice_category_rules to authenticated;
grant select, insert, update, delete on public.supplier_invoice_import_batches to authenticated;
