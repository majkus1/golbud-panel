-- Centralny dziennik biznesowy: kto, co, kiedy (sprawy, finanse, magazyn, zespół…).

create table if not exists public.organization_activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  category text not null check (category in (
    'sprawa', 'platnosc', 'faktura', 'magazyn', 'sprzet', 'czas', 'zespol', 'firma', 'przypisanie', 'prace_dodatkowe', 'zadanie'
  )),
  entity_type text not null default '',
  entity_id uuid,
  action text not null,
  summary text not null,
  details text,
  meta jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists org_activity_log_org_created_idx
  on public.organization_activity_log (organization_id, created_at desc);

create index if not exists org_activity_log_org_category_idx
  on public.organization_activity_log (organization_id, category, created_at desc);

create index if not exists org_activity_log_case_idx
  on public.organization_activity_log (case_id, created_at desc)
  where case_id is not null;

alter table public.organization_activity_log enable row level security;

drop policy if exists org_activity_log_select on public.organization_activity_log;
create policy org_activity_log_select on public.organization_activity_log
for select using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

-- Wstawianie: triggery (security definer) + RPC z aplikacji
drop policy if exists org_activity_log_insert on public.organization_activity_log;
create policy org_activity_log_insert on public.organization_activity_log
for insert with check (
  public.is_member_of(organization_id)
);

grant select, insert on public.organization_activity_log to authenticated;

create or replace function public.log_organization_activity(
  p_organization_id uuid,
  p_category text,
  p_action text,
  p_summary text,
  p_details text default null,
  p_case_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_meta jsonb default null,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  actor uuid;
begin
  actor := coalesce(p_created_by, auth.uid());
  insert into public.organization_activity_log (
    organization_id, case_id, category, entity_type, entity_id, action, summary, details, meta, created_by
  ) values (
    p_organization_id,
    p_case_id,
    p_category,
    coalesce(p_entity_type, p_category),
    p_entity_id,
    p_action,
    left(p_summary, 500),
    p_details,
    p_meta,
    actor
  )
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.log_organization_activity(uuid, text, text, text, text, uuid, text, uuid, jsonb, uuid) from public;
grant execute on function public.log_organization_activity(uuid, text, text, text, text, uuid, text, uuid, jsonb, uuid) to authenticated;

-- ── Sprawy ────────────────────────────────────────────────────────────────────
create or replace function public.trg_log_case_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'sprawa', 'created',
      'Nowe zlecenie: ' || NEW.client_name,
      coalesce(NEW.location, ''),
      NEW.id, 'case', NEW.id,
      jsonb_build_object('status', NEW.status)
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.status is distinct from NEW.status then
      perform public.log_organization_activity(
        NEW.organization_id, 'sprawa', 'status_changed',
        'Status: «' || OLD.status || '» → «' || NEW.status || '»',
        'Sprawa: ' || NEW.client_name,
        NEW.id, 'case', NEW.id,
        jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status)
      );
    end if;
    if OLD.estimated_value is distinct from NEW.estimated_value then
      perform public.log_organization_activity(
        NEW.organization_id, 'sprawa', 'value_changed',
        'Zmiana szacowanej wartości sprawy',
        NEW.client_name || ': ' || coalesce(OLD.estimated_value::text, '—') || ' → ' || coalesce(NEW.estimated_value::text, '—'),
        NEW.id, 'case', NEW.id, null
      );
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    perform public.log_organization_activity(
      OLD.organization_id, 'sprawa', 'deleted',
      'Usunięto sprawę: ' || OLD.client_name,
      coalesce(OLD.location, ''),
      null, 'case', OLD.id,
      jsonb_build_object('status', OLD.status)
    );
    return OLD;
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists log_case_activity on public.cases;
create trigger log_case_activity
after insert or update or delete on public.cases
for each row execute function public.trg_log_case_activity();

