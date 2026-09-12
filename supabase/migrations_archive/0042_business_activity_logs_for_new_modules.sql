-- Dziennik biznesowy dla nowych modulow: rentownosc, faktury kosztowe i HR.
-- Logujemy zdarzenia decyzyjne, a nie kazde techniczne dotkniecie rekordu.

alter table public.organization_activity_log drop constraint if exists organization_activity_log_category_check;
alter table public.organization_activity_log add constraint organization_activity_log_category_check check (category in (
  'sprawa', 'platnosc', 'faktura', 'magazyn', 'sprzet', 'czas', 'zespol', 'firma',
  'przypisanie', 'prace_dodatkowe', 'zadanie', 'rozliczenia', 'rentownosc', 'hr'
));

-- ── Rentownosc: faktury kosztowe hurtowni ────────────────────────────────────
create or replace function public.trg_log_supplier_invoice_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cname text;
  amount numeric;
begin
  if TG_OP = 'INSERT' then
    if NEW.case_id is not null then
      select client_name into cname from public.cases where id = NEW.case_id;
    end if;
    if NEW.import_batch_id is null then
      perform public.log_organization_activity(
        NEW.organization_id, 'rentownosc', 'supplier_invoice_created',
        'Dodano fakture kosztowa: ' || NEW.supplier_name,
        coalesce(NEW.invoice_number, 'bez numeru') || ' · ' || NEW.gross_total::text || ' PLN' ||
          case when cname is not null then ' · ' || cname else ' · bez przypisania do sprawy' end,
        NEW.case_id, 'supplier_invoice', NEW.id,
        jsonb_build_object('category', NEW.category, 'gross_total', NEW.gross_total, 'status', NEW.status, 'source', NEW.source),
        NEW.created_by
      );
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.case_id is not null then
      select client_name into cname from public.cases where id = NEW.case_id;
    end if;
    amount := coalesce(NEW.gross_total, 0) - coalesce(OLD.gross_total, 0);
    if OLD.gross_total is distinct from NEW.gross_total
      or OLD.category is distinct from NEW.category
      or OLD.case_id is distinct from NEW.case_id
      or OLD.status is distinct from NEW.status then
      perform public.log_organization_activity(
        NEW.organization_id, 'rentownosc', 'supplier_invoice_updated',
        'Zmieniono fakture kosztowa: ' || NEW.supplier_name,
        'Kwota: ' || OLD.gross_total::text || ' -> ' || NEW.gross_total::text || ' PLN · kategoria: ' ||
          OLD.category || ' -> ' || NEW.category || case when cname is not null then ' · ' || cname else '' end,
        NEW.case_id, 'supplier_invoice', NEW.id,
        jsonb_build_object(
          'old_gross_total', OLD.gross_total, 'new_gross_total', NEW.gross_total,
          'delta', amount, 'old_category', OLD.category, 'new_category', NEW.category,
          'old_status', OLD.status, 'new_status', NEW.status
        )
      );
    end if;
    if OLD.sent_at is null and NEW.sent_at is not null then
      perform public.log_organization_activity(
        NEW.organization_id, 'rentownosc', 'supplier_invoice_email_sent',
        'Wyslano fakture kosztowa do ksiegowosci',
        NEW.supplier_name || ' · ' || coalesce(NEW.sent_to, 'adres ksiegowosci'),
        NEW.case_id, 'supplier_invoice', NEW.id,
        jsonb_build_object('sent_to', NEW.sent_to)
      );
    end if;
    return NEW;
  end if;

  return OLD;
end;
$$;

drop trigger if exists log_supplier_invoice_activity on public.supplier_invoices;
create trigger log_supplier_invoice_activity
after insert or update on public.supplier_invoices
for each row execute function public.trg_log_supplier_invoice_activity();

-- ── Rentownosc: masowy import faktur ─────────────────────────────────────────
create or replace function public.trg_log_supplier_invoice_import_batch_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_organization_activity(
    NEW.organization_id, 'rentownosc', 'supplier_invoice_imported',
    'Import faktur kosztowych: ' || coalesce(NEW.file_name, NEW.source),
    'Zaimportowano: ' || NEW.row_count::text || ' · duplikaty pominiete: ' || NEW.duplicate_count::text,
    null, 'supplier_invoice_import_batch', NEW.id,
    jsonb_build_object('source', NEW.source, 'row_count', NEW.row_count, 'duplicate_count', NEW.duplicate_count),
    NEW.created_by
  );
  return NEW;
