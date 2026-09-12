-- Powiadomienie e-mail o nowym komentarzu w dyskusji zadania (dla przypisanych).

alter table public.digest_email_prefs
  add column if not exists notify_task_comment boolean not null default true;

comment on column public.digest_email_prefs.notify_task_comment is 'Natychmiastowy mail gdy ktoś napisze w dyskusji zadania, do którego osoba jest przypisana';
