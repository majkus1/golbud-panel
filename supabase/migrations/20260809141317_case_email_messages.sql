-- Zapisana historia korespondencji przy zleceniu.
--
-- Do tej pory wiadomości pobierały się w locie i znikały po odświeżeniu strony.
-- Teraz synchronizacja dopisuje do bazy wyłącznie NOWE wiadomości, a widok czyta z bazy.
--
-- Zasady dostępu (te same co w module korespondencji):
--   • wiersz należy do WŁAŚCICIELA SKRZYNKI (`user_id`) — nikt nie czyta cudzej poczty,
--     także właściciel firmy; to samo rozstrzygnięcie co w `resolve_mailbox_for_case`,
--   • dodatkowo trzeba mieć dostęp do samego zlecenia,
--   • zapis wyłącznie kluczem serwerowym — rola `authenticated` może tylko czytać
--     i kasować własne wiersze.

create table if not exists public.case_email_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  -- Właściciel skrzynki, z której pochodzi wiadomość.
  user_id uuid not null references auth.users(id) on delete cascade,
  mailbox_address text not null,

  -- Nagłówek Message-ID; bywa pusty przy nietypowych serwerach, stąd osobny klucz deduplikacji.
  message_id text,
  /** Klucz deduplikacji: Message-ID albo zastępczo UID. Chroni przed dublami przy ponownej synchronizacji. */
  dedupe_key text not null,
  /** UID w skrzynce — potrzebny do pobrania załącznika na żądanie. */
  mailbox_uid integer not null,

  thread_key text not null,
  thread_subject text not null default '',
  subject text not null default '',
  direction text not null check (direction in ('incoming', 'outgoing')),

  from_name text,
  from_address text,
  to_addresses jsonb not null default '[]'::jsonb,
  cc_addresses jsonb not null default '[]'::jsonb,

  sent_at timestamptz not null,
  body_text text not null default '',
  /** HTML jest zapisywany już po oczyszczeniu na serwerze — surowy nie trafia do bazy. */
  body_html text,
  attachments jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),

  unique (user_id, case_id, dedupe_key)
);

create index if not exists case_email_messages_case_user_idx
  on public.case_email_messages (case_id, user_id, sent_at desc);
create index if not exists case_email_messages_thread_idx
  on public.case_email_messages (case_id, user_id, thread_key);

alter table public.case_email_messages enable row level security;

drop policy if exists case_email_messages_select on public.case_email_messages;
create policy case_email_messages_select on public.case_email_messages
for select to authenticated
using (
  user_id = auth.uid()
  and public.can_access_case_in_org(case_id, organization_id)
);

-- Możliwość wyczyszczenia własnej historii przy zleceniu.
drop policy if exists case_email_messages_delete on public.case_email_messages;
create policy case_email_messages_delete on public.case_email_messages
for delete to authenticated
using (
  user_id = auth.uid()
  and public.can_access_case_in_org(case_id, organization_id)
);

-- Zapis wyłącznie kluczem serwerowym, po sprawdzeniu uprawnień w trasie API.
revoke all on public.case_email_messages from anon, authenticated;
grant select, delete on public.case_email_messages to authenticated;

comment on table public.case_email_messages is
  'Zapisana korespondencja e-mail przy zleceniu. Wiersz należy do właściciela skrzynki; '
  'nie jest źródłem danych dla Asystenta AI.';

select '20260809141317_case_email_messages: OK' as migration_status;
