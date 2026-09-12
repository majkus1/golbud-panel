-- Rozszerzenie preferencji powiadomień: sekcje digestu + natychmiastowe nowe zapytanie.
-- Owner konfiguruje w Ustawienia → Zespół (domyślnie wg roli).

alter table public.digest_email_prefs
  add column if not exists include_schedule boolean not null default true,
  add column if not exists include_payments boolean not null default true,
  add column if not exists include_tasks boolean not null default true,
  add column if not exists include_fleet boolean not null default true,
  add column if not exists include_warehouse boolean not null default true,
  add column if not exists notify_new_case boolean not null default false;

comment on column public.digest_email_prefs.include_schedule is 'Digest: etapy harmonogramu po terminie';
comment on column public.digest_email_prefs.include_payments is 'Digest: płatności po terminie (role zarządcze)';
comment on column public.digest_email_prefs.include_tasks is 'Digest: zadania po terminie';
comment on column public.digest_email_prefs.include_fleet is 'Digest: flota i polisy';
comment on column public.digest_email_prefs.include_warehouse is 'Digest: niski stan magazynu';
comment on column public.digest_email_prefs.notify_new_case is 'Natychmiastowy mail przy nowym zapytaniu';
