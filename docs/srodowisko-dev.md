# Środowisko deweloperskie (lokalne)

Cel: pracować nad aplikacją bez dotykania bazy produkcyjnej, z której korzysta GolBud.

> **Zasada nadrzędna:** `npm run dev` nigdy nie może być podpięty pod produkcję.
> Klucze produkcyjne żyją wyłącznie w Vercel. Lokalnie używamy lokalnego Supabase.
>
> **Projekt jest domyślnie ODŁĄCZONY od produkcji** (`supabase unlink`). Dzięki temu
> `supabase db push` i `db reset --linked` nie mają dokąd sięgnąć. Łączymy się z produkcją
> tylko na czas świadomego wdrożenia albo odświeżenia kopii danych — i odłączamy z powrotem.

## Wymagania

- Docker Desktop (uruchomiony)
- Node 20+
- Supabase CLI — używany przez `npx supabase ...`, nie wymaga instalacji globalnej

## Uruchomienie na co dzień

```bash
npx supabase start
npm run dev
```

Zatrzymanie:

```bash
npx supabase stop
```

Dane w lokalnej bazie przeżywają `stop`/`start`. Kasuje je dopiero `npx supabase db reset`
(odtwarza schemat z migracji i uruchamia `supabase/seed.sql`).

## Adresy lokalne

| Usługa | Adres |
|---|---|
| Aplikacja | http://localhost:3000 |
| Supabase Studio (panel bazy) | http://localhost:54323 |
| API Supabase | http://localhost:54321 |
| PostgreSQL | localhost:54322 (user `postgres`, hasło `postgres`) |
| Mailpit — skrzynka testowa | http://localhost:54324 |

Studio lokalne wygląda jak panel w chmurze — tam podejrzymy tabele, polityki RLS i uruchomimy SQL.

## Układ katalogu `supabase/`

| Ścieżka | Zawartość |
|---|---|
| `migrations/2026…_baseline.sql` | zrzut **schematu produkcyjnego** — 66 tabel, 91 funkcji, 128 polityk RLS |
| `migrations/2026…_storage_policies.sql` | 12 polityk RLS na `storage.objects` (patrz niżej) |
| `migrations/2026…_auth_triggers.sql` | triggery na `auth.users` (patrz niżej) |
| `migrations_archive/` | historyczne `0002`–`0059` — dokumentacja, **nie są odtwarzane** |
| `seed.sql` | pełna kopia danych produkcyjnych, **poza repozytorium** (`.gitignore`) |
| `dumps/` | surowe zrzuty, **poza repozytorium** |
| `schema.sql` | pierwotny schemat etapu 1 — historyczny, nieużywany |

Dlaczego zrzut zamiast odtwarzania migracji `0002`–`0059`: w repozytorium nie ma rejestru,
które migracje faktycznie poszły na produkcję. Zrzut daje pewność, że lokalna baza jest
identyczna z produkcyjną.

**`supabase db dump` pomija schematy `storage` i `auth`** — stąd dwie migracje uzupełniające:

- **polityki Storage** — bez nich lokalna baza nie ma żadnej ochrony plików, a testy uprawnień
  do załączników, dokumentów kadrowych i plików AI dają fałszywie pozytywny wynik,
- **triggery `auth.users`** — same funkcje (`handle_new_user`, `sync_user_directory_profile`)
  przyjeżdżają ze schematem `public`, ale ich podpięcie do tabeli użytkowników już nie.
  Bez nich rejestracja nie tworzy organizacji i każdy nowy użytkownik ląduje na komunikacie
  „Brak przypisanej organizacji".

Obie migracje są idempotentne — na produkcji, gdzie te obiekty istnieją, nic nie zmieniają.
**Przy każdym kolejnym zrzucie schematu z produkcji trzeba je zachować.**

## Odtworzenie środowiska od zera

```bash
npx supabase start
npx supabase db reset
```

Nie wymaga połączenia z produkcją — schemat jest w migracjach, dane w `seed.sql`.

## Połączenie z produkcją (tylko gdy naprawdę potrzebne)

Potrzebne wyłącznie do: odświeżenia kopii danych albo wdrożenia migracji.

```bash
npx supabase login
npx supabase link --project-ref jjrnjowjkeyrggxuyciw
# ... praca z produkcją ...
npx supabase unlink          # ZAWSZE odłączyć po zakończeniu
```

`link` zapyta o **hasło bazy danych** (nie o `anon key`). Jeśli go nie znamy:
Dashboard → Settings → Database → **Reset database password**. Reset hasła nie przerywa
działania aplikacji — panel łączy się przez klucze API, a nie po `postgresql://`.

## Odświeżenie kopii danych z produkcji

Wymaga chwilowego `link` (patrz wyżej):

