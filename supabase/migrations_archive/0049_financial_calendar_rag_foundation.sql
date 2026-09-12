-- Financial truth, calendar coverage and subcontractor cost deduplication.

alter table public.invoices
  add column if not exists paid_at timestamptz;

alter table public.supplier_invoices
  add column if not exists paid_at timestamptz,
  add column if not exists subcontractor_id uuid references public.subcontractors(id) on delete set null,
  add column if not exists case_subcontractor_id uuid references public.case_subcontractors(id) on delete set null,
  add column if not exists linked_settlement_entry_id uuid references public.subcontractor_settlement_entries(id) on delete set null;

create unique index if not exists supplier_invoices_linked_settlement_uidx
  on public.supplier_invoices(linked_settlement_entry_id)
  where linked_settlement_entry_id is not null;

create index if not exists supplier_invoices_subcontractor_idx
  on public.supplier_invoices(organization_id, subcontractor_id, invoice_date desc);

create index if not exists reminders_org_remind_idx
  on public.reminders(organization_id, remind_at)
  where completed_at is null;

create index if not exists case_schedule_items_org_due_idx
  on public.case_schedule_items(organization_id, due_date)
  where completed = false and due_date is not null;

create or replace function public.stamp_invoice_paid_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if coalesce(NEW.paid_amount, 0) > 0 and NEW.paid_at is null then
      NEW.paid_at := now();
    end if;
    return NEW;
  end if;
  if coalesce(NEW.paid_amount, 0) > coalesce(OLD.paid_amount, 0) then
    NEW.paid_at := now();
  elsif coalesce(NEW.paid_amount, 0) = 0 then
    NEW.paid_at := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists stamp_invoice_paid_at on public.invoices;
create trigger stamp_invoice_paid_at
before insert or update on public.invoices
for each row execute function public.stamp_invoice_paid_at();

drop trigger if exists stamp_supplier_invoice_paid_at on public.supplier_invoices;
create trigger stamp_supplier_invoice_paid_at
before insert or update on public.supplier_invoices
for each row execute function public.stamp_invoice_paid_at();

update public.invoices
set paid_at = updated_at
where paid_at is null and paid_amount > 0;

update public.supplier_invoices
set paid_at = updated_at
where paid_at is null and paid_amount > 0;

create or replace function public.validate_supplier_invoice_settlement_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  settlement_org uuid;
  settlement_case uuid;
  settlement_subcontractor uuid;
begin
  if NEW.linked_settlement_entry_id is null then
    return NEW;
  end if;
  if NEW.category <> 'podwykonawca' then
    raise exception 'Powiązanie z rozliczeniem jest dostępne tylko dla kosztu podwykonawcy';
  end if;

  select organization_id, case_id, subcontractor_id
  into settlement_org, settlement_case, settlement_subcontractor
  from public.subcontractor_settlement_entries
  where id = NEW.linked_settlement_entry_id;

  if settlement_org is null
    or settlement_org <> NEW.organization_id
    or settlement_case is distinct from NEW.case_id
    or settlement_subcontractor is distinct from NEW.subcontractor_id then
    raise exception 'Faktura i rozliczenie muszą dotyczyć tej samej organizacji, sprawy i podwykonawcy';
  end if;
  return NEW;
end;
$$;

drop trigger if exists validate_supplier_invoice_settlement_link on public.supplier_invoices;
create trigger validate_supplier_invoice_settlement_link
before insert or update
on public.supplier_invoices
for each row execute function public.validate_supplier_invoice_settlement_link();

comment on column public.supplier_invoices.linked_settlement_entry_id is
  'Jeśli faktura dokumentuje wskazane rozliczenie podwykonawcy, jej kwota nie jest drugi raz doliczana do kosztu.';
