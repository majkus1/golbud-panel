-- Szablony kosztorysow: reuzywalne "paczki" pozycji (materialy + robocizna), ktore mozna
-- zastosowac przy zakladaniu nowego zlecenia albo w istniejacej wycenie, zamiast za kazdym
-- razem przepisywac ten sam kosztorys recznie. Ksztalt tabel celowo 1:1 z `offer_lines`,
-- zeby kopiowanie pozycji (szablon -> wariant oferty) bylo trywialne i uzywalo istniejacych helperow.

create table if not exists public.estimate_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists estimate_templates_org_idx on public.estimate_templates(organization_id, sort_order);

create table if not exists public.estimate_template_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.estimate_templates(id) on delete cascade,
  section text not null check (section in ('labor', 'material')),
  label text not null,
  unit text not null default 'm²' check (unit in ('m²', 'mb', 'szt.', 'kpl.', 'roboczogodz.', 'usługa')),
  quantity numeric not null default 1 check (quantity >= 0),
  unit_rate numeric not null default 0 check (unit_rate >= 0),
  line_total numeric generated always as (round(quantity * unit_rate, 2)) stored,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists estimate_template_lines_template_idx on public.estimate_template_lines(template_id);

alter table public.estimate_templates enable row level security;
alter table public.estimate_template_lines enable row level security;

-- Te same role, ktore dzis widza/tworza wyceny ofertowe (owner/office/manager/sales) -
-- patrz `can_see_case_commercial` w migracji 0027_field_role_finances_work_hours.sql.
drop policy if exists estimate_templates_select on public.estimate_templates;
create policy estimate_templates_select on public.estimate_templates
for select using (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
);

drop policy if exists estimate_templates_manage on public.estimate_templates;
create policy estimate_templates_manage on public.estimate_templates
for all using (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
)
with check (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
);

drop policy if exists estimate_template_lines_select on public.estimate_template_lines;
create policy estimate_template_lines_select on public.estimate_template_lines
for select using (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
);

drop policy if exists estimate_template_lines_manage on public.estimate_template_lines;
create policy estimate_template_lines_manage on public.estimate_template_lines
for all using (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
)
with check (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
);

grant select, insert, update, delete on public.estimate_templates to authenticated;
grant select, insert, update, delete on public.estimate_template_lines to authenticated;

select '0052_estimate_templates: OK' as migration_status;
