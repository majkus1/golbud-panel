-- Skrzynki pocztowe użytkowników — podstawa historii korespondencji przy zleceniu.
--
-- Hasło aplikacji Google trzymamy w Supabase Vault, a w tabeli wyłącznie identyfikator
-- sekretu. Kolumna `secret_id` nie jest udostępniona roli `authenticated`, a odszyfrowanie
-- przechodzi przez funkcję dostępną tylko dla `service_role`. Dzięki temu nawet pełny
-- odczyt tabeli przez API nie ujawnia hasła.
--
-- Wzorzec „prywatne dane + RPC z walidacją roli" jest ten sam co przy wynagrodzeniach
-- (`save_employee_compensation`, migracja 0059).

create table if not exists public.user_mail_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email_address text not null,
  provider text not null default 'gmail' check (provider in ('gmail', 'imap')),
  imap_host text not null default 'imap.gmail.com',
  imap_port integer not null default 993 check (imap_port between 1 and 65535),
  smtp_host text not null default 'smtp.gmail.com',
  smtp_port integer not null default 465 check (smtp_port between 1 and 65535),
  secret_id uuid not null,
  status text not null default 'unverified' check (status in ('unverified', 'ok', 'error')),
  last_error text,
  last_checked_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists user_mail_accounts_org_idx on public.user_mail_accounts(organization_id);

drop trigger if exists set_user_mail_accounts_updated_at on public.user_mail_accounts;
create trigger set_user_mail_accounts_updated_at
before update on public.user_mail_accounts
for each row execute function public.set_updated_at();

alter table public.user_mail_accounts enable row level security;

-- Odczyt: własna skrzynka albo rola zarządcza w tej organizacji. Właściciel musi widzieć,
-- czy pracownik ma skonfigurowaną pocztę, żeby wiedzieć, dlaczego historia jest pusta.
drop policy if exists user_mail_accounts_select on public.user_mail_accounts;
create policy user_mail_accounts_select on public.user_mail_accounts
for select to authenticated
using (
  public.is_member_of(organization_id)
  and (user_id = auth.uid() or public.can_see_all_cases(organization_id))
);

-- Brak polityk zapisu: wstawianie, zmiana i usuwanie wyłącznie przez RPC poniżej.
revoke all on public.user_mail_accounts from anon, authenticated;
grant select (
  id, organization_id, user_id, email_address, provider,
  imap_host, imap_port, smtp_host, smtp_port,
  status, last_error, last_checked_at, active, created_at, updated_at
) on public.user_mail_accounts to authenticated;

comment on column public.user_mail_accounts.secret_id is
  'Identyfikator hasła aplikacji w vault.secrets. Kolumna celowo bez grantu dla authenticated.';

-- ── Zapis skrzynki ───────────────────────────────────────────────────────────
-- Użytkownik konfiguruje wyłącznie własną skrzynkę. Hasło trafia prosto do Vaulta.

