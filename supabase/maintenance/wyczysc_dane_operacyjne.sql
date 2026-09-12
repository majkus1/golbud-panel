-- ============================================================================
-- CZYSZCZENIE DANYCH OPERACYJNYCH (nie migracja — uruchom RĘCZNIE, jednorazowo,
-- w Supabase SQL Editor, kiedy chcesz zresetować dane przed startem produkcyjnym).
--
-- Usuwa TREŚĆ (wiersze) — żadna tabela ani kolumna nie jest kasowana.
--
-- ZACHOWUJE (nietknięte):
--   - organizations, organization_members       (konta / role użytkowników)
--   - catalog_items                             (katalog materiałów / usług — NIE stany magazynowe)
--   - crews, job_positions                      (słowniki: brygady, stanowiska)
--   - piecework_activities                      (słownik czynności akordowych)
--   - estimate_templates, estimate_template_lines (szablony kosztorysów)
--   - employee_profiles z dostępem do systemu (has_system_access = true) + ich
--     dokumenty/historia stanowisk/historia brygad
--   - equipment                                 (słownik sprzętu)
--   - subcontractors                            (słownik podwykonawców)
--   - company_policies                          (polisy firmowe)
--   - supplier_invoice_category_rules           (reguły auto-kategoryzacji kosztów)
--   - ustawienia/preferencje: digest_email_prefs, push_subscriptions,
--     user_directory_profiles, notification_prefs*
--
-- USUWA (wszystkie wiersze, tylko treść):
--   - wszystkie zlecenia (cases) i to, co się z nimi wiąże kaskadowo:
--     oferty/warianty/pozycje, harmonogram, płatności, przypomnienia, prace
--     dodatkowe, protokoły, załączniki (metadane), faktury sprzedażowe,
--     przypisania zespołu, zadania i komentarze PRZYPISANE do zlecenia,
--     podwykonawcy na zleceniu, koszty bezpośrednie, plany rentowności,
--     dane komercyjne, kosztorysy powykonawcze
--   - rozliczenia pracowników: karty miesięczne, historia, wpisy (premie/zaliczki/...),
--     wpisy akordowe, godziny pracy (work_hours)
--   - rozliczenia podwykonawców i faktury kosztowe (+ paczki importu)
--   - kontrola finansowa (financial_control_items)
--   - przypisania sprzętu do budów (equipment_assignments)
--   - rozmowy / wiadomości / raporty Asystenta AI
--   - powiadomienia w aplikacji i dziennik zdarzeń wysyłki
--   - centralny dziennik aktywności organizacji i dziennik magazynowy
--   - WSZYSTKIE zadania (case_tasks), również ogólne bez przypisania do zlecenia
--     (wraz z komentarzami, załącznikami komentarzy i statusem odczytu)
--   - samochody / flota: vehicles + vehicle_service_entries (historia serwisowa)
--   - stany magazynowe: warehouse_items + warehouse_movements (KATALOG materiałów
--     `catalog_items` zostaje — to tylko stan/ruchy magazynu, nie słownik)
--   - pracownicy BEZ dostępu do systemu (has_system_access = false) — czyli same
--     kartoteki HR bez konta logowania — wraz z ich dokumentami, historią
--     stanowisk i historią brygad (kasowane kaskadowo)
--
-- UWAGA:
--   - Pracownicy z has_system_access = true (mają realne konto w systemie) NIE są
--     kasowani — jeśli chcesz usunąć też ich, zrób to świadomie osobno.
--   - Pliki w Supabase Storage (bucket `case-attachments`, `ai-attachments`)
--     NIE są usuwane tym skryptem — kasowane są tylko wiersze metadanych w bazie.
--     Jeśli chcesz też zwolnić miejsce w Storage, zrób to ręcznie w Supabase Studio
--     (Storage → wybierz bucket → usuń pliki), najlepiej PRZED uruchomieniem tego
--     skryptu (bo potem stracisz łatwy podgląd, którego zlecenia dotyczyły).
--   - Całość jest w jednej transakcji: jeśli coś pójdzie nie tak, NIC się nie usunie.
--
-- JAK URUCHOMIĆ:
--   0) WYMAGANE: najpierw wykonaj migrację
--      supabase/migrations/0054_fix_case_delete_cascade_activity_log.sql
--      (naprawia błąd dziennika aktywności przy kasowaniu spraw z przypisanym
--      zespołem/kosztami — bez niej ten skrypt przerwie się błędem
--      "null value in column organization_id" albo naruszeniem klucza obcego).
--   1) W Supabase Studio → SQL Editor uruchom osobno, żeby znaleźć swoje organization_id:
--        select id, name from public.organizations;
--   2) Podmień wartość poniżej (PASTE-ORGANIZATION-ID-HERE) na właściwe id.
--   3) Uruchom cały poniższy skrypt.
-- ============================================================================

begin;

