-- Faza 5: rozdział ubezpieczenia pojazdu na OC i AC + polisy firmowe.
-- Idempotentna.

-- ── Pojazdy: OC i AC osobno (zachowujemy stare insurance_expires) ─────────────
alter table public.vehicles
  add column if not exists insurance_oc_expires date,
  add column if not exists insurance_ac_expires date;

-- Przeniesienie dotychczasowej daty ubezpieczenia do OC (OC obowiązkowe).
update public.vehicles
set insurance_oc_expires = insurance_expires
where insurance_oc_expires is null and insurance_expires is not null;

-- ── Polisy firmowe (OC działalności, polisy majątkowe itp.) ───────────────────
create table if not exists public.company_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_type text not null,
  policy_number text,
  insurer text,
  coverage_end date,
  payment_due date,
  amount numeric(14, 2) check (amount is null or amount >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_policies_org_idx on public.company_policies(organization_id);

drop trigger if exists set_company_policies_updated_at on public.company_policies;
create trigger set_company_policies_updated_at
before update on public.company_policies
for each row execute function public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.company_policies enable row level security;

drop policy if exists company_policies_all on public.company_policies;
create policy company_policies_all on public.company_policies
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

grant select, insert, update, delete on public.company_policies to authenticated;