```bash
npx supabase db dump -f supabase/migrations/<NOWY_TIMESTAMP>_baseline.sql   # gdy zmienił się schemat
npx supabase db dump --data-only -f supabase/seed.sql                        # same dane
npx supabase db reset
npx supabase unlink
```

Zrzut `--data-only` obejmuje również schematy `auth` (konta) i `storage` (metadane plików)
oraz zaczyna się od `SET session_replication_role = replica`, dzięki czemu przy odtwarzaniu
nie odpalają się triggery — inaczej wstawienie kont uruchomiłoby `handle_new_user`
i utworzyło duplikaty organizacji.

## Nowe zmiany w bazie

Od teraz **każda** zmiana schematu to nowa migracja:

```bash
npx supabase migration new nazwa_zmiany
# edytujemy wygenerowany plik
npx supabase db reset      # test od zera lokalnie
```

Wdrożenie na produkcję:

```bash
npx supabase db push
```

Kolejność wdrożenia jest zawsze taka sama: **najpierw migracja, potem deploy kodu.**

## Testy

```bash
npm test          # jednorazowo
npm run test:watch
```

Dwie grupy, obie uruchamiane tym samym poleceniem:

| Grupa | Lokalizacja | Wymagania |
|---|---|---|
| jednostkowe — czyste funkcje | `lib/**/*.test.ts` | brak, działają zawsze |
| integracyjne — RLS, RPC, Vault | `tests/integration/**` | lokalny Supabase; bez niego same się pomijają |

Testy integracyjne zakładają własnych użytkowników z losowym sufiksem i sprzątają po sobie
w `afterAll`, więc nie psują danych w lokalnej kopii.

Zasada: **każda nowa funkcja dostaje testy** — logika biznesowa jednostkowe, a uprawnienia
i polityki bazy integracyjne. Znaleziony błąd najpierw dostaje test, który go odtwarza
(przykład: „pozwala dodać skrzynkę ponownie po usunięciu wiersza kaskadą").

## Czego lokalnie nie ma

| Funkcja | Stan lokalnie |
|---|---|
| Auth, Storage, Realtime, RLS | działa identycznie jak na produkcji |
| Web push | działa (`localhost` to bezpieczny kontekst), wymaga własnych kluczy VAPID: `npx web-push generate-vapid-keys` |
| Asystent AI | wymaga płatnego klucza OpenAI; bez niego ustawić `AI_ASSISTANT_ALLOW_LOCAL_FALLBACK=true` |
| Wysyłka e-mail | transport jest zakodowany na Gmail SMTP (`lib/send-notification.ts`), więc lokalnie po prostu nie wyśle. Docelowo warto wystawić host/port do zmiennych i wpiąć Mailpit |
| Cron digestu | Vercel go lokalnie nie wywoła — uruchamiamy ręcznie: `Invoke-RestMethod -Uri "http://localhost:3000/api/cron/reminder-digest" -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }` |

## Dane

Lokalna baza to **pełna kopia produkcji** (decyzja z 8.08.2026). Stan po odtworzeniu:

| | |
|---|---|
| konta użytkowników | 6 |
| zlecenia | 57 |
| pracownicy | 17 |
| wpisy w dzienniku zmian | 189 |
| buckety Storage | 3 |

Puste na produkcji, więc puste i lokalnie: `offer_lines`, `invoices`, `work_hours`,
`attachments`, `supplier_invoices`, `employee_compensation`.

### Czego w kopii nie ma

**Plików ze Storage.** Zrzut przenosi tylko metadane (`storage.objects`), więc w aplikacji
widać listę załączników, ale pobranie zwróci błąd. Same pliki — zdjęcia z budów, skany
faktur, dokumenty kadrowe — zostają w chmurze.

### Konto testowe

Do testów utworzone jest lokalne konto **`dev@local.test` / `test1234`** (rola `owner`
w organizacji z danymi). Istnieje wyłącznie w kopii lokalnej — `db reset` je usuwa,
wtedy trzeba je odtworzyć.

Żeby sprawdzić widok innej roli, wystarczy podmienić rolę tego konta:

```sql
update public.organization_members set role = 'brygadzista'
where user_id = (select id from auth.users where email = 'dev@local.test');
```

### Bezpieczeństwo

Kopia zawiera dane osobowe klientów GolBud, konta pracowników wraz z haszami haseł oraz
dokumentację kadrową.

- `supabase/seed.sql` i `supabase/dumps/` są w `.gitignore` — nie trafią do repozytorium.
- Dysk powinien mieć włączone szyfrowanie (BitLocker).
- Nie wrzucać zrzutów do chmury ani nie załączać do zgłoszeń.
- Skasować kopię, gdy przestanie być potrzebna: `rm -rf supabase/dumps supabase/seed.sql`.
