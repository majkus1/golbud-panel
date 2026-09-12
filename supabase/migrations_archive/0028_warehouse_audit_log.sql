-- Dziennik magazynu: kto i kiedy (ruchy + zmiany pozycji poza przyjęciem/wydaniem).

create or replace function public.warehouse_movement_set_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.created_by is null then
    NEW.created_by := auth.uid();
  end if;
  return NEW;
end;
$$;

drop trigger if exists warehouse_movement_set_created_by on public.warehouse_movements;
create trigger warehouse_movement_set_created_by
before insert on public.warehouse_movements
for each row execute function public.warehouse_movement_set_created_by();

create table if not exists public.warehouse_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_item_id uuid references public.warehouse_items(id) on delete set null,
  action text not null check (action in ('item_created', 'items_imported', 'min_quantity_changed')),
  label text not null default '',
  details text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists warehouse_audit_log_org_created_idx
  on public.warehouse_audit_log (organization_id, created_at desc);

alter table public.warehouse_audit_log enable row level security;

drop policy if exists warehouse_audit_log_all on public.warehouse_audit_log;
create policy warehouse_audit_log_all on public.warehouse_audit_log
for all using (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
)
with check (
  organization_id in (select organization_id from public.organization_members where user_id = auth.uid())
);

grant select, insert on public.warehouse_audit_log to authenticated;

comment on table public.warehouse_audit_log is 'Zmiany konfiguracji magazynu (nowa pozycja, import, próg min.) — ruchy ilości w warehouse_movements.';
