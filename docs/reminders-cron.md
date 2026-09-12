# Dzienny e-mail z przypomnieniami (cron + Gmail)

## Co wysyłamy

Zgodnie z ideą „nie giną tematy po ofercie”:

1. **Wiersze z tabeli `reminders`** — `remind_at` ≤ dzisiejsza data w **Europe/Warsaw**, `completed_at` jest puste. To są przypomnienia dodane w zakładce sprawy **„Przypomnienia”**.
2. **Sprawy z przeterminowanym polem „kolejny kontakt”** (`cases.next_contact_date`) — data ≤ dziś, status inny niż `rozliczone` / `utracone`.

W mailu są linki do `/cases/[id]`.

Pusta lista: domyślnie **nie wysyłamy** wiadomości (żeby nie zaśmiecać skrzynki). Żeby dostać potwierdzenie „0 pozycji”, ustaw `REMINDER_DIGEST_SEND_EMPTY=true`.

## Odbiorcy: panel vs `REMINDER_DIGEST_TO`

1. **Priorytet — tabela `digest_email_prefs`** (migracja `supabase/migrations/0004_digest_email_prefs.sql`): właściciel w **Ustawienia → Zespół i role** włącza digest **per użytkownik** (adres = e-mail konta z Supabase Auth) i zaznacza, czy mail ma zawierać **przypomnienia z karty sprawy** i/lub **przeterminowany kolejny kontakt**. Cron wysyła **osobną** wiadomość na każdy włączony adres (tylko pozycje z **tej samej organizacji** co użytkownik).
2. **Fallback**: jeśli **nikt** nie ma `digest_enabled`, używany jest **`REMINDER_DIGEST_TO`** (jedna wiadomość na listę adresów, pełna treść wszystkich organizacji w projekcie — sensowne przy jednej firmie na instancję).

Uruchom migrację `0004` w Supabase SQL Editor po wcześniejszych migracjach (wymaga funkcji `is_owner_of` z `0003`).

## Zmienne środowiskowe

| Zmienna | Opis |
|--------|------|
| `SUPABASE_SERVICE_ROLE_KEY` | Klucz **service_role** z Supabase (Dashboard → Settings → API). **Tylko serwer** — nigdy w przeglądarce. |
| `CRON_SECRET` | Losowy ciąg (np. `openssl rand -hex 32`). Weryfikacja nagłówka `Authorization: Bearer …`. |
| `SMTP_GMAIL_USER` | Pełny adres nowej skrzynki Gmail (np. `powiadomienia@…`). |
| `SMTP_GMAIL_APP_PASSWORD` | [Hasło aplikacji Google](https://myaccount.google.com/apppasswords) (2FA na koncie musi być włączone). |
| `SMTP_GMAIL_FROM` | Opcjonalnie inny adres w polu „Od” (domyślnie = `SMTP_GMAIL_USER`). |
| `REMINDER_DIGEST_TO` | **Tylko gdy brak włączonych użytkowników w panelu** — kilka adresów po przecinku. |
| `NEXT_PUBLIC_APP_URL` | Publiczny URL panelu (np. `https://twoja-apka.vercel.app`) — **linki w mailu**. Na Vercel można ustawić ręcznie; bez tego używany jest `VERCEL_URL` z deployu. |
| `REMINDER_DIGEST_SEND_EMPTY` | Opcjonalnie `true` / `1` — wysyłaj mail także gdy lista jest pusta (per odbiorca w trybie panelu). |

Dodaj je w **Vercel → Project → Settings → Environment Variables** (oraz lokalnie w `.env.local` do testów).

## Cron na Vercel

1. W projekcie jest `vercel.json` z harmonogramem **`0 5 * * *`** (05:00 UTC ≈ 06:00 / 07:00 w PL w zależności od lata/zimy). Możesz zmienić crontab według potrzeb.
2. Ustaw **`CRON_SECRET`** w zmiennych środowiska Vercel. Przy zaplanowanym wywołaniu Vercel dołącza nagłówek `Authorization: Bearer <CRON_SECRET>` do żądania GET na ten endpoint (patrz [dokumentacja Vercel — securing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)).
3. Po deployu cron jest aktywny na planie, który obejmuje crony (np. Pro lub zgodnie z aktualnym cennikiem Vercel).

### Test ręczny (curl)

```bash
curl -sS -H "Authorization: Bearer TWOJ_CRON_SECRET" "https://twoja-domena.vercel.app/api/cron/reminder-digest"
```

Oczekiwana odpowiedź JSON: `{ "ok": true, "sent": true|false, ... }`.

## Bezpieczeństwo

- **Nie commituj** `.env.local` ani haseł.
- **Service role** omija RLS — endpoint musi być wyłącznie dla crona (`CRON_SECRET`).
- Hasło aplikacji Gmail traktuj jak sekret produkcyjny; ogranicz dostęp do skrzynki (np. tylko wysyłka digestu).

## Gmail — typowe problemy

- Konto musi mieć **weryfikację dwuetapową**, żeby wygenerować hasło aplikacji.
- Organizacyjne Workspace czasem **blokują** SMTP lub hasła aplikacji — wtedy trzeba polityki u admina Google albo inny SMTP (np. firmowy).
