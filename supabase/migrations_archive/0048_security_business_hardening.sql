-- Security and business hardening:
-- 1. safe organization member directory without exposing auth.users through a view,
-- 2. commercial case values separated from operational case data,
-- 3. role-aware fleet, warehouse, equipment and policy access,
-- 4. durable notification dispatch deduplication.

-- ── Safe organization member directory ───────────────────────────────────────

create table if not exists public.user_directory_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_directory_profiles enable row level security;

create or replace function public.can_view_directory_profile(target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    target_user_id = auth.uid()
    or exists (
      select 1
      from public.organization_members target_member
      join public.organization_members current_member
        on current_member.organization_id = target_member.organization_id
      where target_member.user_id = target_user_id
        and current_member.user_id = auth.uid()
    );
$$;

revoke all on function public.can_view_directory_profile(uuid) from public;
grant execute on function public.can_view_directory_profile(uuid) to authenticated;

drop policy if exists user_directory_profiles_select on public.user_directory_profiles;
create policy user_directory_profiles_select on public.user_directory_profiles
for select to authenticated
using (public.can_view_directory_profile(user_id));

revoke all on public.user_directory_profiles from anon, authenticated;
grant select on public.user_directory_profiles to authenticated;

create or replace function public.sync_user_directory_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_directory_profiles (user_id, email, updated_at)
  values (NEW.id, coalesce(NEW.email, ''), now())
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = excluded.updated_at;
  return NEW;
end;
$$;

revoke all on function public.sync_user_directory_profile() from public, anon, authenticated;

drop trigger if exists sync_user_directory_profile on auth.users;
create trigger sync_user_directory_profile
after insert or update of email on auth.users
for each row execute function public.sync_user_directory_profile();

insert into public.user_directory_profiles (user_id, email, updated_at)
select id, coalesce(email, ''), now()
from auth.users
on conflict (user_id) do update
set email = excluded.email,
    updated_at = excluded.updated_at;

drop view if exists public.org_member_profiles;
create view public.org_member_profiles
with (security_invoker = true, security_barrier = true) as
select
  m.organization_id,
  m.user_id,
  m.role,
  p.email
from public.organization_members m
join public.user_directory_profiles p on p.user_id = m.user_id;

revoke all on public.org_member_profiles from anon, authenticated;
grant select on public.org_member_profiles to authenticated;

-- ── Commercial case data ─────────────────────────────────────────────────────

create table if not exists public.case_commercial_details (
  case_id uuid primary key references public.cases(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimated_value numeric check (estimated_value is null or estimated_value >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists case_commercial_details_org_idx
  on public.case_commercial_details (organization_id);

insert into public.case_commercial_details (
  case_id, organization_id, estimated_value, updated_at, updated_by
)
select id, organization_id, estimated_value, updated_at, created_by
from public.cases
where estimated_value is not null
on conflict (case_id) do update
set estimated_value = excluded.estimated_value,
    organization_id = excluded.organization_id,
    updated_at = excluded.updated_at;

update public.cases
set estimated_value = null
where estimated_value is not null;

alter table public.cases
  drop constraint if exists cases_estimated_value_moved;
alter table public.cases
  add constraint cases_estimated_value_moved check (estimated_value is null);

comment on column public.cases.estimated_value is
  'Deprecated security placeholder. Financial value is stored in case_commercial_details.';

alter table public.case_commercial_details enable row level security;

drop policy if exists case_commercial_details_select on public.case_commercial_details;
drop policy if exists case_commercial_details_insert on public.case_commercial_details;
drop policy if exists case_commercial_details_update on public.case_commercial_details;
drop policy if exists case_commercial_details_delete on public.case_commercial_details;

create policy case_commercial_details_select on public.case_commercial_details
for select to authenticated
using (
  public.is_member_of(organization_id)
  and public.can_see_case_commercial(organization_id)
  and exists (
    select 1 from public.cases c
    where c.id = case_commercial_details.case_id
      and c.organization_id = case_commercial_details.organization_id
      and (
        public.can_see_all_cases(c.organization_id)
        or c.created_by = auth.uid()
        or public.is_case_assignee(c.id)
      )
  )
);

create policy case_commercial_details_insert on public.case_commercial_details
for insert to authenticated
with check (
  public.is_member_of(organization_id)
  and public.can_see_case_commercial(organization_id)
  and coalesce(updated_by, auth.uid()) = auth.uid()
  and exists (
    select 1 from public.cases c
    where c.id = case_commercial_details.case_id
      and c.organization_id = case_commercial_details.organization_id
      and (
        public.can_see_all_cases(c.organization_id)
        or c.created_by = auth.uid()
        or public.is_case_assignee(c.id)
      )
  )
);

create policy case_commercial_details_update on public.case_commercial_details
for update to authenticated
using (
  public.is_member_of(organization_id)
  and public.can_see_case_commercial(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_case_commercial(organization_id)
  and coalesce(updated_by, auth.uid()) = auth.uid()
  and exists (
    select 1 from public.cases c
    where c.id = case_commercial_details.case_id
      and c.organization_id = case_commercial_details.organization_id
      and (
        public.can_see_all_cases(c.organization_id)
        or c.created_by = auth.uid()
        or public.is_case_assignee(c.id)
      )
  )
);

create policy case_commercial_details_delete on public.case_commercial_details
for delete to authenticated
using (
  public.is_member_of(organization_id)
  and public.can_see_case_commercial(organization_id)
  and exists (
    select 1 from public.cases c
    where c.id = case_commercial_details.case_id
      and c.organization_id = case_commercial_details.organization_id
      and (
        public.can_see_all_cases(c.organization_id)
        or c.created_by = auth.uid()
        or public.is_case_assignee(c.id)
      )
  )
);

grant select, insert, update, delete on public.case_commercial_details to authenticated;

create or replace function public.stamp_case_commercial_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists stamp_case_commercial_details on public.case_commercial_details;
create trigger stamp_case_commercial_details
before insert or update on public.case_commercial_details
for each row execute function public.stamp_case_commercial_details();

drop view if exists public.case_records;
create view public.case_records
with (security_invoker = true, security_barrier = true) as
select
  c.id,
  c.organization_id,
  c.crew_id,
  c.client_name,
  c.phone,
  c.email,
  c.location,
  c.work_description,
  c.status,
  c.source,
  commercial.estimated_value,
  c.next_contact_date,
  c.realization_end_date,
  c.contract_number,
  c.contract_date,
  c.created_by,
  c.created_at,
  c.updated_at
from public.cases c
left join public.case_commercial_details commercial on commercial.case_id = c.id;

revoke all on public.case_records from anon, authenticated;
grant select on public.case_records to authenticated;

drop policy if exists cases_update on public.cases;
create policy cases_update on public.cases
for update to authenticated
using (
  public.is_member_of(organization_id)
  and (
    public.can_see_all_cases(organization_id)
    or (
      public.my_role_in(organization_id) = 'sales'
      and (created_by = auth.uid() or public.is_case_assignee(id))
    )
  )
)
with check (
  public.is_member_of(organization_id)
  and (
    public.can_see_all_cases(organization_id)
    or (
      public.my_role_in(organization_id) = 'sales'
      and (created_by = auth.uid() or public.is_case_assignee(id))
    )
  )
);

create or replace function public.protect_case_security_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_see_all_cases(OLD.organization_id) and (
    NEW.organization_id is distinct from OLD.organization_id
    or NEW.created_by is distinct from OLD.created_by
  ) then
    raise exception 'Nie można zmienić właściciela ani organizacji sprawy';
  end if;
  if NEW.estimated_value is not null then
    raise exception 'Wartość sprawy należy zapisać w danych handlowych';
  end if;
  return NEW;
end;
$$;

drop trigger if exists protect_case_security_columns on public.cases;
create trigger protect_case_security_columns
before update on public.cases
for each row execute function public.protect_case_security_columns();

create or replace function public.trg_log_case_commercial_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  case_name text;
begin
  if TG_OP = 'UPDATE' and OLD.estimated_value is not distinct from NEW.estimated_value then
    return NEW;
  end if;
  if TG_OP = 'INSERT' and NEW.estimated_value is null then
    return NEW;
  end if;

  select client_name into case_name from public.cases where id = NEW.case_id;
  perform public.log_organization_activity(
    NEW.organization_id,
    'sprawa',
    case when TG_OP = 'INSERT' then 'value_set' else 'value_changed' end,
    case when TG_OP = 'INSERT' then 'Ustawienie szacowanej wartości sprawy' else 'Zmiana szacowanej wartości sprawy' end,
    coalesce(case_name, 'Sprawa') || ': '
      || case when TG_OP = 'INSERT' then '' else coalesce(OLD.estimated_value::text, '—') || ' → ' end
      || coalesce(NEW.estimated_value::text, '—'),
    NEW.case_id,
    'case',
    NEW.case_id,
    null,
    NEW.updated_by
  );
  return NEW;
end;
$$;

drop trigger if exists log_case_commercial_activity on public.case_commercial_details;
create trigger log_case_commercial_activity
after insert or update of estimated_value on public.case_commercial_details
for each row execute function public.trg_log_case_commercial_activity();

-- ── Fleet, warehouse, equipment and company policies ────────────────────────

create or replace function public.can_operate_resources(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.my_role_in(target_org) in ('owner', 'office', 'manager', 'brygadzista', 'member');
$$;

revoke all on function public.can_operate_resources(uuid) from public;
grant execute on function public.can_operate_resources(uuid) to authenticated;

drop policy if exists vehicles_all on public.vehicles;
drop policy if exists vehicles_select on public.vehicles;
drop policy if exists vehicles_manage on public.vehicles;
create policy vehicles_select on public.vehicles for select to authenticated
using (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id));
create policy vehicles_manage on public.vehicles for all to authenticated
using (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id))
with check (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id));

drop policy if exists vehicle_service_all on public.vehicle_service_entries;
drop policy if exists vehicle_service_select on public.vehicle_service_entries;
drop policy if exists vehicle_service_manage on public.vehicle_service_entries;
create policy vehicle_service_select on public.vehicle_service_entries for select to authenticated
using (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id));
create policy vehicle_service_manage on public.vehicle_service_entries for all to authenticated
using (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id))
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
  and exists (
    select 1 from public.vehicles v
    where v.id = vehicle_service_entries.vehicle_id
      and v.organization_id = vehicle_service_entries.organization_id
  )
);