do $$
declare
  v_org_id uuid := '7ff53c82-3874-4732-a363-c644d1066a62'; -- GolBud — realna organizacja (5 członków, 11 zleceń, 4 pracowników)
begin
  if v_org_id is null then
    raise exception 'Ustaw v_org_id na prawidłowe organization_id przed uruchomieniem.';
  end if;
  if not exists (select 1 from public.organizations where id = v_org_id) then
    raise exception 'Nie znaleziono organizacji o id = %', v_org_id;
  end if;

  -- Asystent AI (rozmowy, wiadomości, załączniki, wygenerowane raporty)
  delete from public.ai_message_attachments where organization_id = v_org_id;
  delete from public.ai_messages where organization_id = v_org_id;
  delete from public.ai_generated_artifacts where organization_id = v_org_id;
  delete from public.ai_conversations where organization_id = v_org_id;

  -- Powiadomienia i dzienniki zdarzeń
  delete from public.notification_dispatch_events where organization_id = v_org_id;
  delete from public.user_notifications where organization_id = v_org_id;
  delete from public.organization_activity_log where organization_id = v_org_id;
  delete from public.warehouse_audit_log where organization_id = v_org_id;

  -- Przypisania sprzętu do budów (sam sprzęt / słownik zostaje)
  delete from public.equipment_assignments where organization_id = v_org_id;

  -- Rozliczenia pracowników (kartoteki pracowników zostają, kasujemy tylko transakcje)
  delete from public.employee_settlement_history where organization_id = v_org_id;
  delete from public.employee_monthly_settlements where organization_id = v_org_id;
  delete from public.employee_settlement_entries where organization_id = v_org_id;
  delete from public.employee_piecework_entries where organization_id = v_org_id;
  delete from public.work_hours where organization_id = v_org_id;

  -- Podwykonawcy i faktury kosztowe (słowniki/reguły zostają)
  delete from public.subcontractor_settlement_entries where organization_id = v_org_id;
  delete from public.supplier_invoices where organization_id = v_org_id;
  delete from public.supplier_invoice_import_batches where organization_id = v_org_id;

  -- Kontrola finansowa
  delete from public.financial_control_items where organization_id = v_org_id;

  -- Zadania — WSZYSTKIE (kaskadowo kasuje komentarze, załączniki komentarzy,
  -- przypisania i status odczytu). Zadania przypisane do zlecenia i tak zostałyby
  -- skasowane kaskadowo przy `delete from cases` poniżej — tu kasujemy też te
  -- ogólne (case_id is null).
  delete from public.case_tasks where organization_id = v_org_id;

  -- Flota — samochody i ich historia serwisowa
  delete from public.vehicle_service_entries where organization_id = v_org_id;
  delete from public.vehicles where organization_id = v_org_id;

  -- Magazyn — same stany/ruchy, katalog materiałów (catalog_items) zostaje nietknięty
  delete from public.warehouse_movements where organization_id = v_org_id;
  delete from public.warehouse_items where organization_id = v_org_id;

  -- Pracownicy bez dostępu do systemu (same kartoteki HR, bez konta logowania)
  -- — kasuje kaskadowo dokumenty, historię stanowisk i historię brygad danej osoby.
  -- Rozliczenia/godziny/akord dla wszystkich pracowników już wyczyszczone wyżej,
  -- więc ograniczenie "on delete restrict" na kartach miesięcznych tu nie zablokuje.
  delete from public.employee_profiles
  where organization_id = v_org_id
    and has_system_access = false;

  -- Zlecenia — kasuje kaskadowo praktycznie wszystko, co jest przypisane do konkretnej sprawy
  -- (oferty/warianty/pozycje, harmonogram, płatności, przypomnienia, prace dodatkowe,
  -- protokoły, załączniki, faktury sprzedażowe, zespół, zadania+komentarze przypisane
  -- do sprawy, podwykonawcy na zleceniu, koszty bezpośrednie, plany rentowności,
  -- dane komercyjne, kosztorysy powykonawcze).
  delete from public.cases where organization_id = v_org_id;

  raise notice 'Wyczyszczono dane operacyjne dla organizacji %', v_org_id;
end $$;

commit;

-- Szybka weryfikacja po czyszczeniu (uruchom osobno, po commit):
-- select
--   (select count(*) from public.cases) as cases,
--   (select count(*) from public.work_hours) as work_hours,
--   (select count(*) from public.employee_monthly_settlements) as settlements,
--   (select count(*) from public.ai_conversations) as ai_conversations,
--   (select count(*) from public.case_tasks) as tasks_left,
--   (select count(*) from public.vehicles) as vehicles_left,
--   (select count(*) from public.warehouse_items) as warehouse_items_left,
--   (select count(*) from public.employee_profiles where has_system_access = false) as employees_no_access_left,
--   (select count(*) from public.catalog_items) as catalog_items_kept,
--   (select count(*) from public.employee_profiles where has_system_access = true) as employees_with_access_kept,
--   (select count(*) from public.crews) as crews_kept;
