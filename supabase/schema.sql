-- GolBud Panel — Etap 1 (organizacja, sprawy, kosztorys, harmonogram, płatności, przypomnienia, prace dodatkowe, protokoły, załączniki)
-- Uruchom w Supabase SQL Editor (nowy projekt lub pełna przebudowa). Usuwa stare tabele demo `leads` / `notes`.

create extension if not exists "pgcrypto";

-- --- Czyszczenie starego demo (opcjonalnie zakomentuj, jeśli migrujesz ręcznie) ---
drop table if exists public.notes cascade;
drop table if exists public.leads cascade;

-- --- Pomocnicze ---
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --- Organizacja (skalowalne pod role i multi-user) ---
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'GolBud',
  offer_legal_name text,
  offer_nip text,
  offer_address_line text,
  offer_postal_city text,
  offer_phone text,
  offer_email text,
  offer_website text,
  offer_bank_account text,
  offer_bank_name text,
  offer_payment_terms text,
  offer_default_vat_rate numeric default 8
    check (offer_default_vat_rate is null or (offer_default_vat_rate >= 0 and offer_default_vat_rate <= 100)),
  offer_validity_days integer default 30
    check (offer_validity_days is null or (offer_validity_days > 0 and offer_validity_days <= 365)),
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists organization_members_user_idx on public.organization_members(user_id);

-- --- Ekipy / brygady ---
create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists crews_org_idx on public.crews(organization_id);

-- --- Sprawy (karta klienta / budowy) ---
create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  crew_id uuid references public.crews(id) on delete set null,
  client_name text not null,
  phone text,
  email text,
  location text,
  work_description text not null default '',
  status text not null default 'nowe zapytanie' check (
    status in (
      'nowe zapytanie',
      'do kontaktu',
      'wysłano pytania',
      'oczekujemy na zdjęcia/projekt',
      'do wyceny',
      'wycena wysłana',
      'do decyzji klienta',
      'umowa do podpisu',
      'zaliczka do wpłaty',
      'termin zarezerwowany',
      'realizacja',
      'odbiór',
      'rozliczone',
      'utracone'
    )
  ),
  source text not null default 'telefon' check (
    source in ('Google Ads', 'strona', 'polecenie', 'OLX', 'telefon', 'mail', 'WhatsApp', 'SMS')
  ),
  estimated_value numeric,
  next_contact_date date,
  realization_end_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cases_org_idx on public.cases(organization_id);
create index if not exists cases_org_status_idx on public.cases(organization_id, status);
create index if not exists cases_org_next_contact_idx on public.cases(organization_id, next_contact_date);

drop trigger if exists set_cases_updated_at on public.cases;
create trigger set_cases_updated_at
before update on public.cases
for each row execute function public.set_updated_at();

-- --- Notatki / historia wpisów ---
create table if not exists public.case_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists case_notes_case_idx on public.case_notes(case_id);

-- --- Baza pozycji kosztorysowych (gotowce) ---
create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  default_unit text not null default 'm²' check (default_unit in ('m²', 'mb', 'szt.', 'kpl.', 'roboczogodz.', 'usługa')),
  category text not null default 'material' check (category in ('material', 'labor')),
  suggested_rate numeric,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists catalog_items_org_idx on public.catalog_items(organization_id);

-- --- Warianty oferty ---
create table if not exists public.offer_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  name text not null,
  scope_notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists offer_variants_case_idx on public.offer_variants(case_id);

-- --- Pozycje kosztorysu w wariancie ---
create table if not exists public.offer_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant_id uuid not null references public.offer_variants(id) on delete cascade,
  section text not null check (section in ('labor', 'material')),
  label text not null,
  unit text not null default 'm²' check (unit in ('m²', 'mb', 'szt.', 'kpl.', 'roboczogodz.', 'usługa')),
  quantity numeric not null default 1 check (quantity >= 0),
  unit_rate numeric not null default 0 check (unit_rate >= 0),
  line_total numeric generated always as (round(quantity * unit_rate, 2)) stored,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists offer_lines_variant_idx on public.offer_lines(variant_id);

