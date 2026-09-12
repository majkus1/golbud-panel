-- Faza 6: kategorie załączników dla generowanych dokumentów firmowych
-- (umowy, aneksy, protokoły, oświadczenia). Idempotentna.

alter table public.attachments drop constraint if exists attachments_category_check;

alter table public.attachments
  add constraint attachments_category_check
  check (
    category in (
      'przed pracami',
      'w trakcie',
      'po zakończeniu',
      'usterki',
      'materiały',
      'projekt',
      'inspiracje',
      'kosztorys zewnętrzny',
      'umowa',
      'aneks',
      'protokół',
      'oświadczenie'
    )
  );
