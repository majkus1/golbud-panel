-- Kosztorys: pozycja „materiał i robocizna” oraz dodatkowe jednostki.
--
-- 1. Rodzaj pozycji 'mixed' — jedna stawka z materiałem (np. docieplenie 1 m² z klejem
--    i siatką). Dotyczy pozycji ofert i szablonów kosztorysów.
-- 2. Jednostki m³, kg, t, godz. — lista jednostek jest w programie wspólna (lib/domain.ts UNITS),
--    więc rozszerzamy ją we wszystkich tabelach, które jej używają. Inaczej wybranie „m³”
--    w robotach dodatkowych czy na fakturze kończyłoby się błędem zapisu.

alter table public.offer_lines drop constraint if exists offer_lines_section_check;
alter table public.offer_lines
  add constraint offer_lines_section_check check (section in ('labor', 'material', 'mixed'));

alter table public.estimate_template_lines drop constraint if exists estimate_template_lines_section_check;
alter table public.estimate_template_lines
  add constraint estimate_template_lines_section_check check (section in ('labor', 'material', 'mixed'));

do $$
declare
  units constant text := $u$('m²', 'mb', 'm³', 'szt.', 'kpl.', 'kg', 't', 'roboczogodz.', 'godz.', 'usługa')$u$;
begin
  alter table public.offer_lines drop constraint if exists offer_lines_unit_check;
  execute format('alter table public.offer_lines add constraint offer_lines_unit_check check (unit in %s)', units);

  alter table public.estimate_template_lines drop constraint if exists estimate_template_lines_unit_check;
  execute format('alter table public.estimate_template_lines add constraint estimate_template_lines_unit_check check (unit in %s)', units);

  alter table public.catalog_items drop constraint if exists catalog_items_default_unit_check;
  execute format('alter table public.catalog_items add constraint catalog_items_default_unit_check check (default_unit in %s)', units);

  alter table public.extra_works drop constraint if exists extra_works_unit_check;
  execute format('alter table public.extra_works add constraint extra_works_unit_check check (unit in %s)', units);

  alter table public.invoice_lines drop constraint if exists invoice_lines_unit_check;
  execute format('alter table public.invoice_lines add constraint invoice_lines_unit_check check (unit in %s)', units);

  alter table public.piecework_activities drop constraint if exists piecework_activities_unit_check;
  execute format('alter table public.piecework_activities add constraint piecework_activities_unit_check check (unit in %s)', units);

  alter table public.case_subcontractors drop constraint if exists case_subcontractors_unit_check;
  execute format('alter table public.case_subcontractors add constraint case_subcontractors_unit_check check (unit is null or unit in %s)', units);
end;
$$;

notify pgrst, 'reload schema';
