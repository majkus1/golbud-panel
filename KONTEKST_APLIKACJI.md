# BuildFlow / GolBud Panel — kontekst techniczny aplikacji

> Dokument referencyjny dla pracy nad kodem: architektura, pełna struktura bazy, RLS, RPC, storage, trasy, logika biznesowa i pułapki.
> Stan na podstawie kodu i migracji do `0059_office_payroll_separation.sql` włącznie (data przeglądu: 2026-08-06).
>
> Dokumenty towarzyszące:
> - `STAN_APLIKACJI_DLA_CURSOR.md` — opis biznesowy, stan etapów, zakres wdrożony/niewdrożony (aktualny).
> - `README.md` — **przestarzały** (opisuje etap 1/2). Nie traktować jako specyfikacji.
> - `NOTATKI_DO_ZMIANY_PO_OPLACENIU_I_SPOTKANIU.md`, `ODPOWIEDZ_DO_KLIENTA.md` — notatki handlowe.
> - `docs/reminders-cron.md` — szczegóły crona digestu.

---

## 1. Czym jest aplikacja

Wewnętrzny system operacyjny dla firmy budowlanej **GolBud** (elewacje/docieplenia, Ożarów Mazowiecki).
Jedna aplikacja Next.js (frontend + API routes) na **Vercel**, baza/auth/storage/realtime w **Supabase**.

Centralnym obiektem jest **zlecenie (`cases`)** — od zapytania (lead), przez wycenę i umowę, realizację, faktury, po rozliczenie.
Wokół tego: HR i kadry, czas pracy, rozliczenia pracowników, rentowność budów, zasoby (magazyn/sprzęt/flota), powiadomienia, Asystent AI.

Model danych jest **multi-tenant przez `organization_id`**, ale w praktyce jest jedna organizacja (GolBud). Każda tabela operacyjna niesie `organization_id` i jest chroniona RLS.

---

## 2. Stos i konfiguracja

| Element | Wartość |
|---|---|
| Framework | Next.js `16.2.4`, App Router, React 19, TypeScript, Tailwind |
| Baza / Auth / Storage / Realtime | Supabase (PostgreSQL + RLS) |
| PDF | `@react-pdf/renderer` (render server-side w Route Handlerach) |
| Excel / CSV | `exceljs` (eksport), `xlsx` z CDN SheetJS `0.20.3` (import; **celowo nie z npm** — podatna wersja) |
| Mail | `nodemailer` + Gmail SMTP (hasło aplikacji) |
| Push / PWA | `web-push` (VAPID), `public/sw.js`, `manifest.webmanifest` |
| AI | OpenAI Responses API, domyślny model `gpt-5.4-mini` |
| Deploy | Vercel; cron w `vercel.json` |

### Komendy

```bash
npm install
npm run dev
npx tsc --noEmit
npm run lint
npm run build
```

`npm run build` odpala najpierw `scripts/generate-pwa-icons.mjs` (sharp) → ikony PWA do `public/icons`.

### Zmienne środowiskowe (`.env.example`)

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=            # bazowy URL do linków w mailach/push

SUPABASE_SERVICE_ROLE_KEY=      # tylko serwer (cron, /api/notify)
CRON_SECRET=                    # Bearer dla /api/cron/reminder-digest

SMTP_GMAIL_USER=
SMTP_GMAIL_APP_PASSWORD=
SMTP_GMAIL_FROM=                # opcjonalnie
REMINDER_DIGEST_TO=             # fallback, gdy nikt nie ma digestu w panelu
REMINDER_DIGEST_SEND_EMPTY=     # 1/true → wysyłaj pusty raport

NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=                  # opcjonalnie

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
OPENAI_OCR_MODEL=gpt-5.4-mini
AI_ASSISTANT_ALLOW_LOCAL_FALLBACK=false   # na produkcji NIE włączać

