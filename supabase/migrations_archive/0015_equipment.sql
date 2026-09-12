-- Faza 4: baza sprzętu / rusztowań ze śledzeniem ilości na poszczególnych budowach.
-- Sprzęt jest osobny od materiałów (magazyn). Idempotentna.

-- ── Sprzęt / rusztowania ──────────────────────────────────────────────────────
create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category text not null default 'rusztowanie'
    check (category in ('rusztowanie', 'maszyna', 'narzędzie', 'sprzęt', 'inne')),
  unit text not null default 'szt.',
  total_quantity numeric not null default 0 check (total_quantity >= 0),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists equipment_org_idx on public.equipment(organization_id);

drop trigger if exists set_equipment_updated_at on public.equipment;
create trigger set_equipment_updated_at
before update on public.equipment
for each row execute function public.set_updated_at();

-- ── Przypisania sprzętu do budów (aktywne = returned = false) ─────────────────
create table if not exists public.equipment_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  site_label text,
  quantity numeric not null check (quantity > 0),
  assigned_date date not null default (current_date),
  returned boolean not null default false,
  returned_date date,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists equipment_assignments_equipment_idx on public.equipment_assignments(equipment_id);
create index if not exists equipment_assignments_org_active_idx on public.equipment_assignments(organization_id, returned);
create index if not exists equipment_assignments_case_idx on public.equipment_assignments(case_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.equipment enable row level security;
alter table public.equipment_assignments enable row level security;

drop policy if exists equipment_all on public.equipment;
create policy equipment_all on public.equipment
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

drop policy if exists equipment_assignments_all on public.equipment_assignments;
create policy equipment_assignments_all on public.equipment_assignments
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

grant select, insert, update, delete on public.equipment to authenticated;
grant select, insert, update, delete on public.equipment_assignments to authenticated;
