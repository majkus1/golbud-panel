-- Jednorazowe alerty w aplikacji i Web Push dla terminow BHP/badan lekarskich.
-- event_key zabezpiecza cron przed ponownym wyslaniem tego samego progu.

alter table public.user_notifications
  add column if not exists event_key text;

alter table public.user_notifications
  drop constraint if exists user_notifications_user_event_key_key;

alter table public.user_notifications
  add constraint user_notifications_user_event_key_key unique (user_id, event_key);

comment on column public.user_notifications.event_key is
  'Klucz idempotencji dla automatycznych alertow (uzytkownik + dokument + data waznosci + prog).';

alter table public.user_notifications
  drop constraint if exists user_notifications_type_check;

alter table public.user_notifications
  add constraint user_notifications_type_check
  check (type in (
    'new_case',
    'case_assigned',
    'task_created',
    'task_comment',
    'financial_alert',
    'employee_compliance'
  ));
