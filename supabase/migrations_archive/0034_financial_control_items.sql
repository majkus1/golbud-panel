-- Rejestr naleznosci, sporow, budow i przyszlych rozrachunkow.
-- Dane sa recznie korygowalna warstwa raportowa nad sprawami/platnosciami:
-- obejmuje gotowke, kwoty warunkowe, spory, wejscia ekip i rozliczenia.

create table if not exists public.financial_control_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  section text not null check (
    section in (
      'confirmed_receivable',
      'potential_scope',
      'cash_outside_transfer',
      'dispute',
      'completion_receivable',
      'scheduled_build',
      'crew_settlement',
      'employee_settlement',
      'subcontractor_settlement'
    )
  ),
  location text not null default '',
  address text,
  client_label text,
  title text,
  scope text,
  amount numeric check (amount is null or amount >= 0),
  amount_label text,
  payer text,
  status_action text,
  condition_label text,
  phone text,
  term_label text,
  crew_label text,
  notes text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_control_items_org_section_idx
  on public.financial_control_items(organization_id, section, sort_order);

create index if not exists financial_control_items_case_idx
  on public.financial_control_items(case_id);

drop trigger if exists set_financial_control_items_updated_at on public.financial_control_items;
create trigger set_financial_control_items_updated_at
before update on public.financial_control_items
for each row execute function public.set_updated_at();

alter table public.financial_control_items enable row level security;

drop policy if exists financial_control_items_manage on public.financial_control_items;
create policy financial_control_items_manage on public.financial_control_items
for all using (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
)
with check (
  public.is_member_of(organization_id)
  and public.can_see_all_cases(organization_id)
);

grant select, insert, update, delete on public.financial_control_items to authenticated;
