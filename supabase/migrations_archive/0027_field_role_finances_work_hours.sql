-- Ograniczenia dla ról terenowych (pracownik, brygadzista, podwykonawca):
-- brak wycen/ofert w bazie; wpisy godzin tylko brygadzista + zarząd.

create or replace function public.can_see_case_commercial(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.my_role_in(target_org) in ('owner', 'office', 'manager', 'sales');
$$;

revoke all on function public.can_see_case_commercial(uuid) from public;
grant execute on function public.can_see_case_commercial(uuid) to authenticated;

create or replace function public.can_edit_work_hours(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.my_role_in(target_org) in ('owner', 'office', 'manager', 'brygadzista');
$$;

revoke all on function public.can_edit_work_hours(uuid) from public;
grant execute on function public.can_edit_work_hours(uuid) to authenticated;

-- Oferta / kosztorys — tylko biuro, kierownik, handlowiec
drop policy if exists offer_variants_all on public.offer_variants;
drop policy if exists offer_variants_select on public.offer_variants;
drop policy if exists offer_variants_manage on public.offer_variants;
create policy offer_variants_select on public.offer_variants
for select using (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
);
create policy offer_variants_manage on public.offer_variants
for all using (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
)
with check (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
);

drop policy if exists offer_lines_all on public.offer_lines;
drop policy if exists offer_lines_select on public.offer_lines;
drop policy if exists offer_lines_manage on public.offer_lines;
create policy offer_lines_select on public.offer_lines
for select using (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
);
create policy offer_lines_manage on public.offer_lines
for all using (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
)
with check (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
);

-- Prace dodatkowe z kwotami — jak finanse sprawy
drop policy if exists extra_works_all on public.extra_works;
drop policy if exists extra_works_select on public.extra_works;
drop policy if exists extra_works_manage on public.extra_works;
create policy extra_works_select on public.extra_works
for select using (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
);
create policy extra_works_manage on public.extra_works
for all using (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
)
with check (
  public.is_member_of(organization_id) and public.can_see_case_commercial(organization_id)
);

-- Godziny — odczyt dla członków org, zapis tylko brygadzista + zarząd
drop policy if exists work_hours_all on public.work_hours;
drop policy if exists work_hours_select on public.work_hours;
drop policy if exists work_hours_write on public.work_hours;
create policy work_hours_select on public.work_hours
for select using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);
create policy work_hours_write on public.work_hours
for all using (
  public.can_edit_work_hours(organization_id)
)
with check (
  public.can_edit_work_hours(organization_id)
);
