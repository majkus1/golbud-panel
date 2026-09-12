-- Wezwanie do zapłaty jako osobna kategoria załącznika dla dokumentów firmowych.
-- Idempotentna aktualizacja constraintu kategorii.

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
      'wezwanie do zapłaty',
      'oświadczenie'
    )
  );
