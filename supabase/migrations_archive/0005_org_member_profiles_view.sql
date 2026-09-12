-- Naprawa: 403 na widoku org_member_profiles (join do auth.users przy security_invoker=true).
-- Naprawa: set_member_role brało losową organizację przy wielu członkostwach (LIMIT 1).

-- 1) Widok: wykonanie z prawami właściciela widoku + filtr „tylko moje organizacje” (auth.uid() w is_member_of).
drop view if exists public.org_member_profiles;
create view public.org_member_profiles
with (security_invoker = false) as
select
  m.organization_id,
  m.user_id,
  m.role,
  u.email::text as email
from public.organization_members m
join auth.users u on u.id = m.user_id
where public.is_member_of(m.organization_id);

grant select on public.org_member_profiles to authenticated;

-- 2) RPC: wybierz organizację właściciela (stabilnie), nie pierwszy losowy wiersz.
create or replace function public.set_member_role(target_email text, target_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_org uuid;
  my_role text;
  target_user uuid;
begin
  select organization_id, role into my_org, my_role
  from public.organization_members
  where user_id = auth.uid() and role = 'owner'
  order by organization_id asc
  limit 1;

  if my_org is null then
    select organization_id, role into my_org, my_role
    from public.organization_members
    where user_id = auth.uid()
    order by organization_id asc
    limit 1;
  end if;

  if my_org is null then
    raise exception 'Brak organizacji dla użytkownika';
  end if;

  if my_role <> 'owner' then
    raise exception 'Tylko właściciel może zmieniać role';
  end if;

  if target_role not in ('owner', 'office', 'sales', 'manager', 'member') then
    raise exception 'Nieprawidłowa rola: %', target_role;
  end if;

  select id into target_user from auth.users where email = target_email;

  if target_user is null then
    raise exception 'Nie znaleziono użytkownika o e-mailu %', target_email;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (my_org, target_user, target_role)
  on conflict (organization_id, user_id) do update
    set role = excluded.role;
end;
$$;

revoke all on function public.set_member_role(text, text) from public;
grant execute on function public.set_member_role(text, text) to authenticated;

-- Cron (GET /api/cron/reminder-digest) używa Supabase Auth Admin (service role) do e-maili użytkowników,
-- nie tego widoku — widok jest dla panelu (sesja użytkownika).
