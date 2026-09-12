# GolBud Panel

Panel pod firmę budowlaną: **karta sprawy z procesem i statusami**, **oferta PDF + kosztorys** (robocizna, materiał, katalog pozycji, warianty), **harmonogram**, **płatności i zaliczki**, **przypomnienia**, **prace dodatkowe**, **protokoły PDF**, **załączniki** (Supabase Storage), **notatki**.

**Etap 2 — dodane:** panel realizacji aktywnych (tablica kanban), **zadania wewnętrzne** z przypisaniem do osoby, **podwykonawcy** (baza + przypisania do sprawy ze stawkami/zakresem), **raport skuteczności** + **eksport CSV**, **role użytkowników** (właściciel/biuro/handlowiec/kierownik/pracownik).

## Stack

- Next.js (App Router), TypeScript, Tailwind
- Supabase: Auth, Postgres (RLS), Storage
- PDF: `@react-pdf/renderer` (endpointy API z sesją użytkownika)
- Deploy: Vercel (zmienne jak poniżej)

## Architektura i bezpieczeństwo

- **Organizacja:** każdy użytkownik po rejestracji dostaje rekord `organizations` + `organization_members` (rola `owner`) przez trigger na `auth.users` oraz funkcję `ensure_user_org()` (dla kont utworzonych przed wdrożeniem schematu — wywoływana z aplikacji przy pierwszym logowaniu).
- **RLS:** wszystkie tabele operacyjne są filtrowane po `organization_id` członkostwa — brak dostępu do cudzych danych (ochrona przed IDOR).
- **Notatki:** edycja i usuwanie tylko dla autora (`user_id`); odczyt w całej organizacji.
- **Storage:** bucket prywatny `case-attachments`, ścieżka `{organization_id}/{case_id}/...`, polityki po pierwszym segmencie ścieżki.
- **PDF:** generowane po stronie serwera po weryfikacji sesji Supabase; brak zaufania do `organization_id` z klienta — dane z rekordów widocznych przez RLS.
- **Upload:** limit rozmiaru i typów MIME po stronie klienta (15 MB; JPG, PNG, WebP, PDF).

## 1. Supabase — SQL

1. W projekcie Supabase: **SQL Editor**.
2. Wklej i uruchom **`supabase/schema.sql`** (całość) — bazowy schemat etapu 1.
3. Następnie uruchom **`supabase/migrations/0002_extras.sql`** — dorzuca podwykonawców, zadania wewnętrzne i rozszerzone role (`owner` / `office` / `sales` / `manager` / `member`) z politykami RLS oraz widok `org_member_profiles` z e-mailami członków zespołu.
4. Uruchom kolejne migracje **po numerach** (`0003` … `0013`).
   - **`0012_invoices.sql`** — moduł faktur: tabele `invoices` / `invoice_lines` (pozycje z rabatem i VAT per pozycja, sumy liczone triggerem), licznik numeracji `invoice_counters` z bezpieczną funkcją `next_invoice_seq(org, kind, year)` oraz polityki RLS.
   - **`0013_attachment_kosztorys.sql`** — dodaje kategorię załącznika `kosztorys zewnętrzny` (pliki od kosztorysanta / z Normy / Excela).

Uwagi:

- Bazowy skrypt usuwa stare tabele demo `leads` i `notes` (jeśli istnieją).
- Migracja `0002_extras.sql` jest **idempotentna** i bezpieczna do ponownego uruchomienia (sam `create table if not exists`, podmiana polityk i CHECK na roli).
- Jeśli masz już trigger na `auth.users` od innego modułu, może zajść konieczność ręcznego scalenia — domyślnie tworzony jest `on_auth_user_created` wywołujący `handle_new_user`.

## 2. Storage

Bucket `case-attachments` jest tworzony w tym samym skrypcie SQL. Jeśli insert do `storage.buckets` się nie powiedzie (np. brak uprawnień), utwórz bucket ręcznie w panelu: **Storage → New bucket** → nazwa `case-attachments`, **private**.

## 3. Zmienne środowiskowe

`.env.local` (lub Vercel):

```env
NEXT_PUBLIC_SUPABASE_URL=https://twoj-projekt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=twoj-anon-key
```

Sesja jest trzymana w **cookies** (kompatybilnie z PDF i innymi Route Handlerami). Po pierwszym wdrożeniu tej zmiany użytkownicy zwykle muszą **wylogować się i zalogować ponownie** raz, żeby odświeżyć sesję w ciasteczkach.

