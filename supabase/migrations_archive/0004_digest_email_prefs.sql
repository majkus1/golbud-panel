-- Preferencje dziennego digestu e-mail (owner ustawia per użytkownik).
create table if not exists public.digest_email_prefs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  digest_enabled boolean not null default false,
  include_reminders boolean not null default true,
  include_overdue_contact boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists digest_email_prefs_org_enabled_idx
  on public.digest_email_prefs (organization_id)
  where digest_enabled = true;

drop trigger if exists set_digest_email_prefs_updated_at on public.digest_email_prefs;
create trigger set_digest_email_prefs_updated_at
before update on public.digest_email_prefs
for each row execute function public.set_updated_at();

alter table public.digest_email_prefs enable row level security;

-- Tylko właściciel organizacji czyta i zapisuje (prosto: cała tabela per org przez ownera).
drop policy if exists digest_email_prefs_owner_all on public.digest_email_prefs;
create policy digest_email_prefs_owner_all on public.digest_email_prefs
for all using (public.is_owner_of(organization_id))
with check (public.is_owner_of(organization_id));

grant select, insert, update, delete on public.digest_email_prefs to authenticated;
