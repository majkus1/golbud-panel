-- Identyfikatory spraw w koszu — do odfiltrowania wierszy podrzędnych (zadania, płatności,
-- przypomnienia, faktury) w widokach całej firmy: pulpit, kalendarz, zadania, raporty.
--
-- Filtrowanie „tylko sprawy, które widzę” ukryłoby brygadziście zadania przypisane mu
-- w sprawach, których sam nie widzi. Dlatego odwrotnie: funkcja zwraca same identyfikatory
-- spraw z kosza (bez danych klienta) każdemu członkowi firmy, a program pomija ich wiersze.

create or replace function public.trashed_case_ids(p_organization_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id
    from public.cases c
   where c.organization_id = p_organization_id
     and c.deleted_at is not null
     and public.is_member_of(p_organization_id);
$function$;

revoke all on function public.trashed_case_ids(uuid) from public, anon;
grant execute on function public.trashed_case_ids(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
