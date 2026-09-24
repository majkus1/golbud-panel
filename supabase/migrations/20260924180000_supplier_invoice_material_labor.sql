-- Faktura kosztowa „materiały i robocizna” (prośba z 7.08).
--
-- Nowa kategoria `materialy_robocizna` i podział kwoty brutto na część materiałową
-- i robociznę. Rentowność rozdziela taką fakturę na oba rodzaje kosztu.
-- Kolumny są opcjonalne: przy pozostałych kategoriach zostają puste.

alter table public.supplier_invoices drop constraint if exists supplier_invoices_category_check;
alter table public.supplier_invoices
  add constraint supplier_invoices_category_check
  check (category = any (array['materialy'::text, 'robocizna'::text, 'materialy_robocizna'::text, 'sprzet'::text, 'transport'::text, 'podwykonawca'::text, 'inne'::text]));

alter table public.supplier_invoice_category_rules drop constraint if exists supplier_invoice_category_rules_category_check;
alter table public.supplier_invoice_category_rules
  add constraint supplier_invoice_category_rules_category_check
  check (category = any (array['materialy'::text, 'robocizna'::text, 'materialy_robocizna'::text, 'sprzet'::text, 'transport'::text, 'podwykonawca'::text, 'inne'::text]));

alter table public.supplier_invoices
  add column if not exists material_gross numeric(12, 2),
  add column if not exists labor_gross numeric(12, 2);

alter table public.supplier_invoices drop constraint if exists supplier_invoices_cost_split_check;
alter table public.supplier_invoices
  add constraint supplier_invoices_cost_split_check
  check (
    (material_gross is null or material_gross >= 0)
    and (labor_gross is null or labor_gross >= 0)
    -- Gdy podane są obie części, muszą dać kwotę brutto (co do grosza).
    and (material_gross is null or labor_gross is null or abs(material_gross + labor_gross - gross_total) < 0.01)
  );

notify pgrst, 'reload schema';
