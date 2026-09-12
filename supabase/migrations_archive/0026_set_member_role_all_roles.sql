-- Naprawa: set_member_role odrzucało role z migracji 0020 (brygadzista, podwykonawca) → HTTP 400 w panelu Zespół.

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
  owner_cnt int;
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

  if target_role not in (
    'owner', 'office', 'sales', 'manager', 'brygadzista', 'podwykonawca', 'member'
  ) then
    raise exception 'Nieprawidłowa rola: %', target_role;
  end if;

  select id into target_user from auth.users where lower(email) = lower(target_email);

  if target_user is null then
    raise exception 'Nie znaleziono użytkownika o e-mailu %', target_email;
  end if;

  if exists (
    select 1 from public.organization_members
    where organization_id = my_org and user_id = target_user and role = 'owner'
  ) and target_role <> 'owner' then
    select count(*)::int into owner_cnt
    from public.organization_members
    where organization_id = my_org and role = 'owner';

    if owner_cnt <= 1 then
      raise exception 'W firmie musi zostać co najmniej jeden właściciel';
    end if;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (my_org, target_user, target_role)
  on conflict (organization_id, user_id) do update
    set role = excluded.role;
end;
$$;

revoke all on function public.set_member_role(text, text) from public;
grant execute on function public.set_member_role(text, text) to authenticated;