drop policy if exists company_policies_all on public.company_policies;
drop policy if exists company_policies_manage on public.company_policies;
create policy company_policies_manage on public.company_policies for all to authenticated
using (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id))
with check (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id));

drop policy if exists warehouse_items_all on public.warehouse_items;
drop policy if exists warehouse_items_select on public.warehouse_items;
drop policy if exists warehouse_items_manage on public.warehouse_items;
create policy warehouse_items_select on public.warehouse_items for select to authenticated
using (public.is_member_of(organization_id) and public.can_operate_resources(organization_id));
create policy warehouse_items_manage on public.warehouse_items for all to authenticated
using (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id))
with check (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id));

drop policy if exists warehouse_movements_all on public.warehouse_movements;
drop policy if exists warehouse_movements_select on public.warehouse_movements;
drop policy if exists warehouse_movements_insert on public.warehouse_movements;
create policy warehouse_movements_select on public.warehouse_movements for select to authenticated
using (public.is_member_of(organization_id) and public.can_operate_resources(organization_id));
create policy warehouse_movements_insert on public.warehouse_movements for insert to authenticated
with check (
  public.is_member_of(organization_id)
  and public.can_operate_resources(organization_id)
  and created_by = auth.uid()
  and exists (
    select 1 from public.warehouse_items wi
    where wi.id = warehouse_movements.warehouse_item_id
      and wi.organization_id = warehouse_movements.organization_id
  )
  and (
    case_id is null
    or exists (
      select 1 from public.cases c
      where c.id = warehouse_movements.case_id
        and c.organization_id = warehouse_movements.organization_id
        and (
          public.can_see_all_cases(c.organization_id)
          or c.created_by = auth.uid()
          or public.is_case_assignee(c.id)
        )
    )
  )
);

