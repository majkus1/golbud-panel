-- Włączenie push nie może wyłączać maili.
--
-- `set_own_push_enabled` zakładała wiersz ustawień, wypełniając tylko `push_enabled`
-- i `digest_enabled`. Reszta kolumn brała wartości domyślne z tabeli — a tam
-- `notify_new_case` ma `false`. Aplikacja zakłada co innego: dla właściciela, biura,
-- managera i handlowca to powiadomienie jest domyślnie włączone (lib/notification-prefs.ts),
-- ale ta domyślna wartość obowiązuje tylko wtedy, gdy wiersza nie ma wcale.
--
-- Skutek: kto włączył push na telefonie, ten sobie po cichu wyłączył maile o nowych
-- zapytaniach. Tak stało się u trzech osób w GolBudzie.
--
-- Poprawka: przy zakładaniu wiersza wpisujemy wartości właściwe dla roli — te same,
-- które aplikacja pokazuje jako domyślne w panelu. Istniejących wierszy NIE ruszamy:
-- to ustawienia użytkowników i nie mamy pewności, czy ktoś nie zmienił ich świadomie.

create or replace function public.set_own_push_enabled(p_organization_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  member_role text;
  is_management boolean;
  is_sales boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select role into member_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = auth.uid();

  if member_role is null then
    raise exception 'not a member';
  end if;

  -- Lustrzane odbicie defaultNotificationPrefsForRole z lib/notification-prefs.ts.
  -- Jeśli zmieniasz jedno, zmień drugie.
  is_management := member_role in ('owner', 'office', 'manager');
  is_sales := member_role = 'sales';

  insert into public.digest_email_prefs (
    organization_id, user_id, push_enabled, digest_enabled,
    notify_new_case, notify_task_comment, notify_financial_alerts,
    include_reminders, include_overdue_contact, include_schedule, include_payments,
    include_tasks, include_fleet, include_warehouse, include_profitability_alerts,
    include_cost_invoices, include_employee_compliance, include_settlements, include_stale_cases
  )
  values (
    p_organization_id, auth.uid(), p_enabled, false,
    is_management or is_sales,          -- notify_new_case
    true,                                -- notify_task_comment
    is_management,                       -- notify_financial_alerts
    is_management or is_sales,          -- include_reminders
    is_management or is_sales,          -- include_overdue_contact
    not is_sales,                        -- include_schedule (zarząd i teren: tak, handlowiec: nie)
    is_management,                       -- include_payments
    true,                                -- include_tasks
    is_management,                       -- include_fleet
    is_management,                       -- include_warehouse
    is_management,                       -- include_profitability_alerts
    is_management,                       -- include_cost_invoices
    is_management,                       -- include_employee_compliance
    is_management,                       -- include_settlements
    not is_sales                         -- include_stale_cases
  )
  on conflict (organization_id, user_id)
  do update set push_enabled = p_enabled, updated_at = now();
end;
$$;

comment on function public.set_own_push_enabled(uuid, boolean) is
  'Użytkownik włącza/wyłącza push na swoim koncie. Nowy wiersz ustawień dostaje wartości domyślne dla roli, nie surowe domyślne tabeli.';

select '20260913120000_push_prefs_role_defaults: OK' as migration_status;
