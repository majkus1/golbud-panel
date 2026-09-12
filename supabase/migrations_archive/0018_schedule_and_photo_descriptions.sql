-- Faza 7: opisy etapów harmonogramu + opisy zdjęć/załączników. Idempotentna.

alter table public.case_schedule_items
  add column if not exists description text;

alter table public.attachments
  add column if not exists description text;
