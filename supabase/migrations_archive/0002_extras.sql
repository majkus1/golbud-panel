-- GolBud Panel — Etap 2: podwykonawcy, zadania wewnętrzne, rozszerzone role.
-- Bezpieczna migracja: tylko dodaje obiekty, nie usuwa danych.
-- Uruchom w Supabase SQL Editor po pliku schema.sql.

-- --- Role użytkowników w organizacji ---
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'organization_members_role_check'
      and conrelid = 'public.organization_members'::regclass
  ) then
    alter table public.organization_members drop constraint organization_members_role_check;
  end if;

  alter table public.organization_members
    add constraint organization_members_role_check
    check (role in ('owner', 'office', 'sales', 'manager', 'member'));
end$$;

-- --- Podwykonawcy / ekipy zewnętrzne (na poziomie organizacji) ---
create table if not exists public.subcontractors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  trade text,                       -- np. „elewacja”, „rusztowania”, „blacharstwo”
  contact_name text,
  phone text,
  email text,
  default_rate numeric,             -- domyślna stawka (informacyjnie)
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists subcontractors_org_idx on public.subcontractors(organization_id);

-- --- Przypisanie podwykonawcy do sprawy (zakres / stawka konkretnie tu) ---
create table if not exists public.case_subcontractors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  subcontractor_id uuid not null references public.subcontractors(id) on delete restrict,
  scope text not null default '',
  rate numeric,
  unit text default 'usługa' check (unit is null or unit in ('m²', 'mb', 'szt.', 'kpl.', 'roboczogodz.', 'usługa')),
  agreed_total numeric,
  status text not null default 'planowane' check (status in ('planowane', 'w toku', 'zakończone', 'wstrzymane')),
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

create index if not exists case_subcontractors_case_idx on public.case_subcontractors(case_id);
create index if not exists case_subcontractors_sub_idx on public.case_subcontractors(subcontractor_id);

-- --- Zadania wewnętrzne (biuro / handlowiec / kierownik) ---
create table if not exists public.case_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid references public.cases(id) on delete cascade,  -- nullable: można mieć zadanie ogólne
  title text not null,
  description text,
  assignee_id uuid references auth.users(id) on delete set null,
  due_date date,
  priority text not null default 'normalny' check (priority in ('niski', 'normalny', 'wysoki', 'pilne')),
  status text not null default 'do zrobienia' check (status in ('do zrobienia', 'w toku', 'zrobione', 'anulowane')),
  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists case_tasks_org_idx on public.case_tasks(organization_id);
create index if not exists case_tasks_case_idx on public.case_tasks(case_id);
create index if not exists case_tasks_assignee_idx on public.case_tasks(assignee_id);

-- --- RLS ---
alter table public.subcontractors enable row level security;
alter table public.case_subcontractors enable row level security;
alter table public.case_tasks enable row level security;

-- subcontractors: wszyscy członkowie organizacji odczyt, zapis tylko owner/office/manager
drop policy if exists subcontractors_select on public.subcontractors;
create policy subcontractors_select on public.subcontractors
for select using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

drop policy if exists subcontractors_write on public.subcontractors;
create policy subcontractors_write on public.subcontractors
for all using (
  organization_id in (
    select organization_id from public.organization_members
    where user_id = auth.uid() and role in ('owner', 'office', 'manager')
  )
)
with check (
  organization_id in (
    select organization_id from public.organization_members
    where user_id = auth.uid() and role in ('owner', 'office', 'manager')
  )
);

-- case_subcontractors: pełne uprawnienia członka organizacji
drop policy if exists case_subcontractors_all on public.case_subcontractors;
create policy case_subcontractors_all on public.case_subcontractors
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- case_tasks: członek organizacji pełen dostęp; sales widzi tylko swoje (przypisane lub utworzone)
drop policy if exists case_tasks_select on public.case_tasks;
create policy case_tasks_select on public.case_tasks
for select using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
  and (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.organization_id = case_tasks.organization_id
        and m.role in ('owner', 'office', 'manager')
    )
    or assignee_id = auth.uid()
    or created_by = auth.uid()
  )
);

drop policy if exists case_tasks_insert on public.case_tasks;
create policy case_tasks_insert on public.case_tasks
for insert with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

drop policy if exists case_tasks_update on public.case_tasks;
create policy case_tasks_update on public.case_tasks
for update using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
  and (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.organization_id = case_tasks.organization_id
        and m.role in ('owner', 'office', 'manager')
    )
    or assignee_id = auth.uid()
    or created_by = auth.uid()
  )
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

drop policy if exists case_tasks_delete on public.case_tasks;
create policy case_tasks_delete on public.case_tasks
for delete using (
  organization_id in (
    select organization_id from public.organization_members
    where user_id = auth.uid() and role in ('owner', 'office', 'manager')
  )
);

-- --- Zarządzanie zespołem: aktualizacja roli przez właściciela ---
-- UWAGA: polityki RLS na organization_members NIE MOGĄ same odpytywać tej
-- tabeli (rekurencja). Używamy funkcji SECURITY DEFINER (bypass RLS).

create or replace function public.is_member_of(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where user_id = auth.uid() and organization_id = target_org
  );
$$;

create or replace function public.is_owner_of(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where user_id = auth.uid()
      and organization_id = target_org
      and role = 'owner'
  );
$$;

revoke all on function public.is_member_of(uuid) from public;
revoke all on function public.is_owner_of(uuid) from public;
grant execute on function public.is_member_of(uuid) to authenticated;
grant execute on function public.is_owner_of(uuid) to authenticated;

drop policy if exists org_members_select on public.organization_members;
drop policy if exists org_members_select_team on public.organization_members;
drop policy if exists org_members_update on public.organization_members;

create policy org_members_select on public.organization_members
for select using (
  user_id = auth.uid() or public.is_member_of(organization_id)
);

create policy org_members_update on public.organization_members
for update using (public.is_owner_of(organization_id))
with check (public.is_owner_of(organization_id));

-- --- Widok pomocniczy: profile użytkowników w organizacji (email) ---
create or replace view public.org_member_profiles
with (security_invoker = true) as
select
  m.organization_id,
  m.user_id,
  m.role,
  u.email
from public.organization_members m
join auth.users u on u.id = m.user_id;

grant select on public.org_member_profiles to authenticated;

-- --- Helper RPC: zapraszanie/dodawanie roli po e-mailu (tylko owner) ---
create or replace function public.set_member_role(target_email text, target_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_org uuid;
  my_role text;
  target_user uuid;
begin
  select organization_id, role into my_org, my_role
  from public.organization_members
  where user_id = auth.uid()
  limit 1;

  if my_org is null then
    raise exception 'Brak organizacji dla użytkownika';
  end if;

  if my_role <> 'owner' then
    raise exception 'Tylko właściciel może zmieniać role';
  end if;

  if target_role not in ('owner', 'office', 'sales', 'manager', 'member') then
    raise exception 'Nieprawidłowa rola: %', target_role;
  end if;

  select id into target_user from auth.users where email = target_email;

  if target_user is null then
    raise exception 'Nie znaleziono użytkownika o e-mailu %', target_email;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (my_org, target_user, target_role)
  on conflict (organization_id, user_id) do update
    set role = excluded.role;
end;
$$;

revoke all on function public.set_member_role(text, text) from public;
grant execute on function public.set_member_role(text, text) to authenticated;
