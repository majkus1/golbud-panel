-- Modul "Slowniki": pierwszy nowy slownik - stanowiska pracownikow.
-- Do tej pory "Funkcja" w karcie pracownika byla wolnym tekstem (literowki, niespojne nazwy
-- w raportach). Ta migracja wprowadza prosty, uporzadkowany slownik nazw stanowisk per organizacja,
-- wzorowany 1:1 na istniejacej tabeli `crews` (ten sam ksztalt, ten sam wzorzec RLS).

create table if not exists public.job_positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists job_positions_org_idx on public.job_positions(organization_id, sort_order);

alter table public.job_positions enable row level security;

drop policy if exists job_positions_all on public.job_positions;
create policy job_positions_all on public.job_positions
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

grant select, insert, update, delete on public.job_positions to authenticated;

-- Backfill: przenosimy juz uzywane nazwy stanowisk z kart pracownikow do nowego slownika,
-- zeby biuro nie zaczynalo z pusta lista i zeby dotychczasowe dane sie w niej odnalazly.
insert into public.job_positions (organization_id, name, sort_order)
select
  t.organization_id,
  t.role_title,
  (row_number() over (partition by t.organization_id order by t.role_title)) * 10
from (
  select distinct organization_id, trim(role_title) as role_title
  from public.employee_profiles
  where role_title is not null and trim(role_title) <> ''
) t
on conflict (organization_id, name) do nothing;

select '0051_dictionaries_job_positions: OK' as migration_status;