-- --- Harmonogram realizacji ---
create table if not exists public.case_schedule_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  title text not null,
  due_date date,
  completed boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists case_schedule_case_idx on public.case_schedule_items(case_id);

-- --- Płatności ---
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  title text not null,
  due_date date,
  amount_due numeric not null default 0 check (amount_due >= 0),
  amount_paid numeric not null default 0 check (amount_paid >= 0),
  paid_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists payments_case_idx on public.payments(case_id);

-- --- Przypomnienia (kontakt z klientem) ---
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  remind_at date not null,
  title text not null,
  note text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reminders_case_idx on public.reminders(case_id);
create index if not exists reminders_org_date_idx on public.reminders(organization_id, remind_at);

-- --- Prace dodatkowe ---
create table if not exists public.extra_works (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  work_date date not null default (now()::date),
  description text not null,
  quantity numeric not null default 1 check (quantity >= 0),
  unit text not null default 'szt.' check (unit in ('m²', 'mb', 'szt.', 'kpl.', 'roboczogodz.', 'usługa')),
  unit_rate numeric not null default 0 check (unit_rate >= 0),
  line_total numeric generated always as (round(quantity * unit_rate, 2)) stored,
  accepted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists extra_works_case_idx on public.extra_works(case_id);

-- --- Protokoły (metadane; PDF generowany w aplikacji) ---
create table if not exists public.case_protocols (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  protocol_type text not null check (
    protocol_type in (
      'po ociepleniu',
      'po siatce',
      'po tynku',
      'odbiór końcowy',
      'prace dodatkowe'
    )
  ),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists case_protocols_case_idx on public.case_protocols(case_id);

-- --- Załączniki (pliki w Storage) ---
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  category text not null default 'w trakcie' check (
    category in (
      'przed pracami',
      'w trakcie',
      'po zakończeniu',
      'usterki',
      'materiały',
      'projekt',
      'inspiracje',
      'kosztorys zewnętrzny',
      'umowa',
      'aneks',
      'protokół',
      'wezwanie do zapłaty',
      'oświadczenie'
    )
  ),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, storage_path)
);

create index if not exists attachments_case_idx on public.attachments(case_id);