end;
$$;

drop trigger if exists log_supplier_invoice_import_batch_activity on public.supplier_invoice_import_batches;
create trigger log_supplier_invoice_import_batch_activity
after insert on public.supplier_invoice_import_batches
for each row execute function public.trg_log_supplier_invoice_import_batch_activity();

-- ── Rentownosc: plan budzetu budowy ──────────────────────────────────────────
create or replace function public.trg_log_case_profitability_plan_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cname text;
  old_cost numeric;
  new_cost numeric;
begin
  select client_name into cname from public.cases where id = NEW.case_id;
  new_cost := coalesce(NEW.planned_material_cost, 0) + coalesce(NEW.planned_labor_cost, 0) +
    coalesce(NEW.planned_subcontractor_cost, 0) + coalesce(NEW.planned_equipment_cost, 0) +
    coalesce(NEW.planned_transport_cost, 0) + coalesce(NEW.planned_other_cost, 0);

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'rentownosc', 'profitability_plan_created',
      'Utworzono plan rentownosci: ' || coalesce(cname, 'budowa'),
      'Przychod: ' || NEW.planned_revenue::text || ' PLN · koszty plan: ' || new_cost::text || ' PLN · postep: ' || NEW.progress_pct::text || '%',
      NEW.case_id, 'case_profitability_plan', NEW.id,
      jsonb_build_object('planned_revenue', NEW.planned_revenue, 'planned_cost', new_cost, 'progress_pct', NEW.progress_pct),
      NEW.created_by
    );
    return NEW;
  end if;

  old_cost := coalesce(OLD.planned_material_cost, 0) + coalesce(OLD.planned_labor_cost, 0) +
    coalesce(OLD.planned_subcontractor_cost, 0) + coalesce(OLD.planned_equipment_cost, 0) +
    coalesce(OLD.planned_transport_cost, 0) + coalesce(OLD.planned_other_cost, 0);

  if TG_OP = 'UPDATE' and (
    OLD.planned_revenue is distinct from NEW.planned_revenue
    or old_cost is distinct from new_cost
    or OLD.progress_pct is distinct from NEW.progress_pct
    or OLD.contingency_pct is distinct from NEW.contingency_pct
  ) then
    perform public.log_organization_activity(
      NEW.organization_id, 'rentownosc', 'profitability_plan_updated',
      'Zmieniono plan rentownosci: ' || coalesce(cname, 'budowa'),
      'Przychod: ' || OLD.planned_revenue::text || ' -> ' || NEW.planned_revenue::text ||
        ' PLN · koszty: ' || old_cost::text || ' -> ' || new_cost::text ||
        ' PLN · postep: ' || OLD.progress_pct::text || '% -> ' || NEW.progress_pct::text || '%',
      NEW.case_id, 'case_profitability_plan', NEW.id,
      jsonb_build_object(
        'old_planned_revenue', OLD.planned_revenue, 'new_planned_revenue', NEW.planned_revenue,
        'old_planned_cost', old_cost, 'new_planned_cost', new_cost,
        'old_progress_pct', OLD.progress_pct, 'new_progress_pct', NEW.progress_pct
      )
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists log_case_profitability_plan_activity on public.case_profitability_plans;
create trigger log_case_profitability_plan_activity
after insert or update on public.case_profitability_plans
for each row execute function public.trg_log_case_profitability_plan_activity();

-- ── Rentownosc: koszty bezposrednie i podwykonawcy ───────────────────────────
create or replace function public.trg_log_case_direct_cost_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cname text;
begin
  if TG_OP = 'INSERT' then
    select client_name into cname from public.cases where id = NEW.case_id;
    perform public.log_organization_activity(
      NEW.organization_id, 'rentownosc', 'direct_cost_created',
      'Dodano koszt budowy: ' || NEW.title,
      NEW.amount::text || ' PLN · ' || NEW.cost_type || ' · ' || coalesce(cname, 'budowa'),
      NEW.case_id, 'case_direct_cost', NEW.id,
      jsonb_build_object('amount', NEW.amount, 'cost_type', NEW.cost_type),
      NEW.created_by
    );
    return NEW;
  elsif TG_OP = 'UPDATE' and (OLD.amount is distinct from NEW.amount or OLD.cost_type is distinct from NEW.cost_type or OLD.title is distinct from NEW.title) then
    select client_name into cname from public.cases where id = NEW.case_id;
    perform public.log_organization_activity(
      NEW.organization_id, 'rentownosc', 'direct_cost_updated',
      'Zmieniono koszt budowy: ' || NEW.title,
      OLD.amount::text || ' -> ' || NEW.amount::text || ' PLN · ' || OLD.cost_type || ' -> ' || NEW.cost_type,
      NEW.case_id, 'case_direct_cost', NEW.id,
      jsonb_build_object('old_amount', OLD.amount, 'new_amount', NEW.amount, 'old_type', OLD.cost_type, 'new_type', NEW.cost_type)
    );
    return NEW;
  elsif TG_OP = 'DELETE' then
    select client_name into cname from public.cases where id = OLD.case_id;
    perform public.log_organization_activity(
      OLD.organization_id, 'rentownosc', 'direct_cost_deleted',
      'Usunieto koszt budowy: ' || OLD.title,
      OLD.amount::text || ' PLN · ' || OLD.cost_type || ' · ' || coalesce(cname, 'budowa'),
      OLD.case_id, 'case_direct_cost', OLD.id,
      jsonb_build_object('amount', OLD.amount, 'cost_type', OLD.cost_type)
    );
    return OLD;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists log_case_direct_cost_activity on public.case_direct_costs;
create trigger log_case_direct_cost_activity
after insert or update or delete on public.case_direct_costs
for each row execute function public.trg_log_case_direct_cost_activity();

create or replace function public.trg_log_subcontractor_settlement_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sub_name text;
  cname text;
begin
  if TG_OP = 'INSERT' then
    select name into sub_name from public.subcontractors where id = NEW.subcontractor_id;
    if NEW.case_id is not null then
      select client_name into cname from public.cases where id = NEW.case_id;
    end if;
    perform public.log_organization_activity(
      NEW.organization_id, 'rozliczenia', 'subcontractor_settlement_created',
      'Rozliczenie podwykonawcy: ' || coalesce(sub_name, NEW.title, 'podwykonawca'),
      NEW.amount::text || ' PLN · ' || NEW.entry_type || case when cname is not null then ' · ' || cname else '' end,
      NEW.case_id, 'subcontractor_settlement_entry', NEW.id,
      jsonb_build_object('amount', NEW.amount, 'entry_type', NEW.entry_type),
      NEW.created_by
    );
    return NEW;
  elsif TG_OP = 'UPDATE' and (OLD.amount is distinct from NEW.amount or OLD.entry_type is distinct from NEW.entry_type or OLD.case_id is distinct from NEW.case_id) then
    select name into sub_name from public.subcontractors where id = NEW.subcontractor_id;
    if NEW.case_id is not null then
      select client_name into cname from public.cases where id = NEW.case_id;
    end if;
    perform public.log_organization_activity(
      NEW.organization_id, 'rozliczenia', 'subcontractor_settlement_updated',
      'Zmieniono rozliczenie podwykonawcy: ' || coalesce(sub_name, NEW.title, 'podwykonawca'),
      OLD.amount::text || ' -> ' || NEW.amount::text || ' PLN · ' || OLD.entry_type || ' -> ' || NEW.entry_type,
      NEW.case_id, 'subcontractor_settlement_entry', NEW.id,
      jsonb_build_object('old_amount', OLD.amount, 'new_amount', NEW.amount, 'old_type', OLD.entry_type, 'new_type', NEW.entry_type)
    );
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists log_subcontractor_settlement_activity on public.subcontractor_settlement_entries;
create trigger log_subcontractor_settlement_activity
after insert or update on public.subcontractor_settlement_entries
for each row execute function public.trg_log_subcontractor_settlement_activity();

-- ── HR: pracownicy, dokumenty, stanowiska i brygady ──────────────────────────
create or replace function public.trg_log_employee_profile_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.hr_compliance_from_document', true) = 'true' then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'hr', 'employee_created',
      'Dodano pracownika: ' || NEW.full_name,
      NEW.role_title || ' · ' || NEW.department || case when NEW.has_system_access then ' · ma dostep do systemu' else ' · bez dostepu' end,
      null, 'employee_profile', NEW.id,
      jsonb_build_object('department', NEW.department, 'role_title', NEW.role_title, 'has_system_access', NEW.has_system_access),
      NEW.created_by
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.active = true and NEW.active = false then
      perform public.log_organization_activity(
        NEW.organization_id, 'hr', 'employee_archived',
        'Zarchiwizowano pracownika: ' || NEW.full_name,
        NEW.role_title || ' · ' || NEW.department,
        null, 'employee_profile', NEW.id, null
      );
    elsif OLD.has_system_access is distinct from NEW.has_system_access or OLD.user_id is distinct from NEW.user_id then
      perform public.log_organization_activity(
        NEW.organization_id, 'hr', 'employee_access_changed',
        'Zmieniono dostep pracownika: ' || NEW.full_name,
        case when NEW.has_system_access then 'Przyznano dostep do systemu' else 'Odebrano/odlaczono dostep do systemu' end,
        null, 'employee_profile', NEW.id,
        jsonb_build_object('old_has_access', OLD.has_system_access, 'new_has_access', NEW.has_system_access, 'old_user_id', OLD.user_id, 'new_user_id', NEW.user_id)
      );
    elsif OLD.hourly_rate is distinct from NEW.hourly_rate or OLD.day_rate is distinct from NEW.day_rate or OLD.monthly_salary is distinct from NEW.monthly_salary then
      perform public.log_organization_activity(
        NEW.organization_id, 'hr', 'employee_rates_changed',
        'Zmieniono stawki pracownika: ' || NEW.full_name,
        'Godz.: ' || coalesce(OLD.hourly_rate::text, 'brak') || ' -> ' || coalesce(NEW.hourly_rate::text, 'brak') ||
          ' · dniowka: ' || coalesce(OLD.day_rate::text, 'brak') || ' -> ' || coalesce(NEW.day_rate::text, 'brak') ||
          ' · mies.: ' || coalesce(OLD.monthly_salary::text, 'brak') || ' -> ' || coalesce(NEW.monthly_salary::text, 'brak'),
        null, 'employee_profile', NEW.id,
        jsonb_build_object(
          'old_hourly_rate', OLD.hourly_rate, 'new_hourly_rate', NEW.hourly_rate,
          'old_day_rate', OLD.day_rate, 'new_day_rate', NEW.day_rate,
          'old_monthly_salary', OLD.monthly_salary, 'new_monthly_salary', NEW.monthly_salary
        )
      );
    elsif OLD.bhp_valid_until is distinct from NEW.bhp_valid_until or OLD.medical_valid_until is distinct from NEW.medical_valid_until then
      perform public.log_organization_activity(
        NEW.organization_id, 'hr', 'employee_compliance_changed',
        'Zmieniono terminy HR: ' || NEW.full_name,
        'BHP: ' || coalesce(OLD.bhp_valid_until::text, 'brak') || ' -> ' || coalesce(NEW.bhp_valid_until::text, 'brak') ||
          ' · badania: ' || coalesce(OLD.medical_valid_until::text, 'brak') || ' -> ' || coalesce(NEW.medical_valid_until::text, 'brak'),
        null, 'employee_profile', NEW.id,
        jsonb_build_object('old_bhp', OLD.bhp_valid_until, 'new_bhp', NEW.bhp_valid_until, 'old_medical', OLD.medical_valid_until, 'new_medical', NEW.medical_valid_until)
      );
    end if;
    return NEW;
  end if;

  return OLD;
end;
$$;

drop trigger if exists log_employee_profile_activity on public.employee_profiles;
create trigger log_employee_profile_activity
after insert or update on public.employee_profiles
for each row execute function public.trg_log_employee_profile_activity();

create or replace function public.trg_log_employee_document_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_name text;
begin
  if TG_OP = 'INSERT' then
    select full_name into employee_name from public.employee_profiles where id = NEW.employee_id;
    perform public.log_organization_activity(
      NEW.organization_id, 'hr', 'employee_document_created',
      'Dodano dokument HR: ' || coalesce(employee_name, 'pracownik'),
      NEW.title || case when NEW.valid_until is not null then ' · wazny do ' || NEW.valid_until::text else '' end,
      null, 'employee_document', NEW.id,
      jsonb_build_object('document_type', NEW.document_type, 'valid_until', NEW.valid_until, 'requires_renewal', NEW.requires_renewal),
      NEW.created_by
    );
    return NEW;
  elsif TG_OP = 'UPDATE' and (OLD.valid_until is distinct from NEW.valid_until or OLD.status is distinct from NEW.status or OLD.title is distinct from NEW.title) then
    select full_name into employee_name from public.employee_profiles where id = NEW.employee_id;
    perform public.log_organization_activity(
      NEW.organization_id, 'hr', 'employee_document_updated',
      'Zmieniono dokument HR: ' || coalesce(employee_name, 'pracownik'),
      OLD.title || ' -> ' || NEW.title || ' · termin: ' || coalesce(OLD.valid_until::text, 'brak') || ' -> ' || coalesce(NEW.valid_until::text, 'brak') ||
        case when OLD.status is distinct from NEW.status then ' · status: ' || OLD.status || ' -> ' || NEW.status else '' end,
      null, 'employee_document', NEW.id,
      jsonb_build_object('old_valid_until', OLD.valid_until, 'new_valid_until', NEW.valid_until, 'old_status', OLD.status, 'new_status', NEW.status)
    );
    return NEW;
  elsif TG_OP = 'DELETE' then
    select full_name into employee_name from public.employee_profiles where id = OLD.employee_id;
    perform public.log_organization_activity(
      OLD.organization_id, 'hr', 'employee_document_deleted',
      'Usunieto dokument HR: ' || coalesce(employee_name, 'pracownik'),
      OLD.title || case when OLD.valid_until is not null then ' · wazny do ' || OLD.valid_until::text else '' end,
      null, 'employee_document', OLD.id,
      jsonb_build_object('document_type', OLD.document_type, 'valid_until', OLD.valid_until)
    );
    return OLD;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists log_employee_document_activity on public.employee_documents;
create trigger log_employee_document_activity
after insert or update or delete on public.employee_documents
for each row execute function public.trg_log_employee_document_activity();

create or replace function public.trg_log_employee_position_history_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_name text;
  manager_name text;
begin
  select full_name into employee_name from public.employee_profiles where id = NEW.employee_id;
  if NEW.manager_employee_id is not null then
    select full_name into manager_name from public.employee_profiles where id = NEW.manager_employee_id;
  end if;
  perform public.log_organization_activity(
    NEW.organization_id, 'hr', 'employee_position_changed',
    'Zmiana stanowiska: ' || coalesce(employee_name, 'pracownik'),
    NEW.role_title || ' · ' || NEW.department || case when manager_name is not null then ' · przelozony: ' || manager_name else '' end ||
      ' · od ' || NEW.valid_from::text,
    null, 'employee_position_history', NEW.id,
    jsonb_build_object('role_title', NEW.role_title, 'department', NEW.department, 'employment_type', NEW.employment_type, 'manager_employee_id', NEW.manager_employee_id),
    NEW.created_by
  );
  return NEW;
end;
$$;

drop trigger if exists log_employee_position_history_activity on public.employee_position_history;
create trigger log_employee_position_history_activity
after insert on public.employee_position_history
for each row execute function public.trg_log_employee_position_history_activity();

create or replace function public.trg_log_employee_crew_history_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_name text;
  crew_name text;
begin
  select full_name into employee_name from public.employee_profiles where id = NEW.employee_id;
  select name into crew_name from public.crews where id = NEW.crew_id;
  perform public.log_organization_activity(
    NEW.organization_id, 'hr', 'employee_crew_changed',
    'Zmiana brygady: ' || coalesce(employee_name, 'pracownik'),
    coalesce(crew_name, 'bez brygady') || ' · od ' || NEW.valid_from::text,
    null, 'employee_crew_history', NEW.id,
    jsonb_build_object('crew_id', NEW.crew_id, 'crew_name', crew_name),
    NEW.created_by
  );
  return NEW;
end;
$$;

drop trigger if exists log_employee_crew_history_activity on public.employee_crew_history;
create trigger log_employee_crew_history_activity
after insert on public.employee_crew_history
for each row execute function public.trg_log_employee_crew_history_activity();

select '0042_business_activity_logs_for_new_modules: OK' as migration_status;
