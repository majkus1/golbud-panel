-- Nowa kategoria załącznika: "kosztorys zewnętrzny" (pliki od kosztorysanta / z Normy / Excela).
-- Idempotentna: podmienia CHECK na kolumnie attachments.category.

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
      'kosztorys zewnętrzny'
    )
  );
