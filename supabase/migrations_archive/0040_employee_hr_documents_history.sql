-- Pelny modul HR: dokumenty pracownicze, historia stanowisk i brygad,
-- prywatny storage oraz synchronizacja terminow BHP/badan z profilem.

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  document_type text not null check (document_type in (
    'bhp', 'medical', 'training', 'qualification', 'contract', 'annex', 'certificate', 'other'
  )),
  title text not null,
  document_number text,
  issued_at date,
  valid_from date,
  valid_until date,
  requires_renewal boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  notes text,
  source_key text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index if not exists employee_documents_org_expiry_idx
  on public.employee_documents(organization_id, valid_until) where status = 'active';
create index if not exists employee_documents_employee_idx
  on public.employee_documents(employee_id, status, created_at desc);
create unique index if not exists employee_documents_source_key_idx
  on public.employee_documents(employee_id, source_key) where source_key is not null;

drop trigger if exists set_employee_documents_updated_at on public.employee_documents;
create trigger set_employee_documents_updated_at
before update on public.employee_documents
for each row execute function public.set_updated_at();

create table if not exists public.employee_position_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  role_title text not null,
  department text not null check (department in ('zarzad', 'biuro', 'handlowcy', 'kierownicy', 'brygada', 'podwykonawcy', 'bhp', 'inne')),
  employment_type text not null check (employment_type in ('godzinowka', 'dniowka', 'etat', 'ryczalt', 'b2b', 'podwykonawca', 'inne')),
  manager_employee_id uuid references public.employee_profiles(id) on delete set null,
  valid_from date not null,
  valid_until date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);

create index if not exists employee_position_history_employee_idx
  on public.employee_position_history(employee_id, valid_from desc);

create table if not exists public.employee_crew_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  crew_id uuid references public.crews(id) on delete set null,
  valid_from date not null,
  valid_until date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);

create index if not exists employee_crew_history_employee_idx
  on public.employee_crew_history(employee_id, valid_from desc);
create index if not exists employee_crew_history_crew_idx
  on public.employee_crew_history(crew_id, valid_from desc);

alter table public.employee_documents enable row level security;
alter table public.employee_position_history enable row level security;
alter table public.employee_crew_history enable row level security;

drop policy if exists employee_documents_manage on public.employee_documents;
create policy employee_documents_manage on public.employee_documents
for all using (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id))
with check (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id));

drop policy if exists employee_position_history_manage on public.employee_position_history;
create policy employee_position_history_manage on public.employee_position_history
for all using (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id))
with check (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id));

drop policy if exists employee_crew_history_manage on public.employee_crew_history;
create policy employee_crew_history_manage on public.employee_crew_history
for all using (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id))
with check (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id));

grant select, insert, update, delete on public.employee_documents to authenticated;
grant select, insert, update, delete on public.employee_position_history to authenticated;
grant select, insert, update, delete on public.employee_crew_history to authenticated;

-- Prywatny bucket: sciezka organization_id/employee_id/uuid-nazwa_pliku.
insert into storage.buckets (id, name, public, file_size_limit)
values ('employee-documents', 'employee-documents', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

drop policy if exists "employee-documents management select" on storage.objects;
drop policy if exists "employee-documents management insert" on storage.objects;
drop policy if exists "employee-documents management update" on storage.objects;
drop policy if exists "employee-documents management delete" on storage.objects;

create policy "employee-documents management select"
on storage.objects for select to authenticated
using (
  bucket_id = 'employee-documents'
  and exists (
    select 1 from public.organization_members om
    where om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
      and om.organization_id::text = split_part(name, '/', 1)
  )
);

create policy "employee-documents management insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'employee-documents'
  and exists (
    select 1
    from public.organization_members om
    join public.employee_profiles ep on ep.organization_id = om.organization_id
    where om.user_id = auth.uid()
      and om.role in ('owner', 'office', 'manager')
      and om.organization_id::text = split_part(name, '/', 1)
      and ep.id::text = split_part(name, '/', 2)
  )
);

create policy "employee-documents management update"
on storage.objects for update to authenticated
using (
  bucket_id = 'employee-documents'
  and exists (
    select 1 from public.organization_members om
    where om.user_id = auth.uid() and om.role in ('owner', 'office', 'manager')
      and om.organization_id::text = split_part(name, '/', 1)
  )
)
with check (
  bucket_id = 'employee-documents'
  and exists (
    select 1 from public.organization_members om
    where om.user_id = auth.uid() and om.role in ('owner', 'office', 'manager')
      and om.organization_id::text = split_part(name, '/', 1)
  )
);

