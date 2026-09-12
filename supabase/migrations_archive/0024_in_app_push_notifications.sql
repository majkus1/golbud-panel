-- Powiadomienia w aplikacji (dzwoneczek) + subskrypcje Web Push (PWA).
-- Push tylko przy zdarzeniach (nie cron). Cron digest zostaje wyłącznie e-mail.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('new_case', 'case_assigned', 'task_created', 'task_comment')),
  title text not null,
  body text not null default '',
  href text not null default '/',
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);

create index if not exists user_notifications_user_unread_idx
  on public.user_notifications (user_id)
  where read_at is null;

alter table public.user_notifications enable row level security;

drop policy if exists user_notifications_select on public.user_notifications;
create policy user_notifications_select on public.user_notifications
for select using (user_id = auth.uid());

drop policy if exists user_notifications_update on public.user_notifications;
create policy user_notifications_update on public.user_notifications
for update using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, update on public.user_notifications to authenticated;

-- Subskrypcje przeglądarki (Web Push).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Włączenie push w przeglądarce (owner ustawia w Zespół).
alter table public.digest_email_prefs
  add column if not exists push_enabled boolean not null default false;

comment on column public.digest_email_prefs.push_enabled is 'Zezwolenie na powiadomienia push w przeglądarce/PWA';

-- Realtime dla dzwonka.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_notifications'
  ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end $$;