create or replace function public.save_user_mail_account(
  target_org uuid,
  target_email text,
  target_app_password text,
  target_provider text default 'gmail',
  target_imap_host text default 'imap.gmail.com',
  target_imap_port integer default 993,
  target_smtp_host text default 'smtp.gmail.com',
  target_smtp_port integer default 465
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.user_mail_accounts%rowtype;
  clean_email text := lower(btrim(target_email));
  -- Gmail pozwala wpisywać hasło aplikacji ze spacjami — usuwamy je raz, tutaj.
  clean_password text := replace(coalesce(target_app_password, ''), ' ', '');
  secret_name text;
  orphan_secret_id uuid;
  new_secret_id uuid;
  result_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Brak sesji';
  end if;
  if not public.is_member_of(target_org) then
    raise exception 'Brak dostepu do organizacji';
  end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Nieprawidlowy adres e-mail';
  end if;
  if length(clean_password) < 8 then
    raise exception 'Haslo aplikacji jest za krotkie';
  end if;
  if target_provider not in ('gmail', 'imap') then
    raise exception 'Nieobslugiwany dostawca poczty';
  end if;

  select * into existing
  from public.user_mail_accounts
  where organization_id = target_org and user_id = auth.uid();

  if existing.id is null then
    secret_name := 'mail:' || target_org::text || ':' || auth.uid()::text;

    -- Sekret o tej nazwie może zostać po skasowanym koncie (np. kaskada z auth.users).
    -- Bez tego ponowne dodanie skrzynki wywalałoby się na unikalnej nazwie w Vault.
    select id into orphan_secret_id from vault.secrets where name = secret_name;
    if orphan_secret_id is not null then
      perform vault.update_secret(orphan_secret_id, clean_password);
      new_secret_id := orphan_secret_id;
    else
      new_secret_id := vault.create_secret(
        clean_password,
        secret_name,
        'Haslo aplikacji poczty uzytkownika panelu'
      );
    end if;

    insert into public.user_mail_accounts (
      organization_id, user_id, email_address, provider,
      imap_host, imap_port, smtp_host, smtp_port, secret_id, status
    ) values (
      target_org, auth.uid(), clean_email, target_provider,
      target_imap_host, target_imap_port, target_smtp_host, target_smtp_port,
      new_secret_id, 'unverified'
    )
    returning id into result_id;
  else
    perform vault.update_secret(existing.secret_id, clean_password);
    update public.user_mail_accounts set
      email_address = clean_email,
      provider = target_provider,
      imap_host = target_imap_host,
      imap_port = target_imap_port,
      smtp_host = target_smtp_host,
      smtp_port = target_smtp_port,
      status = 'unverified',
      last_error = null,
      active = true
    where id = existing.id
    returning id into result_id;
  end if;

  return result_id;
end;
$$;

revoke all on function public.save_user_mail_account(uuid, text, text, text, text, integer, text, integer) from public, anon;
grant execute on function public.save_user_mail_account(uuid, text, text, text, text, integer, text, integer) to authenticated;

-- ── Usunięcie skrzynki ───────────────────────────────────────────────────────

create or replace function public.delete_user_mail_account(target_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.user_mail_accounts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Brak sesji';
  end if;

  select * into existing
  from public.user_mail_accounts
  where organization_id = target_org and user_id = auth.uid();

  if existing.id is null then
    return;
  end if;

  -- Sekret kasuje trigger `drop_user_mail_secret` — jedno miejsce, także dla kaskad.
  delete from public.user_mail_accounts where id = existing.id;
end;
$$;

revoke all on function public.delete_user_mail_account(uuid) from public, anon;
grant execute on function public.delete_user_mail_account(uuid) to authenticated;

-- ── Sprzątanie sekretu przy usunięciu wiersza ────────────────────────────────
-- Konto może zniknąć kaskadą (usunięty użytkownik albo organizacja) z pominięciem
-- funkcji `delete_user_mail_account`. Trigger pilnuje, żeby hasło nie zostawało w Vault.

create or replace function public.trg_drop_user_mail_secret()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from vault.secrets where id = OLD.secret_id;
  return OLD;
end;
$$;

drop trigger if exists drop_user_mail_secret on public.user_mail_accounts;
create trigger drop_user_mail_secret
after delete on public.user_mail_accounts
for each row execute function public.trg_drop_user_mail_secret();

-- ── Odczyt hasła (tylko serwer) ──────────────────────────────────────────────
-- Wywoływane wyłącznie przez trasy API kluczem service role, po wcześniejszym
-- sprawdzeniu dostępu użytkownika do sprawy. Rola `authenticated` nie ma tu wstępu.

create or replace function public.get_user_mail_secret(target_account uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select secret.decrypted_secret
  from public.user_mail_accounts account
  join vault.decrypted_secrets secret on secret.id = account.secret_id
  where account.id = target_account and account.active;
$$;

revoke all on function public.get_user_mail_secret(uuid) from public, anon, authenticated;
grant execute on function public.get_user_mail_secret(uuid) to service_role;

select '20260808220007_user_mail_accounts: OK' as migration_status;
