-- Faza 8: tygodniowa ewidencja czasu pracy per pracownik per budowa.
-- Brygadzista wpisuje godziny dla każdego dnia. Idempotentna.

create table if not exists public.work_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  site_label text,
  worker_name text not null,
  work_date date not null,
  hours numeric(5, 2) not null default 0 check (hours >= 0 and hours <= 24),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_hours_org_date_idx on public.work_hours(organization_id, work_date);
create index if not exists work_hours_case_idx on public.work_hours(case_id);

-- Jeden wpis na pracownika / budowę / dzień (upsert przy edycji w siatce tygodniowej).
create unique index if not exists work_hours_unique_cell_idx
  on public.work_hours(organization_id, worker_name, work_date, coalesce(case_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(site_label, ''));

drop trigger if exists set_work_hours_updated_at on public.work_hours;
create trigger set_work_hours_updated_at
before update on public.work_hours
for each row execute function public.set_updated_at();

alter table public.work_hours enable row level security;

drop policy if exists work_hours_all on public.work_hours;
create policy work_hours_all on public.work_hours
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

grant select, insert, update, delete on public.work_hours to authenticated;
