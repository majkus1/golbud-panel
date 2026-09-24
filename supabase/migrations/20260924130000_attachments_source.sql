-- Pliki sprawy: skąd się wzięły. Zakładka Umowa pokazuje obok siebie umowę wygenerowaną
-- z wzoru i podpisany skan — muszą się dać odróżnić bez zgadywania po nazwie pliku.

alter table public.attachments
  add column if not exists source text not null default 'upload',
  add column if not exists template_id text;

alter table public.attachments drop constraint if exists attachments_source_check;
alter table public.attachments
  add constraint attachments_source_check check (source in ('upload', 'generated'));

comment on column public.attachments.source is 'upload = plik dodany przez użytkownika (np. podpisany skan), generated = PDF z wzoru dokumentu.';
comment on column public.attachments.template_id is 'Id wzoru z lib/document-templates.ts, gdy source = generated.';

notify pgrst, 'reload schema';