-- --- RPC: organizacja + katalog startowy ---
create or replace function public.seed_catalog_for_org(target_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.catalog_items (organization_id, label, default_unit, category, suggested_rate, sort_order)
  values
    (target_org, 'Elewacja EPS 20 cm', 'm²', 'material', null, 10),
    (target_org, 'Wełna mineralna', 'm²', 'material', null, 20),
    (target_org, 'Styropian / docieplenie', 'm²', 'material', null, 30),
    (target_org, 'Klej do styropianu', 'm²', 'material', null, 40),
    (target_org, 'Siatka z włókna szklanego', 'm²', 'material', null, 50),
    (target_org, 'Tynk silikonowy', 'm²', 'material', null, 60),
    (target_org, 'Tynk mozaikowy', 'm²', 'material', null, 70),
    (target_org, 'Cokół mozaika', 'mb', 'material', null, 80),
    (target_org, 'Parapety', 'mb', 'material', null, 90),
    (target_org, 'Obróbki blacharskie', 'mb', 'material', null, 100),
    (target_org, 'Bonie / listwy', 'mb', 'material', null, 110),
    (target_org, 'Hydroizolacja fundamentu', 'm²', 'material', null, 120),
    (target_org, 'Ocieplenie poddasza', 'm²', 'material', null, 130),
    (target_org, 'Rusztowania', 'kpl.', 'material', null, 140),
    (target_org, 'Kontener / utylizacja', 'kpl.', 'material', null, 150),
    (target_org, 'Mycie i malowanie elewacji', 'm²', 'labor', null, 160),
    (target_org, 'Robocizna elewacja — montaż', 'm²', 'labor', null, 170),
    (target_org, 'Robocizna — przygotowanie podłoża', 'm²', 'labor', null, 180);
end;
$$;

create or replace function public.create_org_for_user(target_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  oid uuid;
begin
  select organization_id into oid
  from public.organization_members
  where user_id = target_user
  limit 1;

  if oid is not null then
    return oid;
  end if;

  insert into public.organizations (name)
  values ('GolBud')
  returning id into oid;

  insert into public.organization_members (organization_id, user_id, role)
  values (oid, target_user, 'owner');

  perform public.seed_catalog_for_org(oid);
  return oid;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_org_for_user(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.ensure_user_org()
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.create_org_for_user(auth.uid());
$$;

revoke all on function public.ensure_user_org() from public;
grant execute on function public.ensure_user_org() to authenticated;

revoke all on function public.create_org_for_user(uuid) from public;
revoke all on function public.seed_catalog_for_org(uuid) from public;

-- --- RLS ---
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.crews enable row level security;
alter table public.cases enable row level security;
alter table public.case_notes enable row level security;
alter table public.catalog_items enable row level security;
alter table public.offer_variants enable row level security;
alter table public.offer_lines enable row level security;
alter table public.case_schedule_items enable row level security;
alter table public.payments enable row level security;
alter table public.reminders enable row level security;
alter table public.extra_works enable row level security;
alter table public.case_protocols enable row level security;
alter table public.attachments enable row level security;

-- Członkowie widzą swoją organizację
create policy org_select on public.organizations
for select using (
  id in (select organization_id from public.organization_members where user_id = auth.uid())
);

create policy org_update_owner on public.organizations
for update
using (
  id in (
    select organization_id from public.organization_members
    where user_id = auth.uid() and role = 'owner'
  )
)
with check (
  id in (
    select organization_id from public.organization_members
    where user_id = auth.uid() and role = 'owner'
  )
);

create policy org_members_select on public.organization_members
for select using (user_id = auth.uid());

-- Brak INSERT dla authenticated: członkostwo tworzy tylko trigger / funkcja SECURITY DEFINER (zapobiega samodzielnemu dodaniu się do cudzej organizacji).

-- crews
create policy crews_all on public.crews
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- cases
create policy cases_all on public.cases
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- case_notes: odczyt w organizacji; zapis/edycja tylko autor
drop policy if exists case_notes_all on public.case_notes;
create policy case_notes_select on public.case_notes
for select using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);
create policy case_notes_insert on public.case_notes
for insert with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
  and user_id = auth.uid()
);
create policy case_notes_update on public.case_notes
for update using (user_id = auth.uid())
with check (user_id = auth.uid());
create policy case_notes_delete on public.case_notes
for delete using (user_id = auth.uid());

-- catalog
create policy catalog_all on public.catalog_items
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- offer_variants
create policy offer_variants_all on public.offer_variants
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- offer_lines
create policy offer_lines_all on public.offer_lines
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- schedule
create policy schedule_all on public.case_schedule_items
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- payments
create policy payments_all on public.payments
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- reminders
create policy reminders_all on public.reminders
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- extra_works
create policy extra_works_all on public.extra_works
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- protocols
create policy protocols_all on public.case_protocols
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- attachments metadata
create policy attachments_all on public.attachments
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

-- --- Storage: bucket prywatny ---
insert into storage.buckets (id, name, public)
values ('case-attachments', 'case-attachments', false)
on conflict (id) do nothing;

drop policy if exists "case-attachments select" on storage.objects;
drop policy if exists "case-attachments insert" on storage.objects;
drop policy if exists "case-attachments update" on storage.objects;
drop policy if exists "case-attachments delete" on storage.objects;

-- Polityki: pierwszy segment ścieżki = organization_id (uuid)
create policy "case-attachments select"
on storage.objects for select to authenticated
using (
  bucket_id = 'case-attachments'
  and (storage.foldername(name))[1] in (
    select organization_id::text from public.organization_members where user_id = auth.uid()
  )
);

create policy "case-attachments insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'case-attachments'
  and (storage.foldername(name))[1] in (
    select organization_id::text from public.organization_members where user_id = auth.uid()
  )
);

create policy "case-attachments update"
on storage.objects for update to authenticated
using (
  bucket_id = 'case-attachments'
  and (storage.foldername(name))[1] in (
    select organization_id::text from public.organization_members where user_id = auth.uid()
  )
);

create policy "case-attachments delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'case-attachments'
  and (storage.foldername(name))[1] in (
    select organization_id::text from public.organization_members where user_id = auth.uid()
  )
);