## 4. Uruchomienie lokalne

```bash
npm install
npm run dev
```

## 5. Trasy aplikacji

| Ścieżka | Opis |
|--------|------|
| `/` | Dashboard (statystyki, zadania na dziś, kontakty po terminie) |
| `/board` | Tablica realizacji (kanban po statusie, filtry ekipa/źródło, szybka zmiana statusu) |
| `/cases` | Lista spraw + eksport CSV |
| `/cases/new` | Nowa sprawa (+ domyślny harmonogram + pierwszy wariant oferty) |
| `/cases/[id]` | Karta sprawy (Przegląd, Oferta, **Faktury**, Harmonogram, Płatności, Przypomnienia, **Zadania**, **Podwykonawcy**, Prace dodatkowe, Protokoły, Załączniki, Notatki). Zakładki są deep-linkowane przez `?tab=`. |
| `/cases/[id]/edit` | Edycja danych podstawowych |
| `/tasks` | Zadania wewnętrzne biura/ekip (filtry: status, osoba, „tylko moje”) |
| `/reports` | Raport skuteczności + eksport CSV (sprawy i płatności) |
| `/vehicles` | Flota — ubezpieczenie, przegląd, serwis |
| `/vehicles/[id]` | Karta pojazdu |
| `/warehouse` | Magazyn materiałów na bazie (przyjęcia, zużycie, niski stan) |
| `/settings/company` | Dane firmy na PDF oferty (NIP, adres, konto, VAT — edycja: właściciel) |
| `/settings/crews` | Ekipy / brygady (własne) |
| `/settings/subcontractors` | Podwykonawcy / firmy zewnętrzne |
| `/settings/catalog` | Baza pozycji kosztorysowych |
| `/settings/team` | Zespół i role (nadawanie ról członkom organizacji) |

Stare adresy `/leads/*` są przekierowywane na `/cases/*` (middleware).

## 6. PDF

- Oferta: `GET /api/cases/[caseId]/variants/[variantId]/pdf` (wymaga sesji: cookies **albo** nagłówek `Authorization: Bearer <access_token>` — w panelu używane jest `fetch` z tokenem, żeby działało na Vercel).
- Protokół: `GET /api/cases/[caseId]/protocols/[protocolId]/pdf`
- Faktura (PDF): `GET /api/cases/[caseId]/invoices/[invoiceId]/pdf`
- Faktura (KSeF): `GET /api/cases/[caseId]/invoices/[invoiceId]/ksef` — eksport do uproszczonego XML w strukturze **FA(2)**. To **fundament** pod KSeF (format + dane); wysyłka online do KSeF (uwierzytelnienie, sesja, podpis, API MF) to osobny etap.
- Umowa: `GET /api/cases/[caseId]/contract/pdf?variantId=...&advancePct=30` — umowa o roboty budowlane generowana z wybranego wariantu oferty (kosztorys, wynagrodzenie, harmonogram płatności z zaliczką, terminy, warunki, podpisy Stron).
- Kosztorys powykonawczy: `POST /api/cases/[caseId]/as-built-estimates` (generuje PDF **KOSZTORYS POWYKONAWCZY**, zapisuje w Storage i historii sprawy); `GET /api/cases/[caseId]/as-built-estimates/[id]/pdf` — ponowne pobranie. W panelu: zakładka **Kosztorys powykonawczy**, skrót przy **Więcej**, generator w **Wycena / oferta → Dokumenty** oraz baner w **Dokumenty**.

## 7. Role użytkowników

| Rola | Uprawnienia |
|------|-------------|
| `owner` (Właściciel) | wszystko, w tym nadawanie ról i zarządzanie zespołem |
| `office` (Biuro) | pełne CRUD na sprawach, podwykonawcach, zadaniach całego zespołu |
| `manager` (Kierownik) | jak biuro (zadania zespołu, podwykonawcy) |
| `sales` (Handlowiec) | sprawy i oferty; **widzi tylko swoje zadania** (przypisane lub utworzone) |
| `member` (Pracownik) | jak handlowiec; bez modyfikacji bazy podwykonawców |

RLS po stronie bazy egzekwuje powyższe.

## 8. Codzienne maile z przypomnieniami (cron)

