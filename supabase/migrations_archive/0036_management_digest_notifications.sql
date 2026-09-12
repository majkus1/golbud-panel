-- Rozszerzenie porannego digestu o sygnały zarządcze z nowych modułów:
-- rentowność, faktury kosztowe, rozliczenia ekip/pracowników, BHP/medycyna pracy
-- oraz budowy bez aktualizacji. Dodaje też typ natychmiastowego alertu finansowego.

alter table public.digest_email_prefs
  add column if not exists include_profitability_alerts boolean not null default true,
  add column if not exists include_cost_invoices boolean not null default true,
  add column if not exists include_employee_compliance boolean not null default true,
  add column if not exists include_settlements boolean not null default true,
  add column if not exists include_stale_cases boolean not null default true,
  add column if not exists notify_financial_alerts boolean not null default true;

comment on column public.digest_email_prefs.include_profitability_alerts is 'Digest: budowy ze stratą, niska marża, materiały ponad normę';
comment on column public.digest_email_prefs.include_cost_invoices is 'Digest: faktury kosztowe po terminie i nadchodzące płatności do dostawców';
comment on column public.digest_email_prefs.include_employee_compliance is 'Digest: terminy BHP i badań lekarskich pracowników';
comment on column public.digest_email_prefs.include_settlements is 'Digest: duże zaliczki, wypłaty i rozliczenia pracowników/podwykonawców';
comment on column public.digest_email_prefs.include_stale_cases is 'Digest: aktywne budowy bez aktualizacji przez kilka dni';
comment on column public.digest_email_prefs.notify_financial_alerts is 'Powiadomienia natychmiastowe: duże koszty, faktury i rozliczenia wpływające na kasę';

alter table public.user_notifications
  drop constraint if exists user_notifications_type_check;

alter table public.user_notifications
  add constraint user_notifications_type_check
  check (type in ('new_case', 'case_assigned', 'task_created', 'task_comment', 'financial_alert'));