OFFER_BANK_ACCOUNT=             # opcjonalne nadpisania PDF oferty
OFFER_DEFAULT_VAT_RATE=
```

### Cron

`vercel.json` → `GET /api/cron/reminder-digest`, harmonogram `0 5 * * *` (**UTC**, czyli 06:00/07:00 PL).
Autoryzacja: nagłówek `Authorization: Bearer <CRON_SECRET>`; bez `CRON_SECRET` endpoint zwraca 401 (fail-closed).

### Middleware

`middleware.ts`:
1. odświeża sesję Supabase w cookies (`@supabase/ssr` + `createServerClient`),
2. przekierowuje stare `/leads/*` → `/cases/*`.

---

## 3. Model uprawnień (najważniejszy fragment systemu)

### Role (`organization_members.role`)

```
owner | office | sales | manager | brygadzista | podwykonawca | member
```

CHECK constraint na `organization_members_role_check` (rozszerzany w migracjach 0002 → 0020).

| Rola | PL | Zakres |
|---|---|---|
| `owner` | Właściciel | wszystko + role użytkowników + dane firmy + **płace** |
| `office` | Biuro | operacje, finanse spraw, HR, raporty, AI — **bez indywidualnych płac** |
| `manager` | Kierownik | jak biuro **+ płace** |
| `sales` | Handlowiec | pipeline: tworzenie i prowadzenie spraw, oferty; bez danych zarządczych |
| `brygadzista` | Brygadzista | przypisane sprawy, wpisy godzin/akordu, magazyn/sprzęt, AI |
| `podwykonawca` | Podwykonawca | tylko przypisane sprawy, widok terenowy |
| `member` | Pracownik | przypisane sprawy + magazyn/sprzęt |

### Grupy w kodzie (`lib/domain.ts`)

```ts
MANAGEMENT_ROLES = ["owner", "office", "manager"]     // pełny wgląd
PAYROLL_ROLES    = ["owner", "manager"]               // indywidualne wynagrodzenia
OFFICE_ROLES     = ["owner", "office", "manager", "sales"]
FIELD_ROLES      = ["brygadzista", "podwykonawca", "member"]
```

Helpery UI w `components/org-context.tsx`: `canManageOrg`, `canSeeFinances`, `canViewPayroll`, `canCreateCases`, `canManageCaseTeam`, `isFieldRole`, `canEditWorkHours`, `canManageResources`, `canUseAssistant`.

### Odpowiadające funkcje SQL (SECURITY DEFINER, `stable`)

| Funkcja | Semantyka | Migracja |
|---|---|---|
| `is_member_of(org)` | członek organizacji | 0002/0003 |
| `is_owner_of(org)` | rola = owner | 0002/0003 |
| `my_role_in(org)` | zwraca rolę tekstem | 0009 |
| `is_case_assignee(case)` | jest w `case_assignees` | 0009 |
| `is_task_assignee(task)` | jest w `case_task_assignees` | 0009 |
| `can_see_all_cases(org)` | owner/office/manager | 0020 |
| `can_see_case_commercial(org)` | owner/office/manager/sales | 0027 |
| `can_edit_work_hours(org)` | owner/office/manager/brygadzista | 0027 |
| `can_access_case_in_org(case, org)` | pełny wgląd **lub** autor **lub** przypisany | 0033 |
| `can_access_case(case)` | j.w. bez podawania org | 0033 |
| `can_access_case_commercial_in_org(case, org)` | commercial ∧ dostęp do sprawy | 0033 |
| `can_access_task_in_org(task, org)` | pełny wgląd / assignee / autor | 0033 |
| `is_case_owner_or_manager(case)` | rola zarządcza dla danej sprawy | 0033 |
| `can_operate_resources(org)` | owner/office/manager/brygadzista/member | 0048 |
| `can_view_directory_profile(user)` | wspólna organizacja | 0048 |
| `can_use_ai_assistant(org)` | owner/office/manager/sales/brygadzista | 0057 |
| `can_view_payroll(org)` | **owner/manager** | 0059 |
| `can_view_labor_costs(org)` | owner/office/manager (zagregowany koszt) | 0059 |
| `can_view_employee_hr(employee, org)` | zarząd / self / brygadzista tej samej brygady | 0055 |
| `uuid_or_null(text)` | bezpieczna konwersja segmentu ścieżki storage | 0033 |

> **Uwaga na rekurencję RLS.** Polityki na `organization_members`, `case_tasks`/`case_task_assignees`, `case_assignees` **nie mogą** odpytywać tych tabel bezpośrednio — stąd cały wzorzec SECURITY DEFINER (naprawa w 0003 i 0009). Nie cofać tego.

### Kluczowe zasady

- **UI nie jest zabezpieczeniem.** Ostateczna kontrola to RLS albo trasa serwerowa, która sama sprawdza organizację i rolę.
- Role terenowe widzą tylko sprawy, do których są przypisane (`case_assignees`) lub które utworzyły.
- Dane handlowe sprawy (`estimated_value`) są w osobnej tabeli `case_commercial_details` — nie w `cases`.
- Indywidualne płace: wyłącznie `owner`/`manager` (`can_view_payroll`). `office` widzi tylko zagregowany koszt robocizny przez RPC `payroll_labor_costs_aggregated`.
- Nie przyjmować z klienta `organization_id`, `recipient_id`, `case_id` bez walidacji relacji.

---

## 4. Baza danych — pełna mapa tabel

> **Zmiana od 8.08.2026.** Katalog `supabase/migrations/` zawiera teraz **zrzut schematu produkcyjnego**
> (`2026…_baseline.sql`) + osobną migrację z politykami Storage. Historyczne `0002`–`0059` przeniesiono
> do `supabase/migrations_archive/` — zostają jako dokumentacja, ale **nie są odtwarzane**.
> Nowe zmiany: `npx supabase migration new nazwa`. Szczegóły: [docs/srodowisko-dev.md](docs/srodowisko-dev.md).

Historyczny schemat bazowy: `supabase/schema.sql`. Historyczne migracje: `supabase/migrations_archive/0002…0059`.
Skrypty czyszczące: `supabase/maintenance/wyczysc_dane_operacyjne.sql`, `wyczysc_dziennik_zmian.sql`.

### 4.1 Organizacja i użytkownicy

| Tabela | Opis / uwagi |
|---|---|
| `organizations` | nazwa + profil ofertowy na PDF (`offer_legal_name`, `offer_nip`, `offer_address_line`, `offer_postal_city`, `offer_phone/email/website`, `offer_bank_account/bank_name`, `offer_payment_terms`, `offer_default_vat_rate` (dom. 8), `offer_validity_days` (dom. 30)) + `accountant_email`, `invoice_email_subject`, `invoice_email_body` (0014). Update tylko `owner`. |
| `organization_members` | PK (organization_id, user_id), `role`. **Brak INSERT dla `authenticated`** — członkostwo tworzy trigger/RPC. |
| `user_directory_profiles` | bezpieczny katalog e-maili (0048); synchronizowany triggerem z `auth.users`. Zastąpił widok czytający `auth.users` (ostrzeżenie `auth_users_exposed`). |
| `crews` | brygady / ekipy własne |
| `job_positions` | słownik stanowisk (0051), unikalny per organizacja |

**Widoki:**
- `org_member_profiles` — `security_invoker = true, security_barrier = true`, join `organization_members` + `user_directory_profiles`. **Nigdy nie odtwarzać wersji z `auth.users`.**
- `case_records` — `cases` LEFT JOIN `case_commercial_details`; `estimated_value` widoczne tylko dla uprawnionych ról (RLS na tabeli źródłowej). **Aplikacja czyta sprawy przez ten widok**, gdy potrzebuje wartości.

**Bootstrap konta:** trigger `on_auth_user_created` → `handle_new_user()` → `create_org_for_user()` (tworzy organizację `GolBud`, członkostwo `owner`, `seed_catalog_for_org()`).
Dla kont sprzed wdrożenia: RPC `ensure_user_org()` wołane z `components/org-context.tsx` przy pierwszym logowaniu.

### 4.2 Zlecenia (sprawy)

| Tabela | Opis |
|---|---|
| `cases` | klient, telefon, e-mail, lokalizacja, `work_description`, `status`, `source`, `crew_id`, `next_contact_date`, `realization_end_date`, `contract_number`, `contract_date` (0031), `created_by`. `estimated_value` **musi być NULL** (CHECK + trigger `protect_case_security_columns`). |
| `case_commercial_details` | PK = `case_id`; `estimated_value`, `updated_by/at` (trigger stempluje). Logowanie zmian → `organization_activity_log`. |
| `case_assignees` | PK (case_id, user_id), `assignment_role ∈ {lead, field}` (0030). `lead` = prowadzący, `field` = teren; **oba** dają widoczność sprawy. |
| `case_notes` | notatki; odczyt = dostęp do sprawy, edycja/usuwanie tylko autor |
| `case_schedule_items` | harmonogram etapów (`title`, `description`, `due_date`, `completed`, `sort_order`) |
| `reminders` | przypomnienia kontaktowe (`remind_at`, `completed_at`) — **dane komercyjne**, widzą je tylko role commercial |
| `extra_works` | prace dodatkowe z kwotą (`line_total` generated), `accepted` |
| `case_protocols` | metadane protokołów (`protocol_type`), PDF generowany on-the-fly |
| `attachments` | metadane plików Storage (`storage_path`, `category`, `description`, `uploaded_by`); unique (org, storage_path) |
| `case_as_built_estimates` | kosztorysy powykonawcze — snapshot pozycji w `lines_snapshot` jsonb + zapisany PDF w Storage |
| `case_direct_costs` | koszty bezpośrednie budowy (`cost_type`, `amount`, `cost_date`) |
| `case_profitability_plans` | plan budżetowy budowy (przychód + koszty planowane, `contingency_pct`, `progress_pct`); unique per sprawa |

**Statusy sprawy (14):** `nowe zapytanie`, `do kontaktu`, `wysłano pytania`, `oczekujemy na zdjęcia/projekt`, `do wyceny`, `wycena wysłana`, `do decyzji klienta`, `umowa do podpisu`, `zaliczka do wpłaty`, `termin zarezerwowany`, `realizacja`, `odbiór`, `rozliczone`, `utracone`.
Terminalne (wyłączane z alertów): `rozliczone`, `utracone`.

**Źródła:** `Google Ads`, `strona`, `polecenie`, `OLX`, `telefon`, `mail`, `WhatsApp`, `SMS`.

**Jednostki (globalnie):** `m²`, `mb`, `szt.`, `kpl.`, `roboczogodz.`, `usługa`.

**Kategorie załączników:** `przed pracami`, `w trakcie`, `po zakończeniu`, `usterki`, `materiały`, `projekt`, `inspiracje`, `kosztorys zewnętrzny`, `umowa`, `aneks`, `protokół`, `wezwanie do zapłaty`, `oświadczenie`.

### 4.3 Sprzedaż: oferty, faktury, płatności

| Tabela | Opis |
|---|---|
| `catalog_items` | baza pozycji kosztorysowych (material/labor, `suggested_rate`) |
| `offer_variants` | warianty oferty per sprawa |
| `offer_lines` | pozycje wariantu; `line_total` generated = `round(quantity*unit_rate,2)` |
| `estimate_templates` / `estimate_template_lines` | reużywalne szablony kosztorysów (0052), kształt 1:1 z `offer_lines` |
| `payments` | harmonogram płatności sprawy (`amount_due`, `amount_paid`, `paid_at`) |
| `invoices` | faktury sprzedażowe; `kind ∈ {proforma, zaliczkowa, końcowa, vat}`, `status ∈ {szkic, wystawiona, opłacona, anulowana}`, numeracja `number/number_seq/number_year`, dane nabywcy, `with_receipt/receipt_*` (0014), `sent_at/sent_to`, `paid_at` (0049) |
| `invoice_lines` | pozycje z rabatem i VAT per pozycja; `net_total` generated; trigger `recalc_invoice_totals` przelicza sumy faktury |
| `invoice_counters` | licznik per (org, kind, year); bezpieczna funkcja `next_invoice_seq(org, kind, year)` weryfikuje członkostwo |

Prefiksy numeracji: `PF` (proforma), `FZ` (zaliczkowa), `FK` (końcowa), `FV` (VAT). `INVOICE_KIND_IS_VAT` — proforma nie jest fakturą VAT (wpływ na PDF i KSeF).
Stawki VAT w pozycjach: `23, 8, 5, 0`.

### 4.4 Koszty i podwykonawcy

| Tabela | Opis |
|---|---|
| `subcontractors` | baza firm zewnętrznych (odczyt: cała org; zapis: owner/office/manager) |
| `case_subcontractors` | przypisanie do sprawy ze stawką/zakresem/statusem (`planowane`, `w toku`, `zakończone`, `wstrzymane`) — **dane komercyjne** |
| `subcontractor_settlement_entries` | rozliczenia podwykonawców (`zaliczka`, `wyplata`, `rozliczenie_koncowe`, `dopłata`, `potracenie`, `korekta`) |
| `supplier_invoices` | faktury kosztowe: dostawca, numer, daty, `category ∈ {materialy, robocizna, sprzet, transport, podwykonawca, inne}`, kwoty, `status`, `attachment_id`, `sent_to/sent_at` (0037), import (`import_batch_id`, `source`, `category_confidence`, `category_reason`, `raw_import_data`), powiązania z podwykonawcą i `linked_settlement_entry_id` (0049) |
| `supplier_invoice_category_rules` | reguły auto-kategorii (pattern, match_field, priority) |
| `supplier_invoice_import_batches` | partie importu CSV/XLSX/OCR |

> **Antyduplikacja kosztu:** `linked_settlement_entry_id` (unikalny indeks częściowy) łączy fakturę kosztową z konkretnym rozliczeniem podwykonawcy — wtedy kwota **nie jest liczona dwa razy**. Trigger `validate_supplier_invoice_settlement_link` wymusza zgodność org/sprawy/podwykonawcy i kategorię `podwykonawca`.

### 4.5 Pracownicy, HR, czas pracy, rozliczenia

| Tabela | Opis |
|---|---|
| `employee_profiles` | osoba w strukturze (może istnieć **bez konta**); `user_id` opcjonalne, `crew_id`, `manager_employee_id` (hierarchia), `role_title`, `department`, `employment_type`, `has_system_access`, `bhp_valid_until`, `medical_valid_until`, `active`. **Od 0059 nie ma tu kolumn stawek.** |
| `employee_compensation` | **prywatna** tabela stawek (`hourly_rate`, `day_rate`, `monthly_salary`), RLS = `can_view_payroll` |
| `work_hours` | ewidencja godzin (org, case_id/site_label, `worker_name`, `employee_id`, `work_date`, `hours ≤ 24`); unikalny „kafelek” (org, worker_name, date, case, site) |
| `piecework_activities` | słownik czynności akordowych ze stawką — **tabela płacowa** (RLS payroll) |
| `employee_piecework_entries` | dziennik akordu z **migawką stawki** (`unit_rate_snapshot`) — RLS payroll, dostęp operacyjny przez RPC |
| `employee_settlement_entries` | wpisy: `zaliczka`, `wyplata`, `premia`, `potracenie`, `zwrot_kosztow`, `korekta` + `direction ∈ {plus,minus}` |
| `employee_monthly_settlements` | karta miesięczna: snapshoty stawek, sumy godzin/dni/akordu, składniki, `gross_earnings`, `amount_due`, status `draft → approved → paid → closed` |
| `employee_settlement_history` | pełna historia zmian kart i wpisów (before/after jsonb) |
| `employee_documents` | dokumenty pracownicze (`bhp`, `medical`, `training`, `qualification`, `contract`, `annex`, `certificate`, `other`), pliki w prywatnym buckecie, `source_key` do synchronizacji z profilem |
| `employee_position_history` | historia stanowisk z okresami obowiązywania |
| `employee_crew_history` | historia przypisań do brygad |

**Typy zatrudnienia:** `godzinowka`, `dniowka`, `etat`, `ryczalt`, `b2b`, `podwykonawca`, `akord` (0053), `inne`.
**Działy:** `zarzad`, `biuro`, `handlowcy`, `kierownicy`, `brygada`, `podwykonawcy`, `bhp`, `inne`.

**Logika miesiąca (`refresh_employee_monthly_settlement`, wersja z 0059):**
`base` = godziny×stawka / dni×stawka dniowa / akord / pensja miesięczna (wg `employment_type`) →
`gross = base + premie + zwroty + korekty(+)` →
`amount_due = max(0, gross − potrącenia − korekty(−) − zaliczki − wypłaty)`.
Karta poza `draft` blokuje edycję wpisów miesiąca (trigger `trg_lock_employee_entries_for_closed_month`).
Zmiana statusu: `set_employee_monthly_settlement_status` — wymaga `can_view_payroll`, wymusza kolejność draft→approved→paid→closed.

**Synchronizacja BHP/badań:** dokumenty `bhp`/`medical` są źródłem dat na profilu (`refresh_employee_compliance_dates`), a szybka zmiana daty na profilu tworzy/aktualizuje dokument (`source_key = 'profile_bhp' | 'profile_medical'`). Flagi sesyjne `app.hr_compliance_from_document`, `app.hr_migration_seed`, `app.hr_history_manual` zapobiegają pętlom triggerów — **nie usuwać ich przy modyfikacjach**.

### 4.6 Zasoby

| Tabela | Opis |
|---|---|
| `vehicles` | pojazdy; `insurance_oc_expires`, `insurance_ac_expires`, `inspection_expires` (stare `insurance_expires` zachowane) |
| `vehicle_service_entries` | serwis / przeglądy |
| `company_policies` | polisy firmowe (`coverage_end`, `payment_due`, `amount`) |
| `warehouse_items` | stan magazynowy (`quantity`, `min_quantity`, `location`); ilość **tylko przez ruch** (trigger `protect_warehouse_item_history`) |
| `warehouse_movements` | ruchy `in`/`out`; trigger `validate_warehouse_movement` (org, dostępność, `created_by := auth.uid()`), potem `apply_warehouse_movement`. DELETE odebrany roli `authenticated`. |
| `warehouse_audit_log` | zmiany konfiguracji magazynu (`item_created`, `items_imported`, `min_quantity_changed`) |
| `equipment` | sprzęt/rusztowania (`total_quantity`, kategoria) |
| `equipment_assignments` | wydania na sprawę lub miejsce; walidacja dostępnej ilości, rola operacyjna może **wyłącznie oznaczyć zwrot**; DELETE odebrany |

### 4.7 Zadania

| Tabela | Opis |
|---|---|
| `case_tasks` | zadanie (opcjonalnie bez sprawy); `priority ∈ {niski, normalny, wysoki, pilne}`, `status ∈ {do zrobienia, w toku, zrobione, anulowane}`; stare `assignee_id` zachowane |
| `case_task_assignees` | wielu przypisanych (m2m) |
| `case_task_comments` | dyskusja (realtime) |
| `case_task_comment_attachments` | pliki komentarza; ścieżka `{org}/tasks/{task_id}/...` |
| `case_task_reads` | stan przeczytania per użytkownik |

### 4.8 Powiadomienia

| Tabela | Opis |
|---|---|
| `user_notifications` | skrzynka „dzwoneczka”; `type ∈ {new_case, case_assigned, task_created, task_comment, financial_alert, employee_compliance}`, `event_key` (unikalny per user) = idempotencja alertów cronowych. **Realtime włączony.** |
| `push_subscriptions` | subskrypcje Web Push (endpoint unique) |
| `digest_email_prefs` | preferencje digestu/powiadomień per (org, user): `digest_enabled`, `include_*` (reminders, overdue_contact, schedule, payments, tasks, fleet, warehouse, profitability_alerts, cost_invoices, employee_compliance, settlements, stale_cases), `notify_new_case`, `notify_task_comment`, `notify_financial_alerts`, `push_enabled`. Edycja: owner; `push_enabled` sam użytkownik przez `set_own_push_enabled`. |
| `notification_dispatch_events` | księga wysyłek: unikalny `dedupe_key` = deduplikacja + rate limiting (50/min/nadawcę). RLS bez dostępu dla `authenticated` — używana tylko przez service role. |

### 4.9 Asystent AI

| Tabela | Opis |
|---|---|
| `ai_conversations` | rozmowa (`context_type ∈ {global, case}`, `case_id`, `created_by`) |
| `ai_messages` | wiadomości (`user`/`assistant`/`system`), `meta` jsonb; trigger odświeża `last_message_at` |
| `ai_message_attachments` | załączniki + `extracted_text` i `extraction_status` |
| `ai_generated_artifacts` | metadane wygenerowanych PDF/XLSX |

**Ewolucja dostępu:** 0043 (org-wide dla ról zarządczych) → 0044 (management only) → 0050 (**prywatne per użytkownik** — widzisz tylko własne rozmowy) → 0057 (lista ról w jednym miejscu: `can_use_ai_assistant` = owner/office/manager/sales/brygadzista).

### 4.10 Audyt

`organization_activity_log` — centralny dziennik biznesowy.
Kategorie: `sprawa`, `platnosc`, `faktura`, `magazyn`, `sprzet`, `czas`, `zespol`, `firma`, `przypisanie`, `prace_dodatkowe`, `zadanie`, `rozliczenia`, `rentownosc`, `hr`, `ai`.
Od 0059 dodatkowo `data_scope ∈ {operational, payroll}` — wpisy płacowe widzi wyłącznie `can_view_payroll`.
Zapis przez `log_organization_activity(...)` (SECURITY DEFINER) wołane z ~20 triggerów (0029, 0042, 0048, 0054, 0059).
Odczyt: role zarządcze (`can_see_all_cases`) + filtr `data_scope`.

---

## 5. Storage (buckety prywatne)

| Bucket | Ścieżka | Kto |
|---|---|---|
| `case-attachments` | `{org}/{case}/...`, `{org}/{case}/as-built-estimates/...`, `{org}/tasks/{task}/...` | polityki oparte o **metadane w bazie**, nie sam prefiks (0033): `can_select/insert/delete_case_attachment_object(name)` |
| `employee-documents` | `{org}/{employee}/{uuid}-nazwa` | owner/office/manager (0040), limit 10 MB |
| `ai-attachments` | `{org}/{conversation}/{uuid}-nazwa` | `owns_ai_attachment_object` — właściciel rozmowy + `can_use_ai_assistant` (0050/0057) |

Limity uploadu po stronie klienta: 15 MB, MIME JPG/PNG/WebP/PDF (załączniki spraw).

> Zmiana schematu ścieżek wymaga równoczesnej zmiany funkcji walidujących **i** polityk `attachments_insert/update` (sprawdzają `uuid_or_null((storage.foldername(storage_path))[1..2])`).

---

## 6. RPC wołane z aplikacji

| RPC | Wołane w | Rola / cel |
|---|---|---|
| `ensure_user_org()` | `components/org-context.tsx` | bootstrap organizacji |
| `set_member_role(email, role)` | `app/settings/team` | owner; blokuje usunięcie ostatniego właściciela |
| `remove_organization_member(...)` | `app/settings/team` | owner |
| `next_invoice_seq(org, kind, year)` | `components/case/invoices-section.tsx` | numeracja faktur |
| `organization_member_directory(org)` | `lib/case-leads.ts` | bezpieczna lista osób (email + display_name z `employee_profiles`) |
| `set_own_push_enabled(org, bool)` | `push-notification-settings`, `/api/push/subscribe` | użytkownik sam |
| `employee_hr_profiles_visible(org)` / `employee_hr_documents_visible(org)` | `app/calendar` | terminy BHP/badań: self + brygada |
| `save_employee_compensation(...)` | `app/settings/organization` | payroll |
| `refresh_employee_monthly_settlement(...)`, `set_employee_monthly_settlement_status(...)` | `app/settlements/employees` | payroll |
| `set_employee_position_assignment(...)`, `set_employee_crew_assignment(...)` | `app/hr`, `app/settings/crews` | zarząd; historia z datą obowiązywania |
| `piecework_activities_operational(org)`, `employee_work_profiles_visible(org)`, `employee_piecework_entries_operational(org, from, to)`, `add_employee_piecework_entry(...)`, `delete_employee_piecework_entry(...)` | `app/time` | akord bez ujawniania stawek |
| `payroll_labor_costs_aggregated(org)` | `lib/ai-assistant.ts`, `app/reports/profitability`, `/api/reports/profitability/pdf` | zagregowany koszt robocizny (case_id, data, kwota) — **bez pracownika i stawki** |

---

## 7. Trasy aplikacji

### Strony (App Router, wszystkie client-side pod `AuthGate` + `AppShell`)

| Ścieżka | Opis |
|---|---|
| `/` | Dashboard (wariant zarządczy / uproszczony terenowy wg roli) |
| `/board` | Tablica kanban po statusie |
| `/cases`, `/cases?preset=realizacja` | Lista zleceń + presety + eksport CSV |
| `/cases/new`, `/cases/[id]`, `/cases/[id]/edit` | Nowe zlecenie, karta sprawy, edycja |
| `/tasks` | Zadania pracowników |
| `/notifications` | Skrzynka powiadomień |
| `/calendar` | Kalendarz agregujący terminy |
| `/assistant` | Globalny Asystent AI |
| `/time` | Czas pracy + akord |
| `/reports`, `/reports/profitability`, `/reports/financial-control` | Raporty |
| `/settlements/employees` | Rozliczenia miesięczne (tylko payroll) |
| `/vehicles`, `/vehicles/[id]`, `/policies`, `/warehouse`, `/equipment` | Zasoby |
| `/hr` | Kadry, dokumenty, hierarchia |
| `/activity` | Dziennik zmian |
| `/settings/dictionaries`, `/organization`, `/subcontractors`, `/catalog`, `/company`, `/team`, `/crews`, `/job-positions`, `/estimate-templates`, `/piecework-activities` | Ustawienia |
| `/login` | Logowanie + reset hasła (PKCE `?code=`, `?recovery=1`) |

Widoczność pozycji menu: `components/app-shell.tsx` → `navGroups` + `isItemVisible` (role zarządcze widzą wszystko; `roles: []` = tylko zarząd; `/settlements/employees` osobno przez `canViewPayroll`).

### Zakładki karty sprawy (`?tab=`)

Primary: `overview`, `offer`, `invoices`, `schedule`, `payments`, `costs`, `assistant`, `tasks`, `notes`.
Secondary („Więcej”): `reminders`, `subcontractors`, `extras`, `protocols`, `as-built`, `documents`, `files`.
Filtrowanie: bez finansów znikają `invoices`/`payments`/`costs`/`reminders`; rola terenowa traci dodatkowo `offer`, `subcontractors`, `extras`, `documents`, `as-built`.

### API (Route Handlers)

Wzorzec autoryzacji: `getSupabaseUserClient(request)` z `lib/supabase-api-route.ts` — najpierw sesja z cookies (SSR), w razie braku token `Authorization: Bearer` (potrzebne na Vercel przy `window.open`). **Zapytania idą klientem użytkownika → obowiązuje RLS.** Service role tylko tam, gdzie trzeba (`/api/notify`, cron) i zawsze po ręcznej weryfikacji roli/organizacji.

| Endpoint | Opis |
|---|---|
| `GET /api/cases/[caseId]/variants/[variantId]/pdf` | Oferta PDF |
| `GET /api/cases/[caseId]/contract/pdf?variantId=&advancePct=` | Umowa o roboty budowlane |
| `GET /api/cases/[caseId]/document/pdf` | Dokument z szablonu (`lib/document-templates.ts`) |
| `GET /api/cases/[caseId]/protocols/[protocolId]/pdf` | Protokół |
| `POST /api/cases/[caseId]/as-built-estimates` + `GET .../[estimateId]/pdf` | Kosztorys powykonawczy (generuje, zapisuje w Storage i historii) |
| `GET /api/cases/[caseId]/invoices/[invoiceId]/pdf` \| `/ksef` \| `POST /send` | Faktura: PDF, XML **FA(2)** (fundament KSeF), wysyłka mailem |
| `POST /api/cases/[caseId]/supplier-invoices/[invoiceId]/send` | Faktura kosztowa do księgowości |
| `GET /api/reports/pdf`, `/reports/profitability/pdf`, `/reports/financial-control/pdf` | Raporty PDF |
| `POST /api/reports/profitability/import` | Import CSV/XLSX/OCR faktur kosztowych |
| `GET /api/settlements/employees/export` | Eksport rozliczeń (Excel) |
| `POST /api/notify` | Powiadomienia natychmiastowe (walidacja odbiorców, dedupe, rate limit) |
| `POST /api/push/subscribe` \| `/unsubscribe` \| `/test` | Web Push |
| `GET /api/cron/reminder-digest` | Dzienny digest + alerty BHP (Bearer `CRON_SECRET`) |
| `POST /api/ai/assistant/chat` \| `/case-summary` \| `/report` \| `/attachments` \| `/conversations` \| `GET /status` | Asystent AI |

---

## 8. Kluczowa logika biznesowa

### 8.1 Proces zlecenia

Zapytanie → kwalifikacja → wycena (warianty + pozycje robocizna/materiał, opcjonalnie import CSV/XLSX lub szablon) → oferta PDF → umowa → zaliczka → harmonogram → realizacja (godziny, akord, materiały, sprzęt, podwykonawcy, zdjęcia, protokoły) → faktury i płatności → kosztorys powykonawczy / wezwanie do zapłaty → rozliczone.

Autor-handlowiec jest automatycznie prowadzącym (`assignment_role = 'lead'`) — backfill w 0058.

### 8.2 Semantyka finansowa (rentowność, `lib/profitability-report.ts`)

| Pojęcie | Definicja |
|---|---|
| `revenuePlanned` | plan z modułu rentowności → suma harmonogramu → szacowana wartość sprawy |
| `revenueInvoiced` | wystawione faktury (bez `szkic` i `anulowana`) |
| `revenueDue` | wystawione należności; przy braku faktur — harmonogram płatności |
| `revenuePaid` | opłacone faktury; przy braku — opłacone pozycje harmonogramu |
| `profit` | przychód (plan/kontrakt) − przypisane koszty |
| `forecast*` | prognoza z `progress_pct` — jakość zależy od ręcznego postępu |

Koszty: materiały/robocizna/podwykonawcy/sprzęt/transport/inne z faktur kosztowych, rozliczeń, akordu, godzin i kosztów bezpośrednich.
Trend miesięczny liczy się z **dat dokumentów/pracy/płatności**, nie z daty utworzenia sprawy.

> To **nie jest** księgowy rachunek zysków i strat. Pełna wartość wyceny ≠ wymagalna należność.
> W nowych raportach zawsze rozróżniać: **plan / wystawione / należne / opłacone / prognoza**.

### 8.3 Powiadomienia

Trzy kanały: in-app (`user_notifications` + realtime), Web Push, e-mail (Gmail SMTP).
`POST /api/notify` waliduje: sesję, rolę nadawcy, przynależność odbiorcy do organizacji, realne przypisanie (`case_assignees`, `case_task_assignees`), rate limit 50/min, dedupe przez `notification_dispatch_events`.
Preferencje scala `lib/notification-prefs.ts` (`mergeNotificationPrefs(role, pref)` — domyślne wartości zależą od roli).
Cron digest: przypomnienia, przeterminowany kontakt, harmonogram, płatności (zaległe i nadchodzące 7 dni), zadania, flota+polisy (30 dni), niski stan magazynu, faktury kosztowe, BHP/badania, alerty rentowności, rozliczenia ≥ 1000 zł, budowy bez aktualizacji ≥ 7 dni.
Zakres per odbiorca zawęża `lib/digest-scope.ts` (`fetchAccessibleCaseIds` + `scope*`), a wpisy `data_scope: "payroll"` są odcinane dla roli `office`.
Alerty BHP/badań: progi 30/14/7/1/0 dni + „po terminie”, idempotencja przez `user_notifications.event_key`.

### 8.4 Asystent AI (`lib/ai-assistant.ts`)

- Dostęp: `ASSISTANT_ALLOWED_ROLES` = owner/office/manager/sales/brygadzista (musi być zgodne z `can_use_ai_assistant` w SQL — rozjazd w przeszłości powodował błędy, patrz 0057).
- Kontekst budowany zapytaniowo (RAG bez bazy wektorowej), przez klienta z sesją użytkownika → obowiązuje RLS.
- Limity: kontekst ~35 000 znaków, historia 12 wiadomości (po 2 000 znaków), prompt 5 000 znaków, załączniki 12 000 znaków.
- `office` nie dostaje indywidualnych danych płacowych — koszt robocizny wyłącznie przez `payroll_labor_costs_aggregated`.
- V1 jest **tylko do odczytu** — AI nic nie zapisuje do bazy poza własnymi rozmowami/artefaktami.
- Rozmowy są prywatne per użytkownik (0050).

### 8.5 Dokumenty

`lib/document-templates.ts` — edytowalne szablony: umowy (konsument/firma/podwykonawca/przedwstępna), aneksy (prace dodatkowe, termin), zobowiązanie płatnicze, protokoły (odbioru, przekazania placu), wezwanie do zapłaty (buduje treść z zaległych płatności — priorytet przeterminowane), oświadczenia (RODO, VAT 8%, przyjęcie gotówki).
Treść jest edytowalna w UI przed wygenerowaniem PDF, dokument można zapisać jako załącznik sprawy z odpowiednią kategorią.

---

## 9. Konwencje i pułapki przy zmianach

1. **Nowa tabela → RLS + grant + polityki + `organization_id`.** Bez wyjątków.
2. **Nie duplikować modeli.** Jest jeden model pracownika (`employee_profiles` + `employee_compensation`), jeden model kosztu (faktury kosztowe / rozliczenia / koszty bezpośrednie / akord).
3. **Podwójne liczenie kosztów** — przy każdej zmianie w rentowności sprawdzić powiązania faktura ↔ rozliczenie podwykonawcy oraz godziny ↔ karta miesięczna.
4. **Nie rozszerzać RLS na wrażliwe tabele „dla wygody”.** Wzorzec z 0055: udostępniać wąskie funkcje SECURITY DEFINER zwracające tylko bezpieczne kolumny (bo aplikacja robi `select("*")`).
5. **Płace** — każda nowa kolumna/tabela ze stawką lub kwotą wynagrodzenia idzie pod `can_view_payroll`, a logi pod `data_scope = 'payroll'`.
6. **Nowe terminy biznesowe** integrować równocześnie z kalendarzem, digestem i powiadomieniami.
7. **Ważne operacje** logować do `organization_activity_log`.
8. **Triggery a kaskady** — przy `DELETE FROM cases` rekordy potomne są kasowane po samej sprawie; triggery logujące muszą to znieść (patrz 0054: brak org → pomiń wpis; nie wstawiać `case_id` usuniętej sprawy).
9. **Route używający service role** musi najpierw uwierzytelnić użytkownika i samodzielnie sprawdzić organizację oraz rolę.
10. **Sprawy czytać przez `case_records`**, gdy potrzebna jest `estimated_value`; zapis wartości → `case_commercial_details`.
11. **Numeracja migracji** — następna to `0060`. Migracje w repo **nie muszą** być uruchomione na produkcji; brak rejestru wdrożeń w repo → przed pracą porównać stan Supabase z katalogiem.
12. Po zmianach schematu uruchomić **Supabase Security Advisor** i przetestować jako anon / zwykły członek / inna organizacja.

### Checklista przed wdrożeniem

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Plus: test ról (owner, office, sales, brygadzista, podwykonawca), brak wycieku finansów/HR przez bezpośrednie zapytania Supabase, signed URL do prywatnych plików z innej organizacji, responsywność ~360 px → desktop, PDF z polskimi znakami i podziałem stron, logi Vercel po deployu.

---

## 10. Znane ograniczenia / dług techniczny

- Brak testów automatycznych (RLS, API, scenariusze ról).
- **KSeF**: tylko generowanie XML FA(2). Brak uwierzytelniania, sesji, wysyłki, UPO, statusów, korekt, odbioru faktur.
- **E-mail**: tylko wysyłka przez Gmail SMTP. Brak IMAP/Gmail API, historii skrzynki, wątków, przypisywania korespondencji do spraw, wielu skrzynek OAuth.
- **Rozliczenia pracowników** to rozliczenie operacyjne, nie lista płac (brak ZUS, PIT, urlopów, nadgodzin ustawowych, netto).
- **Rentowność** to raport zarządczy, nie księgowy.
- Brak automatycznego pozyskiwania leadów.
- AI ma limitowany kontekst — przy dużej bazie kolejny krok to tool calling / paginacja / ewentualnie indeks wektorowy.
- `README.md` i część starszych komentarzy opisują nieaktualny stan.
- Brak rejestru wdrożonych migracji w repozytorium.
- Migracja `0059` **musi** być uruchomiona przed wdrożeniem kodu (aplikacja korzysta z `employee_compensation`; kolumny stawek w `employee_profiles` zostały usunięte).
