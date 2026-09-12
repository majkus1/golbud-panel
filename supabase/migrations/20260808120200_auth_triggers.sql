-- Triggery na `auth.users`, odtworzone ze stanu produkcyjnego.
--
-- `supabase db dump` pomija schemat `auth` (tak samo jak `storage`), więc same funkcje
-- przyjeżdżają razem ze schematem `public`, ale podpięcie ich do tabeli użytkowników już nie.
-- Bez tej migracji lokalnie:
--   • rejestracja nie tworzy organizacji ani członkostwa (`handle_new_user`),
--   • adres e-mail nie trafia do katalogu `user_directory_profiles`,
-- czyli logowanie działa, ale nowy użytkownik trafia na „Brak przypisanej organizacji".
--
-- Migracja jest idempotentna — na produkcji, gdzie triggery już istnieją, nic nie zmienia.
-- Źródło: `supabase/schema.sql` oraz migracja 0048 w `supabase/migrations_archive/`.

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists sync_user_directory_profile on auth.users;
create trigger sync_user_directory_profile
after insert or update of email on auth.users
for each row execute function public.sync_user_directory_profile();

select '20260808120200_auth_triggers: OK' as migration_status;