drop policy if exists warehouse_audit_log_all on public.warehouse_audit_log;
drop policy if exists warehouse_audit_log_select on public.warehouse_audit_log;
drop policy if exists warehouse_audit_log_insert on public.warehouse_audit_log;
create policy warehouse_audit_log_select on public.warehouse_audit_log for select to authenticated
using (public.is_member_of(organization_id) and public.can_operate_resources(organization_id));
create policy warehouse_audit_log_insert on public.warehouse_audit_log for insert to authenticated
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
  and coalesce(created_by, auth.uid()) = auth.uid()
);

create or replace function public.validate_warehouse_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_org uuid;
  available numeric;
begin
  select organization_id, quantity
  into item_org, available
  from public.warehouse_items
  where id = NEW.warehouse_item_id
  for update;

  if item_org is null or item_org <> NEW.organization_id then
    raise exception 'Pozycja magazynowa nie należy do organizacji';
  end if;
  if NEW.movement_type = 'out' and NEW.quantity > available then
    raise exception 'Niewystarczający stan magazynowy';
  end if;
  NEW.created_by := auth.uid();
  return NEW;
end;
$$;

drop trigger if exists warehouse_movement_set_created_by on public.warehouse_movements;
drop trigger if exists warehouse_movement_validate on public.warehouse_movements;
create trigger warehouse_movement_validate
before insert on public.warehouse_movements
for each row execute function public.validate_warehouse_movement();

