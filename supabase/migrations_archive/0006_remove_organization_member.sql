-- Owner może usunąć członka z organizacji (bez usuwania konta w Auth — tylko dostęp do firmy).
create or replace function public.remove_organization_member(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_org uuid;
  owner_cnt int;
begin
  select organization_id into my_org
  from public.organization_members
  where user_id = auth.uid() and role = 'owner'
  order by organization_id asc
  limit 1;

  if my_org is null then
    raise exception 'Tylko właściciel może usuwać członków zespołu';
  end if;

  if target_user = auth.uid() then
    raise exception 'Nie możesz usunąć siebie z listy. Poproś innego właściciela lub skontaktuj się z administratorem.';
  end if;

  if not exists (
    select 1 from public.organization_members
    where organization_id = my_org and user_id = target_user
  ) then
    raise exception 'Ten użytkownik nie należy do Twojej organizacji';
  end if;

  select count(*)::int into owner_cnt
  from public.organization_members
  where organization_id = my_org and role = 'owner';

  if exists (
    select 1 from public.organization_members
    where organization_id = my_org and user_id = target_user and role = 'owner'
  ) and owner_cnt <= 1 then
    raise exception 'W firmie musi zostać co najmniej jeden właściciel';
  end if;

  delete from public.digest_email_prefs
  where organization_id = my_org and user_id = target_user;

  delete from public.organization_members
  where organization_id = my_org and user_id = target_user;
end;
$$;

revoke all on function public.remove_organization_member(uuid) from public;
grant execute on function public.remove_organization_member(uuid) to authenticated;
