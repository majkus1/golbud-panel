-- Kosztorys powykonawczy: rozliczenie w kwotach brutto.
--
-- Do tej pory dokument odejmował wpłaty klienta (zawsze brutto — tyle realnie przelał)
-- od wartości robót netto i wynik podpisywał „pozostało do dopłaty netto”. Kwota do
-- zapłaty była zaniżona dokładnie o VAT. Klient zgłosił to wprost.
--
-- Nowe kolumny są opcjonalne: stare rekordy zostają bez nich i odtwarzają się jak dotąd,
-- nowe zapisują stawkę VAT z chwili wystawienia oraz kwoty brutto — żeby historia
-- kosztorysów była odtwarzalna niezależnie od późniejszej zmiany stawki w ustawieniach.

alter table public.case_as_built_estimates
  add column if not exists vat_rate numeric,
  add column if not exists vat_total numeric,
  add column if not exists gross_total numeric,
  add column if not exists balance_due_gross numeric;

comment on column public.case_as_built_estimates.vat_rate is 'Stawka VAT (%) użyta przy wystawieniu — migawka z ustawień firmy.';
comment on column public.case_as_built_estimates.gross_total is 'Wartość robót brutto = net_total + vat_total.';
comment on column public.case_as_built_estimates.balance_due_gross is 'Pozostało do zapłaty brutto = gross_total − otrzymane wpłaty (advances_paid).';

select '20260912120000_as_built_gross: OK' as migration_status;
