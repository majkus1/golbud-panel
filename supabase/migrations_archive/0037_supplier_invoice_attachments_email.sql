-- Faktury kosztowe: skan/PDF jako załącznik sprawy + historia wysyłki do księgowej.

alter table public.supplier_invoices
  add column if not exists attachment_id uuid references public.attachments(id) on delete set null,
  add column if not exists sent_to text,
  add column if not exists sent_at timestamptz;

create index if not exists supplier_invoices_attachment_idx on public.supplier_invoices(attachment_id);

comment on column public.supplier_invoices.attachment_id is 'Opcjonalny skan/PDF faktury kosztowej z tabeli attachments';
comment on column public.supplier_invoices.sent_to is 'Adresy, na które wysłano fakturę kosztową do księgowości';
comment on column public.supplier_invoices.sent_at is 'Data wysyłki faktury kosztowej do księgowości';
