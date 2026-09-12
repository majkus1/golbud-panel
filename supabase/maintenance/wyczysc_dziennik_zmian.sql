-- Czyszczenie "Dziennika zmian" (organization_activity_log).
-- Nie usuwa żadnych innych danych (sprawy, faktury, użytkownicy itd.) — tylko historię
-- wpisów w dzienniku. Nowe wpisy będą się dalej dopisywać normalnie po wyczyszczeniu.

-- WARIANT A) Wyczyść dziennik tylko dla jednej (Twojej) organizacji.
-- Podmień poniższy UUID na organization_id, którego używasz na produkcji
-- (ten sam, którego użyłeś w wyczysc_dane_operacyjne.sql).
do $$
declare
  v_org_id uuid := '7ff53c82-3874-4732-a363-c644d1066a62';
begin
  delete from public.organization_activity_log where organization_id = v_org_id;
  raise notice 'Usunięto wpisy dziennika zmian dla organizacji %', v_org_id;
end $$;

-- WARIANT B) Wyczyść dziennik dla WSZYSTKICH organizacji (np. porządki przed produkcją,
-- gdy w Supabase masz kilka testowych organizacji "GolBud"). Odkomentuj, jeśli chcesz
-- tego użyć ZAMIAST wariantu A powyżej:
-- truncate table public.organization_activity_log;

-- Weryfikacja
select organization_id, count(*) as wpisow
from public.organization_activity_log
group by organization_id
order by wpisow desc;
