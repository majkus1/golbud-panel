-- Naprawa błędu przy usuwaniu sprawy (DELETE FROM cases), gdy sprawa ma
-- przypisane osoby (case_assignees) i/lub koszty bezpośrednie (case_direct_costs).
--
-- Przyczyna: gdy sprawa jest kasowana, PostgreSQL najpierw usuwa wiersz `cases`,
-- a dopiero potem — w ramach tej samej transakcji — kaskadowo usuwa powiązane
-- wiersze potomne (ON DELETE CASCADE). Triggery logujące te kaskadowe usunięcia
-- odpytują tabelę `cases`, żeby ustalić organization_id / nazwę klienta, ale
-- w tym momencie sprawa jest już niewidoczna (została usunięta wcześniej w tej
-- samej komendzie), więc taki SELECT zwraca NULL. To powodowało:
--   1) case_assignees: "null value in column organization_id ... violates
--      not-null constraint" (organization_id nie ma własnej kolumny, była
--      doczytywana wyłącznie przez join do cases),
--   2) case_direct_costs: naruszenie klucza obcego organization_activity_log.case_id
--      (wstawiano case_id usuniętej właśnie sprawy).
--
-- Poprawka: 1) pomijamy wpis w dzienniku, jeśli sprawy nie da się już znaleźć
-- (organization_id nieznane), 2) przy logowaniu usunięcia kosztu bezpośredniego
-- nie odwołujemy się do case_id usuniętej sprawy (analogicznie jak już robi to
-- trg_log_case_activity dla samego usunięcia sprawy).

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

  -- Sprawa mogła zostać już usunięta w tej samej transakcji (kaskadowe
  -- kasowanie case_assignees przy DELETE FROM cases) — wtedy nie da się
  -- ustalić organization_id i pomijamy wpis zamiast blokować usunięcie.
  if c_org is null then
    return coalesce(NEW, OLD);
  end if;

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
    -- Uwaga: NIE przekazujemy tu OLD.case_id — jeśli koszt jest kasowany
    -- kaskadowo razem ze sprawą, ta sprawa już nie istnieje i wstawienie
    -- takiego case_id do organization_activity_log naruszyłoby klucz obcy.
    select client_name into cname from public.cases where id = OLD.case_id;
    perform public.log_organization_activity(
      OLD.organization_id, 'rentownosc', 'direct_cost_deleted',
      'Usunieto koszt budowy: ' || OLD.title,
      OLD.amount::text || ' PLN · ' || OLD.cost_type || ' · ' || coalesce(cname, 'budowa'),
      null, 'case_direct_cost', OLD.id,
      jsonb_build_object('amount', OLD.amount, 'cost_type', OLD.cost_type)
    );
    return OLD;
  end if;
  return coalesce(NEW, OLD);
end;
$$;
