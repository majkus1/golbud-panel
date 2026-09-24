-- Wpisy w kalendarzu firmy (pulpit i /calendar).
--
-- Wpis to zwykły wiersz `case_tasks` z `kind = 'wpis'`: ma datę, opcjonalną godzinę,
-- priorytet (kolor w kalendarzu) i opcjonalnie sprawę. Dzięki temu korzysta z tych samych
-- uprawnień co zadania (RLS: właściciel/biuro/kierownik widzą wszystko, pozostali — swoje
-- i przypisane) i trafia do porannego podsumowania. Na liście „Zadania pracowników”
-- wpisów nie pokazujemy — to terminy, nie praca do rozliczenia.

alter table public.case_tasks
  add column if not exists kind text not null default 'zadanie',
  add column if not exists due_time time;

alter table public.case_tasks drop constraint if exists case_tasks_kind_check;
alter table public.case_tasks
  add constraint case_tasks_kind_check check (kind = any (array['zadanie'::text, 'wpis'::text]));

-- Kalendarz czyta zakres dat całego miesiąca w firmie.
create index if not exists case_tasks_org_due_idx
  on public.case_tasks (organization_id, due_date)
  where due_date is not null;

-- Autor może usunąć własny wpis. Zadania dalej usuwa tylko właściciel, biuro i kierownik.
drop policy if exists "case_tasks_delete_own_entry" on public.case_tasks;
create policy "case_tasks_delete_own_entry" on public.case_tasks
  for delete
  using (kind = 'wpis' and created_by = auth.uid() and public.is_member_of(organization_id));

-- Dziennik zmian: odhaczony wpis nie udaje ukończonego zadania.
create or replace function public.trg_log_case_task_activity() returns trigger
  language plpgsql security definer
  set search_path to 'public'
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
      case when NEW.kind = 'wpis'
        then 'Wpis w kalendarzu wykonany: ' || left(NEW.title, 80)
        else 'Zadanie ukończone: ' || left(NEW.title, 80)
      end,
      coalesce(cname, 'bez sprawy'),
      NEW.case_id, 'case_task', NEW.id, null
    );
  end if;

  return NEW;
end;
$$;

notify pgrst, 'reload schema';
