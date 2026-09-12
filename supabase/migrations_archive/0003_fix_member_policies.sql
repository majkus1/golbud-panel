-- Fix: "infinite recursion detected in policy for relation organization_members"
--
-- Polityki RLS na public.organization_members nie mogą same odpytywać tej samej
-- tabeli, bo PostgreSQL wykonuje ich USING/CHECK rekurencyjnie. Rozwiązanie:
-- użyć funkcji SECURITY DEFINER, które omijają RLS i zwracają proste boolean-y.
--
-- Uruchom JEDEN RAZ w Supabase SQL Editor. Bezpieczne, idempotentne.

-- 1) Helpery SECURITY DEFINER
create or replace function public.is_member_of(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where user_id = auth.uid() and organization_id = target_org
  );
$$;

create or replace function public.is_owner_of(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where user_id = auth.uid()
      and organization_id = target_org
      and role = 'owner'
  );
$$;

revoke all on function public.is_member_of(uuid) from public;
revoke all on function public.is_owner_of(uuid) from public;
grant execute on function public.is_member_of(uuid) to authenticated;
grant execute on function public.is_owner_of(uuid) to authenticated;

-- 2) Polityki na organization_members — bez rekurencji
drop policy if exists org_members_select on public.organization_members;
drop policy if exists org_members_select_team on public.organization_members;
drop policy if exists org_members_update on public.organization_members;

create policy org_members_select on public.organization_members
for select using (
  user_id = auth.uid() or public.is_member_of(organization_id)
);

create policy org_members_update on public.organization_members
for update using (public.is_owner_of(organization_id))
with check (public.is_owner_of(organization_id));

-- 3) Widok org_member_profiles: niech będzie pewne, że istnieje w czystej formie
drop view if exists public.org_member_profiles;
create view public.org_member_profiles
with (security_invoker = true) as
select m.organization_id, m.user_id, m.role, u.email::text as email
from public.organization_members m
join auth.users u on u.id = m.user_id;

grant select on public.org_member_profiles to authenticated;
