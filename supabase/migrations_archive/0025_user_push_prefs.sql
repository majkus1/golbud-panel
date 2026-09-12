-- Każdy użytkownik sam włącza/wyłącza push (PWA / przeglądarka).
-- Owner nadal zarządza mailami; push_enabled ustawia wyłącznie właściciel konta.

create or replace function public.set_own_push_enabled(p_organization_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = auth.uid()
  ) then
    raise exception 'not a member';
  end if;

  insert into public.digest_email_prefs (organization_id, user_id, push_enabled, digest_enabled)
  values (p_organization_id, auth.uid(), p_enabled, false)
  on conflict (organization_id, user_id)
  do update set push_enabled = p_enabled, updated_at = now();
end;
$$;

grant execute on function public.set_own_push_enabled(uuid, boolean) to authenticated;

comment on function public.set_own_push_enabled is 'Użytkownik włącza/wyłącza push na swoim koncie (niezależnie od roli)';

drop policy if exists digest_email_prefs_self_read on public.digest_email_prefs;
create policy digest_email_prefs_self_read on public.digest_email_prefs
for select using (user_id = auth.uid());

comment on column public.digest_email_prefs.push_enabled is 'Push PWA/przeglądarka — ustawia sam użytkownik (Powiadomienia lub dzwoneczek)';