create or replace function public.apply_warehouse_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.warehouse_items
  set quantity = case
    when NEW.movement_type = 'in' then quantity + NEW.quantity
    else quantity - NEW.quantity
  end
  where id = NEW.warehouse_item_id;
  return NEW;
end;
$$;

create or replace function public.protect_warehouse_item_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if exists (
      select 1 from public.warehouse_movements wm
      where wm.warehouse_item_id = OLD.id
    ) then
      raise exception 'Nie można usunąć pozycji z historią ruchów';
    end if;
    return OLD;
  end if;

  if NEW.organization_id is distinct from OLD.organization_id then
    raise exception 'Nie można przenieść pozycji do innej organizacji';
  end if;
  if NEW.quantity is distinct from OLD.quantity and pg_trigger_depth() <= 1 then
    raise exception 'Stan magazynowy można zmieniać wyłącznie przez ruch magazynowy';
  end if;
  return NEW;
end;
$$;

drop trigger if exists protect_warehouse_item_history on public.warehouse_items;
create trigger protect_warehouse_item_history
before update or delete on public.warehouse_items
for each row execute function public.protect_warehouse_item_history();

drop policy if exists equipment_all on public.equipment;
drop policy if exists equipment_select on public.equipment;
drop policy if exists equipment_manage on public.equipment;
create policy equipment_select on public.equipment for select to authenticated
using (public.is_member_of(organization_id) and public.can_operate_resources(organization_id));
create policy equipment_manage on public.equipment for all to authenticated
using (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id))
with check (public.is_member_of(organization_id) and public.can_see_all_cases(organization_id));

drop policy if exists equipment_assignments_all on public.equipment_assignments;
drop policy if exists equipment_assignments_select on public.equipment_assignments;
drop policy if exists equipment_assignments_insert on public.equipment_assignments;
drop policy if exists equipment_assignments_update on public.equipment_assignments;
create policy equipment_assignments_select on public.equipment_assignments for select to authenticated
using (public.is_member_of(organization_id) and public.can_operate_resources(organization_id));
create policy equipment_assignments_insert on public.equipment_assignments for insert to authenticated
with check (
  public.is_member_of(organization_id)
  and public.can_operate_resources(organization_id)
  and created_by = auth.uid()
);
create policy equipment_assignments_update on public.equipment_assignments for update to authenticated
using (public.is_member_of(organization_id) and public.can_operate_resources(organization_id))
with check (public.is_member_of(organization_id) and public.can_operate_resources(organization_id));