-- ── Płatności ───────────────────────────────────────────────────────────────
create or replace function public.trg_log_payment_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cname text;
begin
  select client_name into cname from public.cases where id = coalesce(NEW.case_id, OLD.case_id);

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'platnosc', 'created',
      'Nowa płatność: ' || NEW.title,
      'Kwota: ' || NEW.amount_due::text || ' zł' || case when cname is not null then ' · ' || cname else '' end,
      NEW.case_id, 'payment', NEW.id, null
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.amount_paid is distinct from NEW.amount_paid then
      perform public.log_organization_activity(
        NEW.organization_id, 'platnosc', 'payment_received',
        'Wpłata: ' || NEW.title,
        'Wpłacono: ' || OLD.amount_paid::text || ' → ' || NEW.amount_paid::text || ' zł (z ' || NEW.amount_due::text || ')' ||
          case when cname is not null then ' · ' || cname else '' end,
        NEW.case_id, 'payment', NEW.id,
        jsonb_build_object('old_paid', OLD.amount_paid, 'new_paid', NEW.amount_paid)
      );
    elsif OLD.amount_due is distinct from NEW.amount_due then
      perform public.log_organization_activity(
        NEW.organization_id, 'platnosc', 'amount_changed',
        'Zmiana kwoty: ' || NEW.title,
        OLD.amount_due::text || ' → ' || NEW.amount_due::text || ' zł',
        NEW.case_id, 'payment', NEW.id, null
      );
    end if;
    return NEW;
  end if;

  return OLD;
end;
$$;

drop trigger if exists log_payment_activity on public.payments;
create trigger log_payment_activity
after insert or update on public.payments
for each row execute function public.trg_log_payment_activity();

-- ── Faktury ─────────────────────────────────────────────────────────────────
create or replace function public.trg_log_invoice_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cname text;
begin
  select client_name into cname from public.cases where id = coalesce(NEW.case_id, OLD.case_id);

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'faktura', 'created',
      'Utworzono fakturę ' || NEW.number,
      coalesce(cname, ''),
      NEW.case_id, 'invoice', NEW.id,
      jsonb_build_object('kind', NEW.kind, 'status', NEW.status)
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.status is distinct from NEW.status then
      perform public.log_organization_activity(
        NEW.organization_id, 'faktura', 'status_changed',
        'Faktura ' || NEW.number || ': ' || OLD.status || ' → ' || NEW.status,
        coalesce(cname, ''),
        NEW.case_id, 'invoice', NEW.id, null
      );
    end if;
    if OLD.sent_at is null and NEW.sent_at is not null then
      perform public.log_organization_activity(
        NEW.organization_id, 'faktura', 'email_sent',
        'Wysłano fakturę ' || NEW.number || ' e-mailem',
        coalesce(NEW.sent_to, ''),
        NEW.case_id, 'invoice', NEW.id, null
      );
    end if;
    return NEW;
  end if;

  return OLD;
end;
$$;

drop trigger if exists log_invoice_activity on public.invoices;
create trigger log_invoice_activity
after insert or update on public.invoices
for each row execute function public.trg_log_invoice_activity();

-- ── Magazyn (ruchy + audyt pozycji) ─────────────────────────────────────────
create or replace function public.trg_log_warehouse_movement_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lbl text;
  cname text;
begin
  select wi.label into lbl from public.warehouse_items wi where wi.id = NEW.warehouse_item_id;
  if NEW.case_id is not null then
    select client_name into cname from public.cases where id = NEW.case_id;
  end if;

  perform public.log_organization_activity(
    NEW.organization_id, 'magazyn',
    case when NEW.movement_type = 'in' then 'stock_in' else 'stock_out' end,
    case when NEW.movement_type = 'in' then 'Przyjęcie na magazyn' else 'Zużycie z magazynu' end || ': ' || coalesce(lbl, '?'),
    (case when NEW.movement_type = 'in' then '+' else '−' end) || NEW.quantity::text ||
      case when cname is not null then ' · zlecenie: ' || cname else '' end ||
      case when NEW.note is not null and NEW.note <> '' then ' · ' || NEW.note else '' end,
    NEW.case_id, 'warehouse_movement', NEW.id, null, NEW.created_by
  );
  return NEW;
end;
$$;

