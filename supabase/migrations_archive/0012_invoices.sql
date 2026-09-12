-- Faktury: proforma / zaliczkowa / końcowa / VAT — powiązane ze sprawą.
-- Spina proces: wycena (offer_variants) → faktura → płatności.
-- Idempotentna i bezpieczna do ponownego uruchomienia.

-- ── Licznik numeracji (per organizacja / typ / rok) ───────────────────────────
create table if not exists public.invoice_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  year int not null,
  last_seq int not null default 0,
  primary key (organization_id, kind, year)
);

-- ── Faktury ───────────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null check (kind in ('proforma', 'zaliczkowa', 'końcowa', 'vat')),
  status text not null default 'szkic' check (status in ('szkic', 'wystawiona', 'opłacona', 'anulowana')),
  number text not null,
  number_seq int not null default 0,
  number_year int not null,
  issue_date date not null default (current_date),
  sale_date date,
  due_date date,
  payment_method text not null default 'przelew' check (payment_method in ('przelew', 'gotówka', 'karta', 'BLIK')),
  buyer_name text not null default '',
  buyer_nip text,
  buyer_address text,
  buyer_city text,
  buyer_email text,
  notes text,
  net_total numeric not null default 0,
  vat_total numeric not null default 0,
  gross_total numeric not null default 0,
  paid_amount numeric not null default 0 check (paid_amount >= 0),
  source_variant_id uuid references public.offer_variants(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);

create index if not exists invoices_org_idx on public.invoices(organization_id);
create index if not exists invoices_case_idx on public.invoices(case_id);
create index if not exists invoices_org_status_idx on public.invoices(organization_id, status);

drop trigger if exists set_invoices_updated_at on public.invoices;
create trigger set_invoices_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

-- ── Pozycje faktury ─────────────────────────────────────────────────────────
create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  name text not null default '',
  unit text not null default 'usługa' check (unit in ('m²', 'mb', 'szt.', 'kpl.', 'roboczogodz.', 'usługa')),
  quantity numeric not null default 1 check (quantity >= 0),
  unit_price_net numeric not null default 0 check (unit_price_net >= 0),
  discount_pct numeric not null default 0 check (discount_pct >= 0 and discount_pct <= 100),
  vat_rate numeric not null default 23 check (vat_rate >= 0 and vat_rate <= 100),
  net_total numeric generated always as (
    round(quantity * unit_price_net * (1 - coalesce(discount_pct, 0) / 100.0), 2)
  ) stored,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines(invoice_id);

-- ── Przeliczanie sum faktury po zmianie pozycji ───────────────────────────────
create or replace function public.recalc_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice uuid;
  v_net numeric;
  v_vat numeric;
begin
  v_invoice := coalesce(NEW.invoice_id, OLD.invoice_id);

  select
    coalesce(sum(net_total), 0),
    coalesce(sum(round(net_total * vat_rate / 100.0, 2)), 0)
  into v_net, v_vat
  from public.invoice_lines
  where invoice_id = v_invoice;

  update public.invoices
  set net_total = v_net,
      vat_total = v_vat,
      gross_total = v_net + v_vat
  where id = v_invoice;

  return null;
end;
$$;

drop trigger if exists invoice_lines_recalc on public.invoice_lines;
create trigger invoice_lines_recalc
after insert or update or delete on public.invoice_lines
for each row execute function public.recalc_invoice_totals();

-- ── Bezpieczna numeracja: kolejny numer w obrębie organizacji / typu / roku ──
-- Weryfikuje członkostwo w organizacji (ochrona przed nadawaniem numeru w cudzej firmie).
create or replace function public.next_invoice_seq(p_org uuid, p_kind text, p_year int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
begin
  if not exists (
    select 1 from public.organization_members
    where user_id = auth.uid() and organization_id = p_org
  ) then
    raise exception 'Brak dostępu do organizacji';
  end if;

  insert into public.invoice_counters (organization_id, kind, year, last_seq)
  values (p_org, p_kind, p_year, 1)
  on conflict (organization_id, kind, year)
  do update set last_seq = public.invoice_counters.last_seq + 1
  returning last_seq into v_seq;

  return v_seq;
end;
$$;

revoke all on function public.next_invoice_seq(uuid, text, int) from public;
grant execute on function public.next_invoice_seq(uuid, text, int) to authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.invoice_counters enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;

drop policy if exists invoice_counters_select on public.invoice_counters;
create policy invoice_counters_select on public.invoice_counters
for select using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

drop policy if exists invoices_all on public.invoices;
create policy invoices_all on public.invoices
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

drop policy if exists invoice_lines_all on public.invoice_lines;
create policy invoice_lines_all on public.invoice_lines
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

grant select on public.invoice_counters to authenticated;
grant select, insert, update, delete on public.invoices to authenticated;
grant select, insert, update, delete on public.invoice_lines to authenticated;