Harmonogram jest w **`vercel.json`** — wyrażenie crona jest zawsze w **UTC** (Vercel nie ma „strefy projektu” dla crona). Oś czasu na wykresie logów to zwykle **czas lokalny Twojej przeglądarki** — możesz więc widzieć „22:xx” i jednocześnie mieć w cronie **20:xx UTC**; latem w Polsce to ta sama chwila co 22:xx CEST.

**Plan Hobby:** dokładność to **cała godzina UTC**, nie minuta — np. wpis `20 20 * * *` oznacza uruchomienie **raz dziennie gdzieś między 20:00 a 20:59 UTC** (w Polsce latem: między 22:00 a 22:59). Na **Pro** wywołanie jest w wąskim oknie minuty. Przykład samej godziny: `20 20 * * *` w sensie „20 UTC” — patrz [Usage & Pricing — Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Cron działa tylko na **wdrożeniu produkcyjnym** (nie na samym preview), po **opublikowaniu** `vercel.json`.

- **Na Vercel** cron wywołuje `GET /api/cron/reminder-digest` dopiero po **wdrożeniu** z aktualnym `vercel.json`. Lokalny `npm run dev` **nie** dostaje wywołań z Vercela.
- **Lokalny test** (bez czekania na godzinę): uruchom `npm run dev` i wywołaj endpoint z nagłówkiem `Authorization: Bearer <CRON_SECRET>` (wartość jak w `.env.local`), np. PowerShell:  
  `Invoke-RestMethod -Uri "http://localhost:3000/api/cron/reminder-digest" -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }`

**Żeby faktycznie poszedł e-mail**, w `.env.local` (lub Vercel) muszą być m.in.: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_GMAIL_USER`, `SMTP_GMAIL_APP_PASSWORD` (patrz `.env.example`).

**Odbiorcy:**

1. Jeśli w **Ustawienia → Zespół** właściciel włączył komuś **„Wysyłaj poranne podsumowanie”** i **Zapisz** — mail idzie na adres konta tej osoby (tylko wpisy z włączonym digestem w bazie).
2. Gdy **nikt** nie ma włączonego digestu — używany jest **`REMINDER_DIGEST_TO`** (adresy po przecinku), jeśli jest ustawiony.

**Treść:** uwzględniane są przypomnienia z kart spraw (`remind_at` ≤ dziś, Warszawa) oraz sprawy z **„kolejnym kontaktem”** wstecz (data ≤ dziś, status inny niż rozliczone/utracone). Dane demo dodają m.in. sprawę z terminem kontaktu na **wczoraj** — przy włączonym „przeterminowany kontakt” powinna pojawić się w mailu. Gdy lista jest pusta, domyślnie mail **nie** idzie — można ustawić `REMINDER_DIGEST_SEND_EMPTY=1` / `true`, żeby dostać pusty raport testowy.

## 9. Import kosztorysów zewnętrznych

W zakładce **Wycena / oferta** (po wybraniu wariantu) jest przycisk **„Importuj kosztorys (CSV / XLSX)"**:

- obsługa **CSV** (auto-wykrywanie separatora `;` / `,` / tab, format liczb PL `1 234,56`) oraz **XLSX/XLS** (SheetJS, parsowanie po stronie klienta),
- automatyczne rozpoznanie kolumn po nagłówku (nazwa, jednostka, ilość, cena, wartość, rodzaj); przy braku nagłówka zakładana jest kolejność: nazwa, j.m., ilość, cena,
- podgląd i zaznaczanie pozycji + ustawienie sekcji (robocizna / materiał) przed importem do pozycji wariantu,
- oryginalny plik można dodatkowo wgrać do sprawy w zakładce **Pliki** pod kategorią **„kosztorys zewnętrzny"**.

Uwaga bezpieczeństwo: używamy **załatanej** wersji SheetJS z oficjalnego CDN (`xlsx-0.20.3`), nie podatnej wersji z rejestru npm.

## 10. Kierunek dalszego rozwoju

- Integracja e‑mail: import korespondencji do kart spraw (IMAP/Microsoft Graph/Gmail API).
- Powiadomienia SMS/WhatsApp dla przypomnień (Twilio / WhatsApp Cloud API).
- Etykiety / tagi dla spraw, własne pola.
- Sygnatura PDF z logo i danymi firmy z `/settings`.
- Wykresy w `/reports` (np. recharts) — obecnie raport jest tabelaryczny + CSV, świadoma decyzja na MVP.