create policy "employee-documents management delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'employee-documents'
  and exists (
    select 1 from public.organization_members om
    where om.user_id = auth.uid() and om.role in ('owner', 'office', 'manager')
      and om.organization_id::text = split_part(name, '/', 1)
  )
);

-- Dokumenty BHP i medycyny pracy sa zrodlem terminow na profilu pracownika.
create or replace function public.refresh_employee_compliance_dates(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.hr_compliance_from_document', 'true', true);
  update public.employee_profiles ep set
    bhp_valid_until = (
      select max(d.valid_until) from public.employee_documents d
      where d.employee_id = p_employee_id and d.document_type = 'bhp' and d.status = 'active'
    ),
    medical_valid_until = (
      select max(d.valid_until) from public.employee_documents d
      where d.employee_id = p_employee_id and d.document_type = 'medical' and d.status = 'active'
    )
  where ep.id = p_employee_id;
end;
$$;

create or replace function public.trg_refresh_employee_compliance_dates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.hr_migration_seed', true) = 'true' then return coalesce(NEW, OLD); end if;
  perform public.refresh_employee_compliance_dates(coalesce(NEW.employee_id, OLD.employee_id));
  if TG_OP = 'UPDATE' and OLD.employee_id is distinct from NEW.employee_id then
    perform public.refresh_employee_compliance_dates(OLD.employee_id);
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists refresh_employee_compliance_dates on public.employee_documents;
create trigger refresh_employee_compliance_dates
after insert or update or delete on public.employee_documents
for each row execute function public.trg_refresh_employee_compliance_dates();

-- Szybka zmiana daty w strukturze firmy nadal tworzy dokument HR.
create or replace function public.trg_sync_profile_compliance_documents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.hr_compliance_from_document', true) = 'true' then return NEW; end if;
  if OLD.bhp_valid_until is distinct from NEW.bhp_valid_until then
    if NEW.bhp_valid_until is null then
      delete from public.employee_documents where employee_id = NEW.id and source_key = 'profile_bhp';
    else
      insert into public.employee_documents (
        organization_id, employee_id, document_type, title, valid_until, requires_renewal, source_key, created_by
      ) values (
        NEW.organization_id, NEW.id, 'bhp', 'Szkolenie BHP', NEW.bhp_valid_until, true, 'profile_bhp', auth.uid()
      ) on conflict (employee_id, source_key) where source_key is not null do update
      set valid_until = excluded.valid_until, status = 'active';
    end if;
  end if;
  if OLD.medical_valid_until is distinct from NEW.medical_valid_until then
    if NEW.medical_valid_until is null then
      delete from public.employee_documents where employee_id = NEW.id and source_key = 'profile_medical';
    else
      insert into public.employee_documents (
        organization_id, employee_id, document_type, title, valid_until, requires_renewal, source_key, created_by
      ) values (
        NEW.organization_id, NEW.id, 'medical', 'Badania lekarskie', NEW.medical_valid_until, true, 'profile_medical', auth.uid()
      ) on conflict (employee_id, source_key) where source_key is not null do update
      set valid_until = excluded.valid_until, status = 'active';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists sync_profile_compliance_documents on public.employee_profiles;
create trigger sync_profile_compliance_documents
after update of bhp_valid_until, medical_valid_until on public.employee_profiles
for each row execute function public.trg_sync_profile_compliance_documents();

-- Zachowaj dotychczasowe daty jako pierwsze dokumenty HR.
do $$
begin
  perform set_config('app.hr_migration_seed', 'true', true);
  insert into public.employee_documents (
    organization_id, employee_id, document_type, title, valid_until, requires_renewal, source_key, created_by
  )
  select organization_id, id, 'bhp', 'Szkolenie BHP', bhp_valid_until, true, 'profile_bhp', created_by
  from public.employee_profiles where bhp_valid_until is not null
  union all
  select organization_id, id, 'medical', 'Badania lekarskie', medical_valid_until, true, 'profile_medical', created_by
  from public.employee_profiles where medical_valid_until is not null
  on conflict (employee_id, source_key) where source_key is not null do nothing;
  perform set_config('app.hr_migration_seed', 'false', true);
end $$;

do $$
declare employee_row record;
begin
  for employee_row in select id from public.employee_profiles loop
    perform public.refresh_employee_compliance_dates(employee_row.id);
  end loop;
end $$;

-- Historia zmian profilu wykonanych w dotychczasowym module Struktura firmy.
create or replace function public.trg_employee_profile_hr_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_position public.employee_position_history%rowtype;
  current_crew public.employee_crew_history%rowtype;
begin
  if TG_OP = 'INSERT' or OLD.role_title is distinct from NEW.role_title
    or OLD.department is distinct from NEW.department
    or OLD.employment_type is distinct from NEW.employment_type
    or OLD.manager_employee_id is distinct from NEW.manager_employee_id then
    select * into current_position from public.employee_position_history
    where employee_id = NEW.id and valid_until is null order by valid_from desc, created_at desc limit 1;
    if current_position.id is not null and current_position.valid_from = current_date then
      update public.employee_position_history set
        role_title = NEW.role_title, department = NEW.department, employment_type = NEW.employment_type,
        manager_employee_id = NEW.manager_employee_id
      where id = current_position.id;
    else
      update public.employee_position_history set valid_until = current_date - 1
      where employee_id = NEW.id and valid_until is null and valid_from < current_date;
      insert into public.employee_position_history (
        organization_id, employee_id, role_title, department, employment_type,
        manager_employee_id, valid_from, created_by
      ) values (
        NEW.organization_id, NEW.id, NEW.role_title, NEW.department, NEW.employment_type,
        NEW.manager_employee_id, current_date, auth.uid()
      );
    end if;
  end if;

  if TG_OP = 'INSERT' or OLD.crew_id is distinct from NEW.crew_id then
    select * into current_crew from public.employee_crew_history
    where employee_id = NEW.id and valid_until is null order by valid_from desc, created_at desc limit 1;
    if current_crew.id is not null and current_crew.valid_from = current_date then
      update public.employee_crew_history set crew_id = NEW.crew_id where id = current_crew.id;
    else
      update public.employee_crew_history set valid_until = current_date - 1
      where employee_id = NEW.id and valid_until is null and valid_from < current_date;
      insert into public.employee_crew_history (
        organization_id, employee_id, crew_id, valid_from, created_by
      ) values (NEW.organization_id, NEW.id, NEW.crew_id, current_date, auth.uid());
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists employee_profile_hr_history on public.employee_profiles;
create trigger employee_profile_hr_history
after insert or update of role_title, department, employment_type, manager_employee_id, crew_id
on public.employee_profiles
for each row execute function public.trg_employee_profile_hr_history();

-- Historia poczatkowa dla istniejacych pracownikow.
insert into public.employee_position_history (
  organization_id, employee_id, role_title, department, employment_type, manager_employee_id, valid_from, created_by
)
select organization_id, id, role_title, department, employment_type, manager_employee_id, created_at::date, created_by
from public.employee_profiles ep
where not exists (select 1 from public.employee_position_history h where h.employee_id = ep.id);

insert into public.employee_crew_history (
  organization_id, employee_id, crew_id, valid_from, created_by
)
select organization_id, id, crew_id, created_at::date, created_by
from public.employee_profiles ep
where not exists (select 1 from public.employee_crew_history h where h.employee_id = ep.id);

-- Kontrolowana zmiana stanowiska z data obowiazywania.
create or replace function public.set_employee_position_assignment(
  p_employee_id uuid,
  p_role_title text,
  p_department text,
  p_employment_type text,
  p_manager_employee_id uuid,
  p_valid_from date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  emp public.employee_profiles%rowtype;
  current_row public.employee_position_history%rowtype;
  result_id uuid;
begin
  select * into emp from public.employee_profiles where id = p_employee_id;
  if emp.id is null then raise exception 'Nie znaleziono pracownika'; end if;
  if not (public.is_member_of(emp.organization_id) and public.can_see_all_cases(emp.organization_id)) then raise exception 'Brak uprawnien'; end if;
  if p_valid_from > current_date then raise exception 'Zmiane przyszla dodaj w dniu wejscia w zycie'; end if;
  select * into current_row from public.employee_position_history
  where employee_id = emp.id and valid_until is null order by valid_from desc, created_at desc limit 1;
  if current_row.id is not null and p_valid_from < current_row.valid_from then raise exception 'Data nie moze byc wczesniejsza niz obecne przypisanie'; end if;
  if current_row.id is not null and p_valid_from = current_row.valid_from then
    update public.employee_position_history set
      role_title = p_role_title, department = p_department, employment_type = p_employment_type,
      manager_employee_id = p_manager_employee_id, notes = p_notes
    where id = current_row.id returning id into result_id;
  else
    update public.employee_position_history set valid_until = p_valid_from - 1 where id = current_row.id;
    insert into public.employee_position_history (
      organization_id, employee_id, role_title, department, employment_type,
      manager_employee_id, valid_from, notes, created_by
    ) values (
      emp.organization_id, emp.id, p_role_title, p_department, p_employment_type,
      p_manager_employee_id, p_valid_from, p_notes, auth.uid()
    ) returning id into result_id;
  end if;
  perform set_config('app.hr_history_manual', 'true', true);
  update public.employee_profiles set
    role_title = p_role_title, department = p_department, employment_type = p_employment_type,
    manager_employee_id = p_manager_employee_id
  where id = emp.id;
  return result_id;
end;
$$;

create or replace function public.set_employee_crew_assignment(
  p_employee_id uuid,
  p_crew_id uuid,
  p_valid_from date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  emp public.employee_profiles%rowtype;
  current_row public.employee_crew_history%rowtype;
  result_id uuid;
begin
  select * into emp from public.employee_profiles where id = p_employee_id;
  if emp.id is null then raise exception 'Nie znaleziono pracownika'; end if;
  if not (public.is_member_of(emp.organization_id) and public.can_see_all_cases(emp.organization_id)) then raise exception 'Brak uprawnien'; end if;
  if p_valid_from > current_date then raise exception 'Zmiane przyszla dodaj w dniu wejscia w zycie'; end if;
  if p_crew_id is not null and not exists (select 1 from public.crews where id = p_crew_id and organization_id = emp.organization_id) then raise exception 'Nieprawidlowa brygada'; end if;
  select * into current_row from public.employee_crew_history
  where employee_id = emp.id and valid_until is null order by valid_from desc, created_at desc limit 1;
  if current_row.id is not null and p_valid_from < current_row.valid_from then raise exception 'Data nie moze byc wczesniejsza niz obecne przypisanie'; end if;
  if current_row.id is not null and p_valid_from = current_row.valid_from then
    update public.employee_crew_history set crew_id = p_crew_id, notes = p_notes
    where id = current_row.id returning id into result_id;
  else
    update public.employee_crew_history set valid_until = p_valid_from - 1 where id = current_row.id;
    insert into public.employee_crew_history (
      organization_id, employee_id, crew_id, valid_from, notes, created_by
    ) values (emp.organization_id, emp.id, p_crew_id, p_valid_from, p_notes, auth.uid())
    returning id into result_id;
  end if;
  perform set_config('app.hr_history_manual', 'true', true);
  update public.employee_profiles set crew_id = p_crew_id where id = emp.id;
  return result_id;
end;
$$;

-- Trigger profilu pomija duplikat, gdy historie zapisala kontrolowana funkcja RPC.
create or replace function public.trg_employee_profile_hr_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_position public.employee_position_history%rowtype;
  current_crew public.employee_crew_history%rowtype;
begin
  if current_setting('app.hr_history_manual', true) = 'true' then return NEW; end if;
  if TG_OP = 'INSERT' or OLD.role_title is distinct from NEW.role_title
    or OLD.department is distinct from NEW.department or OLD.employment_type is distinct from NEW.employment_type
    or OLD.manager_employee_id is distinct from NEW.manager_employee_id then
    select * into current_position from public.employee_position_history
    where employee_id = NEW.id and valid_until is null order by valid_from desc, created_at desc limit 1;
    if current_position.id is not null and current_position.valid_from = current_date then
      update public.employee_position_history set role_title = NEW.role_title, department = NEW.department,
        employment_type = NEW.employment_type, manager_employee_id = NEW.manager_employee_id
      where id = current_position.id;
    else
      update public.employee_position_history set valid_until = current_date - 1
      where employee_id = NEW.id and valid_until is null and valid_from < current_date;
      insert into public.employee_position_history (
        organization_id, employee_id, role_title, department, employment_type, manager_employee_id, valid_from, created_by
      ) values (NEW.organization_id, NEW.id, NEW.role_title, NEW.department, NEW.employment_type, NEW.manager_employee_id, current_date, auth.uid());
    end if;
  end if;
  if TG_OP = 'INSERT' or OLD.crew_id is distinct from NEW.crew_id then
    select * into current_crew from public.employee_crew_history
    where employee_id = NEW.id and valid_until is null order by valid_from desc, created_at desc limit 1;
    if current_crew.id is not null and current_crew.valid_from = current_date then
      update public.employee_crew_history set crew_id = NEW.crew_id where id = current_crew.id;
    else
      update public.employee_crew_history set valid_until = current_date - 1
      where employee_id = NEW.id and valid_until is null and valid_from < current_date;
      insert into public.employee_crew_history (organization_id, employee_id, crew_id, valid_from, created_by)
      values (NEW.organization_id, NEW.id, NEW.crew_id, current_date, auth.uid());
    end if;
  end if;
  return NEW;
end;
$$;

revoke all on function public.set_employee_position_assignment(uuid, text, text, text, uuid, date, text) from public;
grant execute on function public.set_employee_position_assignment(uuid, text, text, text, uuid, date, text) to authenticated;
revoke all on function public.set_employee_crew_assignment(uuid, uuid, date, text) from public;
grant execute on function public.set_employee_crew_assignment(uuid, uuid, date, text) to authenticated;

select '0040_employee_hr_documents_history: OK' as migration_status;
