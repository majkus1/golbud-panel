-- Faza 9: role brygadzista/podwykonawca + ograniczenie dostępu (RLS) per rola.
--
-- Zasady widoczności:
--   • owner / office / manager — pełny wgląd we wszystkie sprawy, płatności, faktury.
--   • sales / brygadzista / podwykonawca / member — tylko sprawy, które utworzyli
--     lub do których są przypisani (case_assignees); brak dostępu do płatności i faktur.
--
-- Idempotentna. Uruchom JEDEN RAZ w Supabase SQL Editor.

-- 1) Rozszerzenie dozwolonych ról
alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members
  add constraint organization_members_role_check
  check (role in ('owner', 'office', 'sales', 'manager', 'brygadzista', 'podwykonawca', 'member'));

-- 2) Helper: czy bieżący user ma pełny wgląd w organizację
create or replace function public.can_see_all_cases(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.my_role_in(target_org) in ('owner', 'office', 'manager');
$$;

revoke all on function public.can_see_all_cases(uuid) from public;
grant execute on function public.can_see_all_cases(uuid) to authenticated;

-- 3) Sprawy — rozbicie cases_all na polityki per operacja
drop policy if exists cases_all on public.cases;
drop policy if exists cases_select on public.cases;
drop policy if exists cases_insert on public.cases;
drop policy if exists cases_update on public.cases;
drop policy if exists cases_delete on public.cases;

create policy cases_select on public.cases
for select using (
  public.is_member_of(organization_id)
  and (
    public.can_see_all_cases(organization_id)
    or created_by = auth.uid()
    or public.is_case_assignee(id)
  )
);

create policy cases_insert on public.cases
for insert with check (
  public.is_member_of(organization_id)
  and public.my_role_in(organization_id) in ('owner', 'office', 'manager', 'sales')
);

create policy cases_update on public.cases
for update using (
  public.is_member_of(organization_id)
  and (
    public.can_see_all_cases(organization_id)
    or created_by = auth.uid()
    or public.is_case_assignee(id)
  )
)
with check (
  public.is_member_of(organization_id)
);

create policy cases_delete on public.cases
for delete using (
  public.is_member_of(organization_id)
  and public.my_role_in(organization_id) in ('owner', 'office', 'manager')
);

-- 4) Płatności — tylko role zarządcze
drop policy if exists payments_all on public.payments;
drop policy if exists payments_manage on public.payments;
create policy payments_manage on public.payments
for all using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

-- 5) Faktury — tylko role zarządcze
drop policy if exists invoices_all on public.invoices;
drop policy if exists invoices_manage on public.invoices;
create policy invoices_manage on public.invoices
for all using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

-- 6) Pozycje faktur — zgodnie z dostępem do faktury (jeśli tabela istnieje)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'invoice_lines') then
    execute 'drop policy if exists invoice_lines_all on public.invoice_lines';
    execute 'drop policy if exists invoice_lines_manage on public.invoice_lines';
    execute $p$
      create policy invoice_lines_manage on public.invoice_lines
      for all using (
        exists (
          select 1 from public.invoices i
          where i.id = invoice_lines.invoice_id
            and public.is_member_of(i.organization_id)
            and public.can_see_all_cases(i.organization_id)
        )
      )
      with check (
        exists (
          select 1 from public.invoices i
          where i.id = invoice_lines.invoice_id
            and public.is_member_of(i.organization_id)
            and public.can_see_all_cases(i.organization_id)
        )
      )
    $p$;
  end if;
end$$;
