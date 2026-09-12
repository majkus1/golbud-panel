-- Kosztorys powykonawczy: historia wygenerowanych PDF per sprawa.
-- Idempotentna.

alter table public.cases
  add column if not exists contract_number text,
  add column if not exists contract_date date;

comment on column public.cases.contract_number is 'Numer umowy z klientem (np. 01/05) — widoczny na kosztorysie powykonawczym.';
comment on column public.cases.contract_date is 'Data zawarcia umowy — widoczna na kosztorysie powykonawczym.';

create table if not exists public.case_as_built_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  variant_id uuid references public.offer_variants(id) on delete set null,
  variant_name text not null default '',
  title text not null default 'Kosztorys powykonawczy',
  contract_number text,
  contract_date date,
  settlement_basis text,
  footer_note text,
  net_total numeric not null default 0 check (net_total >= 0),
  advances_paid numeric not null default 0 check (advances_paid >= 0),
  balance_due numeric not null default 0,
  line_count int not null default 0 check (line_count >= 0),
  lines_snapshot jsonb not null default '[]'::jsonb,
  storage_path text not null,
  file_name text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, storage_path)
);

alter table public.case_as_built_estimates
  add column if not exists pdf_work_description text;

create index if not exists case_as_built_estimates_case_idx on public.case_as_built_estimates(case_id);
create index if not exists case_as_built_estimates_org_idx on public.case_as_built_estimates(organization_id);

alter table public.case_as_built_estimates enable row level security;

drop policy if exists case_as_built_estimates_select on public.case_as_built_estimates;
drop policy if exists case_as_built_estimates_insert on public.case_as_built_estimates;
drop policy if exists case_as_built_estimates_delete on public.case_as_built_estimates;

create policy case_as_built_estimates_select on public.case_as_built_estimates
for select using (
  public.is_member_of(organization_id)
  and (
    public.can_see_all_cases(organization_id)
    or created_by = auth.uid()
    or public.is_case_assignee(case_id)
  )
);

create policy case_as_built_estimates_insert on public.case_as_built_estimates
for insert with check (
  public.is_member_of(organization_id)
  and public.my_role_in(organization_id) in ('owner', 'office', 'manager', 'sales')
);

create policy case_as_built_estimates_delete on public.case_as_built_estimates
for delete using (
  public.is_member_of(organization_id)
  and public.my_role_in(organization_id) in ('owner', 'office', 'manager')
);
