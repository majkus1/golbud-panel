-- Edycja protokołów odbioru.
--
-- Do tej pory protokół można było dodać i usunąć, ale nie poprawić — brakowało polityki
-- UPDATE, więc każda literówka w opisie wymagała skasowania wpisu i utworzenia go od nowa.
--
-- Uprawnienia identyczne jak przy usuwaniu (migracja 0033): autor wpisu albo rola
-- zarządcza w organizacji. Zmiana przypisania do innej sprawy lub organizacji pozostaje
-- zablokowana — protokół ma zostać tam, gdzie powstał.

drop policy if exists protocols_update on public.case_protocols;
create policy protocols_update on public.case_protocols
for update to authenticated
using (
  public.is_case_owner_or_manager(case_id)
  or created_by = auth.uid()
)
with check (
  public.can_access_case_in_org(case_id, organization_id)
  and (
    public.is_case_owner_or_manager(case_id)
    or created_by = auth.uid()
  )
);

create or replace function public.protect_case_protocol_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.case_id is distinct from OLD.case_id
     or NEW.organization_id is distinct from OLD.organization_id
     or NEW.created_by is distinct from OLD.created_by then
    raise exception 'Nie można przenieść protokołu do innej sprawy ani zmienić jego autora';
  end if;
  return NEW;
end;
$$;

drop trigger if exists protect_case_protocol_columns on public.case_protocols;
create trigger protect_case_protocol_columns
before update on public.case_protocols
for each row execute function public.protect_case_protocol_columns();

select '20260810191823_case_protocols_update: OK' as migration_status;
