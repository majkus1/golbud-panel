-- Faza 2: paragony przy fakturach + wysyłka faktur mailem (klient / księgowa).
-- Idempotentna i bezpieczna do ponownego uruchomienia.

-- ── Faktury: paragon + ślad wysyłki ───────────────────────────────────────────
alter table public.invoices
  add column if not exists with_receipt boolean not null default false,
  add column if not exists receipt_date date,
  add column if not exists receipt_amount numeric(14, 2) check (receipt_amount is null or receipt_amount >= 0),
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to text;

-- ── Organizacja: ustawienia wysyłki faktur (księgowa + domyślna treść) ─────────
alter table public.organizations
  add column if not exists accountant_email text,
  add column if not exists invoice_email_subject text,
  add column if not exists invoice_email_body text;