create or replace function public.validate_equipment_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  equipment_org uuid;
  equipment_total numeric;
  already_assigned numeric;
  is_manager boolean;
begin
  select organization_id, total_quantity
  into equipment_org, equipment_total
  from public.equipment
  where id = NEW.equipment_id
  for update;

  if equipment_org is null or equipment_org <> NEW.organization_id then
    raise exception 'Sprzęt nie należy do organizacji';
  end if;

  is_manager := public.can_see_all_cases(NEW.organization_id);
  if TG_OP = 'UPDATE' and not is_manager and (
    NEW.organization_id is distinct from OLD.organization_id
    or NEW.equipment_id is distinct from OLD.equipment_id
    or NEW.case_id is distinct from OLD.case_id
    or NEW.site_label is distinct from OLD.site_label
    or NEW.quantity is distinct from OLD.quantity
    or NEW.assigned_date is distinct from OLD.assigned_date
    or NEW.created_by is distinct from OLD.created_by
  ) then
    raise exception 'Rola operacyjna może wyłącznie oznaczyć zwrot sprzętu';
  end if;

  if TG_OP = 'INSERT' then
    NEW.created_by := auth.uid();
    if NEW.case_id is null and nullif(trim(coalesce(NEW.site_label, '')), '') is null then
      raise exception 'Wybierz sprawę albo podaj miejsce wydania';
    end if;
    if NEW.case_id is not null and not exists (
      select 1 from public.cases c
      where c.id = NEW.case_id
        and c.organization_id = NEW.organization_id
        and (
          public.can_see_all_cases(c.organization_id)
          or c.created_by = auth.uid()
          or public.is_case_assignee(c.id)
        )
    ) then
      raise exception 'Brak dostępu do wskazanej sprawy';
    end if;

    select coalesce(sum(quantity), 0)
    into already_assigned
    from public.equipment_assignments
    where equipment_id = NEW.equipment_id
      and returned = false;
    if already_assigned + NEW.quantity > equipment_total then
      raise exception 'Niewystarczająca dostępna ilość sprzętu';
    end if;
  end if;

  if NEW.returned and NEW.returned_date is null then
    NEW.returned_date := current_date;
  end if;
  return NEW;
end;
$$;

drop trigger if exists equipment_assignment_validate on public.equipment_assignments;
create trigger equipment_assignment_validate
before insert or update on public.equipment_assignments
for each row execute function public.validate_equipment_assignment();

create or replace function public.protect_equipment_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_quantity numeric;
begin
  if TG_OP = 'DELETE' then
    if exists (
      select 1 from public.equipment_assignments ea
      where ea.equipment_id = OLD.id
    ) then
      raise exception 'Nie można usunąć sprzętu z historią wydań';
    end if;
    return OLD;
  end if;

  if NEW.organization_id is distinct from OLD.organization_id then
    raise exception 'Nie można przenieść sprzętu do innej organizacji';
  end if;
  select coalesce(sum(quantity), 0)
  into active_quantity
  from public.equipment_assignments
  where equipment_id = OLD.id
    and returned = false;
  if NEW.total_quantity < active_quantity then
    raise exception 'Ilość łączna nie może być niższa niż ilość aktualnie wydana';
  end if;
  return NEW;
end;
$$;

drop trigger if exists protect_equipment_history on public.equipment;
create trigger protect_equipment_history
before update or delete on public.equipment
for each row execute function public.protect_equipment_history();

revoke delete on public.warehouse_movements from authenticated;
revoke delete on public.equipment_assignments from authenticated;

-- ── Notification dispatch ledger ─────────────────────────────────────────────

create table if not exists public.notification_dispatch_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  entity_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists notification_dispatch_sender_created_idx
  on public.notification_dispatch_events (sender_user_id, created_at desc);

alter table public.notification_dispatch_events enable row level security;
revoke all on public.notification_dispatch_events from anon, authenticated;
