-- Flota (pojazdy) + magazyn materiałów na bazie

-- ── Pojazdy ───────────────────────────────────────────────────────────────────
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  registration_number text,
  make_model text,
  notes text,
  insurance_expires date,
  inspection_expires date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicles_org_idx on public.vehicles(organization_id);

drop trigger if exists set_vehicles_updated_at on public.vehicles;
create trigger set_vehicles_updated_at
before update on public.vehicles
for each row execute function public.set_updated_at();

create table if not exists public.vehicle_service_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  service_date date not null default (current_date),
  title text not null,
  description text,
  cost numeric,
  vendor text,
  created_at timestamptz not null default now()
);

create index if not exists vehicle_service_vehicle_idx on public.vehicle_service_entries(vehicle_id);

-- ── Magazyn ───────────────────────────────────────────────────────────────────
create table if not exists public.warehouse_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  catalog_item_id uuid references public.catalog_items(id) on delete set null,
  label text not null,
  unit text not null default 'szt.',
  quantity numeric not null default 0 check (quantity >= 0),
  min_quantity numeric not null default 0 check (min_quantity >= 0),
  location text not null default 'Baza',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists warehouse_items_org_idx on public.warehouse_items(organization_id);
create unique index if not exists warehouse_items_org_catalog_uidx
  on public.warehouse_items(organization_id, catalog_item_id)
  where catalog_item_id is not null;

drop trigger if exists set_warehouse_items_updated_at on public.warehouse_items;
create trigger set_warehouse_items_updated_at
before update on public.warehouse_items
for each row execute function public.set_updated_at();

create table if not exists public.warehouse_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_item_id uuid not null references public.warehouse_items(id) on delete cascade,
  movement_type text not null check (movement_type in ('in', 'out')),
  quantity numeric not null check (quantity > 0),
  note text,
  case_id uuid references public.cases(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists warehouse_movements_item_idx on public.warehouse_movements(warehouse_item_id);
create index if not exists warehouse_movements_org_created_idx on public.warehouse_movements(organization_id, created_at desc);

-- Aktualizacja stanu po ruchu magazynowym
create or replace function public.apply_warehouse_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.movement_type = 'in' then
    update public.warehouse_items
    set quantity = quantity + NEW.quantity
    where id = NEW.warehouse_item_id;
  else
    update public.warehouse_items
    set quantity = greatest(0, quantity - NEW.quantity)
    where id = NEW.warehouse_item_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists warehouse_movement_apply on public.warehouse_movements;
create trigger warehouse_movement_apply
after insert on public.warehouse_movements
for each row execute function public.apply_warehouse_movement();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.vehicles enable row level security;
alter table public.vehicle_service_entries enable row level security;
alter table public.warehouse_items enable row level security;
alter table public.warehouse_movements enable row level security;

create policy vehicles_all on public.vehicles
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

create policy vehicle_service_all on public.vehicle_service_entries
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

create policy warehouse_items_all on public.warehouse_items
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

create policy warehouse_movements_all on public.warehouse_movements
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

grant select, insert, update, delete on public.vehicles to authenticated;
grant select, insert, update, delete on public.vehicle_service_entries to authenticated;
grant select, insert, update, delete on public.warehouse_items to authenticated;
grant select, insert, delete on public.warehouse_movements to authenticated;