drop trigger if exists log_warehouse_movement_activity on public.warehouse_movements;
create trigger log_warehouse_movement_activity
after insert on public.warehouse_movements
for each row execute function public.trg_log_warehouse_movement_activity();

create or replace function public.trg_log_warehouse_audit_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_organization_activity(
    NEW.organization_id, 'magazyn', NEW.action,
    case NEW.action
      when 'item_created' then 'Nowa pozycja magazynowa: ' || NEW.label
      when 'items_imported' then 'Import z katalogu: ' || NEW.label
      when 'min_quantity_changed' then 'Zmiana stanu min.: ' || NEW.label
      else NEW.label
    end,
    NEW.details,
    null, 'warehouse_item', NEW.warehouse_item_id, null, NEW.created_by
  );
  return NEW;
end;
$$;

drop trigger if exists log_warehouse_audit_activity on public.warehouse_audit_log;
create trigger log_warehouse_audit_activity
after insert on public.warehouse_audit_log
for each row execute function public.trg_log_warehouse_audit_activity();

-- ── Sprzęt ──────────────────────────────────────────────────────────────────
create or replace function public.trg_log_equipment_assignment_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ename text;
  cname text;
begin
  select e.name into ename from public.equipment e where e.id = coalesce(NEW.equipment_id, OLD.equipment_id);
  if coalesce(NEW.case_id, OLD.case_id) is not null then
    select client_name into cname from public.cases where id = coalesce(NEW.case_id, OLD.case_id);
  end if;

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'sprzet', 'assigned',
      'Wydano sprzęt: ' || coalesce(ename, '?'),
      NEW.quantity::text || ' szt.' || case when cname is not null then ' · ' || cname else coalesce(' · ' || NEW.site_label, '') end,
      NEW.case_id, 'equipment_assignment', NEW.id, null, NEW.created_by
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and OLD.returned = false and NEW.returned = true then
    perform public.log_organization_activity(
      NEW.organization_id, 'sprzet', 'returned',
      'Zwrot sprzętu: ' || coalesce(ename, '?'),
      coalesce(cname, coalesce(NEW.site_label, '')),
      NEW.case_id, 'equipment_assignment', NEW.id, null
    );
    return NEW;
  end if;

  return NEW;
end;
$$;

drop trigger if exists log_equipment_assignment_activity on public.equipment_assignments;
create trigger log_equipment_assignment_activity
after insert or update on public.equipment_assignments
for each row execute function public.trg_log_equipment_assignment_activity();

-- ── Czas pracy ──────────────────────────────────────────────────────────────
create or replace function public.trg_log_work_hours_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cname text;
  scope text;
begin
  if coalesce(NEW.case_id, OLD.case_id) is not null then
    select client_name into cname from public.cases where id = coalesce(NEW.case_id, OLD.case_id);
  end if;
  scope := coalesce(cname, coalesce(NEW.site_label, OLD.site_label, 'budowa'));

  if TG_OP = 'INSERT' and coalesce(NEW.hours, 0) > 0 then
    perform public.log_organization_activity(
      NEW.organization_id, 'czas', 'hours_logged',
      'Godziny: ' || NEW.worker_name,
      NEW.hours::text || ' h · ' || scope || ' · ' || NEW.work_date::text,
      NEW.case_id, 'work_hour', NEW.id, null, NEW.created_by
    );
  elsif TG_OP = 'UPDATE' and OLD.hours is distinct from NEW.hours then
    perform public.log_organization_activity(
      NEW.organization_id, 'czas', 'hours_changed',
      'Korekta godzin: ' || NEW.worker_name,
      OLD.hours::text || ' → ' || NEW.hours::text || ' h · ' || scope || ' · ' || NEW.work_date::text,
      NEW.case_id, 'work_hour', NEW.id, null
    );
  elsif TG_OP = 'DELETE' then
    perform public.log_organization_activity(
      OLD.organization_id, 'czas', 'hours_deleted',
      'Usunięto wpis godzin: ' || OLD.worker_name,
      OLD.hours::text || ' h · ' || scope || ' · ' || OLD.work_date::text,
      OLD.case_id, 'work_hour', OLD.id, null
    );
    return OLD;
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists log_work_hours_activity on public.work_hours;
create trigger log_work_hours_activity
after insert or update or delete on public.work_hours
for each row execute function public.trg_log_work_hours_activity();

