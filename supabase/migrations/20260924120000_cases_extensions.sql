-- Sprawy: planowane rozpoczęcie, dane klienta do umów i kosz (usuwanie z możliwością przywrócenia).
--
-- Kosz: „Usuń sprawę” przestaje kasować rekord z tabelą płatności, faktur i plików.
-- Sprawa dostaje `deleted_at` i znika z widoku `case_records` oraz z list w programie,
-- a właściciel, biuro lub kierownik może ją przywrócić. Trwałe usunięcie (tylko właściciel)
-- idzie osobną trasą API z pełną listą skutków.

alter table public.cases
  add column if not exists planned_start_date date,
  add column if not exists client_tax_id text,
  add column if not exists client_address text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

comment on column public.cases.planned_start_date is 'Planowany termin rozpoczęcia prac (obok realization_end_date).';
comment on column public.cases.client_tax_id is 'PESEL albo NIP klienta — do umów i aneksów, opcjonalnie.';
comment on column public.cases.client_address is 'Adres klienta (korespondencyjny), gdy inny niż adres budowy w location.';
comment on column public.cases.deleted_at is 'Sprawa w koszu od tej chwili; null = aktywna.';
comment on column public.cases.deleted_by is 'Kto przeniósł sprawę do kosza.';

create index if not exists cases_org_trash_idx
  on public.cases (organization_id, deleted_at desc)
  where deleted_at is not null;

-- Widok listy spraw. security_invoker + security_barrier muszą zostać — bez nich widok
-- czytałby tabelę z uprawnieniami właściciela i omijał RLS (każdy widziałby wszystkie firmy).
-- Dotychczasowe kolumny w tej samej kolejności, nowe na końcu.
create or replace view public.case_records
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
  c.updated_at,
  c.planned_start_date,
  c.client_tax_id,
  c.client_address
from public.cases c
left join public.case_commercial_details commercial on commercial.case_id = c.id
where c.deleted_at is null;

-- Handlowiec może edytować swoje sprawy, ale nie może sam przenieść ich do kosza
-- ani z niego wyjąć — tylko przez funkcje poniżej, które sprawdzają rolę.
create or replace function public.protect_case_security_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if (NEW.deleted_at is distinct from OLD.deleted_at or NEW.deleted_by is distinct from OLD.deleted_by)
     and coalesce(auth.role(), '') <> 'service_role'
     and coalesce(public.my_role_in(OLD.organization_id), '') not in ('owner', 'office', 'manager') then
    raise exception 'Do kosza sprawę przenosi właściciel, biuro albo kierownik';
  end if;
  return NEW;
end;
$function$;

-- Dziennik: przeniesienie do kosza i przywrócenie jako osobne wpisy.
create or replace function public.trg_log_case_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      perform public.log_organization_activity(
        NEW.organization_id, 'sprawa', 'trashed',
        'Przeniesiono do kosza: ' || NEW.client_name,
        coalesce(NEW.location, ''),
        NEW.id, 'case', NEW.id,
        jsonb_build_object('status', NEW.status)
      );
    elsif OLD.deleted_at is not null and NEW.deleted_at is null then
      perform public.log_organization_activity(
        NEW.organization_id, 'sprawa', 'restored',
        'Przywrócono z kosza: ' || NEW.client_name,
        coalesce(NEW.location, ''),
        NEW.id, 'case', NEW.id,
        jsonb_build_object('status', NEW.status)
      );
    end if;
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
      'Usunięto trwale sprawę: ' || OLD.client_name,
      coalesce(OLD.location, ''),
      null, 'case', OLD.id,
      jsonb_build_object('status', OLD.status)
    );
    return OLD;
  end if;

  return coalesce(NEW, OLD);
end;
$function$;

-- Przeniesienie do kosza. Te same role co dotychczasowe usuwanie (polityka cases_delete).
create or replace function public.trash_case(p_case_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select organization_id into v_org from public.cases where id = p_case_id;
  if v_org is null then
    raise exception 'Nie znaleziono sprawy';
  end if;
  if coalesce(public.my_role_in(v_org), '') not in ('owner', 'office', 'manager') then
    raise exception 'Do kosza sprawę przenosi właściciel, biuro albo kierownik';
  end if;
  update public.cases
     set deleted_at = now(), deleted_by = auth.uid()
   where id = p_case_id and deleted_at is null;
end;
$function$;

create or replace function public.restore_case(p_case_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select organization_id into v_org from public.cases where id = p_case_id;
  if v_org is null then
    raise exception 'Nie znaleziono sprawy';
  end if;
  if coalesce(public.my_role_in(v_org), '') not in ('owner', 'office', 'manager') then
    raise exception 'Sprawę z kosza przywraca właściciel, biuro albo kierownik';
  end if;
  update public.cases
     set deleted_at = null, deleted_by = null
   where id = p_case_id and deleted_at is not null;
end;
$function$;

-- Zawartość kosza firmy — tylko dla ról, które mogą przywracać.
create or replace function public.list_trashed_cases(p_organization_id uuid)
returns table (
  id uuid,
  client_name text,
  location text,
  status text,
  source text,
  created_by uuid,
  created_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(public.my_role_in(p_organization_id), '') not in ('owner', 'office', 'manager') then
    raise exception 'Kosz widzi właściciel, biuro albo kierownik';
  end if;
  return query
    select c.id, c.client_name, c.location, c.status, c.source, c.created_by, c.created_at, c.deleted_at, c.deleted_by
      from public.cases c
     where c.organization_id = p_organization_id
       and c.deleted_at is not null
     order by c.deleted_at desc;
end;
$function$;

revoke all on function public.trash_case(uuid) from public, anon;
revoke all on function public.restore_case(uuid) from public, anon;
revoke all on function public.list_trashed_cases(uuid) from public, anon;
grant execute on function public.trash_case(uuid) to authenticated, service_role;
grant execute on function public.restore_case(uuid) to authenticated, service_role;
grant execute on function public.list_trashed_cases(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
