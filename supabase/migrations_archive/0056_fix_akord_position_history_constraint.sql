-- Bugfix: migracja 0053 dodala 'akord' do employment_type w employee_profiles,
-- ale nie zaktualizowala analogicznego check constraint w employee_position_history.
--
-- Trigger trg_employee_profile_hr_history (migracja 0040) automatycznie kopiuje
-- kazda zmiane employment_type z employee_profiles do employee_position_history
-- (pelna historia stanowisk). Poniewaz stary constraint nie dopuszczal 'akord',
-- kazda proba ustawienia pracownika na akord (nowy pracownik, edycja w
-- /settings/organization, zmiana stanowiska w /hr) konczyla sie naruszeniem
-- check constraint i cala operacja byla wycofywana (błąd bazy danych).
alter table public.employee_position_history drop constraint if exists employee_position_history_employment_type_check;
alter table public.employee_position_history add constraint employee_position_history_employment_type_check
  check (employment_type in ('godzinowka', 'dniowka', 'etat', 'ryczalt', 'b2b', 'podwykonawca', 'akord', 'inne'));