-- ── Przypisania do sprawy ───────────────────────────────────────────────────
create or replace function public.trg_log_case_assignee_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c_org uuid;
  cname text;
  uemail text;
begin
  select c.organization_id, c.client_name into c_org, cname
  from public.cases c where c.id = coalesce(NEW.case_id, OLD.case_id);

  select u.email::text into uemail from auth.users u where u.id = coalesce(NEW.user_id, OLD.user_id);

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      c_org, 'przypisanie', 'assigned',
      'Przypisano do sprawy: ' || coalesce(cname, '?'),
      coalesce(uemail, 'użytkownik'),
      NEW.case_id, 'case_assignee', NEW.user_id, null
    );
  elsif TG_OP = 'DELETE' then
    perform public.log_organization_activity(
      c_org, 'przypisanie', 'unassigned',
      'Usunięto z sprawy: ' || coalesce(cname, '?'),
      coalesce(uemail, 'użytkownik'),
      OLD.case_id, 'case_assignee', OLD.user_id, null
    );
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists log_case_assignee_activity on public.case_assignees;
create trigger log_case_assignee_activity
after insert or delete on public.case_assignees
for each row execute function public.trg_log_case_assignee_activity();

-- ── Prace dodatkowe ──────────────────────────────────────────────────────────
create or replace function public.trg_log_extra_work_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cname text;
begin
  select client_name into cname from public.cases where id = coalesce(NEW.case_id, OLD.case_id);

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'prace_dodatkowe', 'created',
      'Praca dodatkowa: ' || left(NEW.description, 80),
      NEW.line_total::text || ' zł' || case when cname is not null then ' · ' || cname else '' end,
      NEW.case_id, 'extra_work', NEW.id, null
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and OLD.accepted = false and NEW.accepted = true then
    perform public.log_organization_activity(
      NEW.organization_id, 'prace_dodatkowe', 'accepted',
      'Zaakceptowano pracę dodatkową',
      left(NEW.description, 120) || ' · ' || NEW.line_total::text || ' zł',
      NEW.case_id, 'extra_work', NEW.id, null
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists log_extra_work_activity on public.extra_works;
create trigger log_extra_work_activity
after insert or update on public.extra_works
for each row execute function public.trg_log_extra_work_activity();

-- ── Zadania wewnętrzne ──────────────────────────────────────────────────────
create or replace function public.trg_log_case_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cname text;
begin
  if NEW.case_id is not null then
    select client_name into cname from public.cases where id = NEW.case_id;
  end if;

  if TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status = 'zrobione' then
    perform public.log_organization_activity(
      NEW.organization_id, 'zadanie', 'completed',
      'Zadanie ukończone: ' || left(NEW.title, 80),
      coalesce(cname, 'bez sprawy'),
      NEW.case_id, 'case_task', NEW.id, null
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists log_case_task_activity on public.case_tasks;
create trigger log_case_task_activity
after update on public.case_tasks
for each row execute function public.trg_log_case_task_activity();

-- ── Dane firmy ────────────────────────────────────────────────────────────────
create or replace function public.trg_log_organization_profile_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and (
    OLD.offer_legal_name is distinct from NEW.offer_legal_name or
    OLD.offer_nip is distinct from NEW.offer_nip or
    OLD.offer_bank_account is distinct from NEW.offer_bank_account or
    OLD.offer_email is distinct from NEW.offer_email or
    OLD.accountant_email is distinct from NEW.accountant_email
  ) then
    perform public.log_organization_activity(
      NEW.id, 'firma', 'profile_updated',
      'Zmieniono dane firmy na ofertach/fakturach',
      'NIP, konto, e-mail lub dane prawne',
      null, 'organization', NEW.id, null
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists log_organization_profile_activity on public.organizations;
create trigger log_organization_profile_activity
after update on public.organizations
for each row execute function public.trg_log_organization_profile_activity();

-- ── Zespół: log w RPC ─────────────────────────────────────────────────────────
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
  owner_cnt int;
  prev_role text;
begin
  select organization_id, role into my_org, my_role
  from public.organization_members
  where user_id = auth.uid() and role = 'owner'
  order by organization_id asc
  limit 1;

  if my_org is null then
    select organization_id, role into my_org, my_role
    from public.organization_members
    where user_id = auth.uid()
    order by organization_id asc
    limit 1;
  end if;

  if my_org is null then
    raise exception 'Brak organizacji dla użytkownika';
  end if;

  if my_role <> 'owner' then
    raise exception 'Tylko właściciel może zmieniać role';
  end if;

  if target_role not in (
    'owner', 'office', 'sales', 'manager', 'brygadzista', 'podwykonawca', 'member'
  ) then
    raise exception 'Nieprawidłowa rola: %', target_role;
  end if;

  select id into target_user from auth.users where lower(email) = lower(target_email);

  if target_user is null then
    raise exception 'Nie znaleziono użytkownika o e-mailu %', target_email;
  end if;

  select role into prev_role from public.organization_members
  where organization_id = my_org and user_id = target_user;

  if exists (
    select 1 from public.organization_members
    where organization_id = my_org and user_id = target_user and role = 'owner'
  ) and target_role <> 'owner' then
    select count(*)::int into owner_cnt
    from public.organization_members
    where organization_id = my_org and role = 'owner';

    if owner_cnt <= 1 then
      raise exception 'W firmie musi zostać co najmniej jeden właściciel';
    end if;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (my_org, target_user, target_role)
  on conflict (organization_id, user_id) do update
    set role = excluded.role;

  perform public.log_organization_activity(
    my_org, 'zespol',
    case when prev_role is null then 'member_added' else 'role_changed' end,
    case when prev_role is null then 'Dodano do zespołu: ' || target_email else 'Zmiana roli: ' || target_email end,
    case when prev_role is null then 'Rola: ' || target_role else coalesce(prev_role, '?') || ' → ' || target_role end,
    null, 'organization_member', target_user,
    jsonb_build_object('email', target_email, 'role', target_role, 'prev_role', prev_role)
  );
end;
$$;

create or replace function public.remove_organization_member(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_org uuid;
  owner_cnt int;
  uemail text;
  urole text;
begin
  select organization_id into my_org
  from public.organization_members
  where user_id = auth.uid() and role = 'owner'
  order by organization_id asc
  limit 1;

  if my_org is null then
    raise exception 'Tylko właściciel może usuwać członków zespołu';
  end if;

  if target_user = auth.uid() then
    raise exception 'Nie możesz usunąć siebie z listy. Poproś innego właściciela lub skontaktuj się z administratorem.';
  end if;

  select om.role, u.email::text into urole, uemail
  from public.organization_members om
  join auth.users u on u.id = om.user_id
  where om.organization_id = my_org and om.user_id = target_user;

  if urole is null then
    raise exception 'Ten użytkownik nie należy do Twojej organizacji';
  end if;

  select count(*)::int into owner_cnt
  from public.organization_members
  where organization_id = my_org and role = 'owner';

  if urole = 'owner' and owner_cnt <= 1 then
    raise exception 'W firmie musi zostać co najmniej jeden właściciel';
  end if;

  delete from public.digest_email_prefs
  where organization_id = my_org and user_id = target_user;

  delete from public.organization_members
  where organization_id = my_org and user_id = target_user;

  perform public.log_organization_activity(
    my_org, 'zespol', 'member_removed',
    'Usunięto z firmy: ' || coalesce(uemail, '?'),
    'Była rola: ' || urole,
    null, 'organization_member', target_user,
    jsonb_build_object('email', uemail, 'role', urole)
  );
end;
$$;

revoke all on function public.set_member_role(text, text) from public;
grant execute on function public.set_member_role(text, text) to authenticated;

revoke all on function public.remove_organization_member(uuid) from public;
grant execute on function public.remove_organization_member(uuid) to authenticated;
