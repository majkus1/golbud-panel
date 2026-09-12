-- Utwardzenie RLS/storage dla danych powiazanych ze sprawami.
--
-- Cel biznesowy:
--   - owner / office / manager widza i zarzadzaja sprawami w organizacji,
--   - sales widzi elementy komercyjne tylko dla spraw utworzonych/przypisanych,
--   - brygadzista / podwykonawca / member widza operacyjne dane tylko swoich spraw,
--   - pliki w Storage nie sa juz chronione wyłącznie prefiksem organizacji.
--
-- Idempotentna. Uruchom po migracji 0032.

create or replace function public.uuid_or_null(value text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  return value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function public.uuid_or_null(text) from public;
grant execute on function public.uuid_or_null(text) to authenticated;

create or replace function public.can_access_case_in_org(target_case uuid, target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.cases c
    where c.id = target_case
      and c.organization_id = target_org
      and public.is_member_of(c.organization_id)
      and (
        public.can_see_all_cases(c.organization_id)
        or c.created_by = auth.uid()
        or public.is_case_assignee(c.id)
      )
  );
$$;

revoke all on function public.can_access_case_in_org(uuid, uuid) from public;
grant execute on function public.can_access_case_in_org(uuid, uuid) to authenticated;

create or replace function public.can_access_case(target_case uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.cases c
    where c.id = target_case
      and public.can_access_case_in_org(c.id, c.organization_id)
  );
$$;

revoke all on function public.can_access_case(uuid) from public;
grant execute on function public.can_access_case(uuid) to authenticated;

create or replace function public.can_access_case_commercial_in_org(target_case uuid, target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.can_see_case_commercial(target_org)
    and public.can_access_case_in_org(target_case, target_org);
$$;

revoke all on function public.can_access_case_commercial_in_org(uuid, uuid) from public;
grant execute on function public.can_access_case_commercial_in_org(uuid, uuid) to authenticated;

create or replace function public.can_access_task_in_org(target_task uuid, target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.case_tasks ct
    where ct.id = target_task
      and ct.organization_id = target_org
      and public.is_member_of(ct.organization_id)
      and (
        public.can_see_all_cases(ct.organization_id)
        or ct.assignee_id = auth.uid()
        or ct.created_by = auth.uid()
        or public.is_task_assignee(ct.id)
      )
  );
$$;

revoke all on function public.can_access_task_in_org(uuid, uuid) from public;
grant execute on function public.can_access_task_in_org(uuid, uuid) to authenticated;

create or replace function public.is_case_owner_or_manager(target_case uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.cases c
    where c.id = target_case
      and public.is_member_of(c.organization_id)
      and public.can_see_all_cases(c.organization_id)
  );
$$;

revoke all on function public.is_case_owner_or_manager(uuid) from public;
grant execute on function public.is_case_owner_or_manager(uuid) to authenticated;

-- Przypisania do spraw: lista przypisan jest widoczna tylko dla osob, ktore widza dana sprawe.
drop policy if exists case_assignees_select on public.case_assignees;
create policy case_assignees_select on public.case_assignees
for select using (
  public.can_access_case(case_id)
);

-- Notatki operacyjne przy sprawie.
drop policy if exists case_notes_all on public.case_notes;
drop policy if exists case_notes_select on public.case_notes;
drop policy if exists case_notes_insert on public.case_notes;
drop policy if exists case_notes_update on public.case_notes;
drop policy if exists case_notes_delete on public.case_notes;

create policy case_notes_select on public.case_notes
for select using (
  public.can_access_case_in_org(case_id, organization_id)
);

create policy case_notes_insert on public.case_notes
for insert with check (
  user_id = auth.uid()
  and public.can_access_case_in_org(case_id, organization_id)
);

create policy case_notes_update on public.case_notes
for update using (
  user_id = auth.uid()
  and public.can_access_case_in_org(case_id, organization_id)
)
with check (
  user_id = auth.uid()
  and public.can_access_case_in_org(case_id, organization_id)
);

create policy case_notes_delete on public.case_notes
for delete using (
  user_id = auth.uid()
  and public.can_access_case_in_org(case_id, organization_id)
);

-- Harmonogram: operacyjnie dostepny dla osob przypisanych do sprawy.
drop policy if exists schedule_all on public.case_schedule_items;
drop policy if exists schedule_select on public.case_schedule_items;
drop policy if exists schedule_manage on public.case_schedule_items;

create policy schedule_select on public.case_schedule_items
for select using (
  public.can_access_case_in_org(case_id, organization_id)
);

create policy schedule_manage on public.case_schedule_items
for all using (
  public.can_access_case_in_org(case_id, organization_id)
)
with check (
  public.can_access_case_in_org(case_id, organization_id)
);

-- Przypomnienia kontaktowe: dane biurowo-handlowe tylko dla rol komercyjnych
-- oraz tylko w zakresie dostepnych spraw.
drop policy if exists reminders_all on public.reminders;
drop policy if exists reminders_select on public.reminders;
drop policy if exists reminders_manage on public.reminders;

create policy reminders_select on public.reminders
for select using (
  public.can_access_case_commercial_in_org(case_id, organization_id)
);

create policy reminders_manage on public.reminders
for all using (
  public.can_access_case_commercial_in_org(case_id, organization_id)
)
with check (
  public.can_access_case_commercial_in_org(case_id, organization_id)
);

-- Podwykonawcy na sprawie zawieraja stawki/zakresy, wiec trzymamy je w
-- warstwie komercyjnej konkretnej sprawy.
drop policy if exists case_subcontractors_all on public.case_subcontractors;
drop policy if exists case_subcontractors_select on public.case_subcontractors;
drop policy if exists case_subcontractors_manage on public.case_subcontractors;

create policy case_subcontractors_select on public.case_subcontractors
for select using (
  public.can_access_case_commercial_in_org(case_id, organization_id)
);

create policy case_subcontractors_manage on public.case_subcontractors
for all using (
  public.can_access_case_commercial_in_org(case_id, organization_id)
)
with check (
  public.can_access_case_commercial_in_org(case_id, organization_id)
);

-- Oferta / kosztorys: sales ma dostep tylko do swoich/przypisanych spraw.
drop policy if exists offer_variants_all on public.offer_variants;
drop policy if exists offer_variants_select on public.offer_variants;
drop policy if exists offer_variants_manage on public.offer_variants;

create policy offer_variants_select on public.offer_variants
for select using (
  public.can_access_case_commercial_in_org(case_id, organization_id)
);

create policy offer_variants_manage on public.offer_variants
for all using (
  public.can_access_case_commercial_in_org(case_id, organization_id)
)
with check (
  public.can_access_case_commercial_in_org(case_id, organization_id)
);

drop policy if exists offer_lines_all on public.offer_lines;
drop policy if exists offer_lines_select on public.offer_lines;
drop policy if exists offer_lines_manage on public.offer_lines;

create policy offer_lines_select on public.offer_lines
for select using (
  exists (
    select 1
    from public.offer_variants v
    where v.id = offer_lines.variant_id
      and v.organization_id = offer_lines.organization_id
      and public.can_access_case_commercial_in_org(v.case_id, v.organization_id)
  )
);

create policy offer_lines_manage on public.offer_lines
for all using (
  exists (
    select 1
    from public.offer_variants v
    where v.id = offer_lines.variant_id
      and v.organization_id = offer_lines.organization_id
      and public.can_access_case_commercial_in_org(v.case_id, v.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.offer_variants v
    where v.id = offer_lines.variant_id
      and v.organization_id = offer_lines.organization_id
      and public.can_access_case_commercial_in_org(v.case_id, v.organization_id)
  )
);

-- Prace dodatkowe sa elementem wartosci/rozliczenia sprawy.
drop policy if exists extra_works_all on public.extra_works;
drop policy if exists extra_works_select on public.extra_works;
drop policy if exists extra_works_manage on public.extra_works;

create policy extra_works_select on public.extra_works
for select using (
  public.can_access_case_commercial_in_org(case_id, organization_id)
);

create policy extra_works_manage on public.extra_works
for all using (
  public.can_access_case_commercial_in_org(case_id, organization_id)
)
with check (
  public.can_access_case_commercial_in_org(case_id, organization_id)
);

-- Protokoły operacyjne.
drop policy if exists protocols_all on public.case_protocols;
drop policy if exists protocols_select on public.case_protocols;
drop policy if exists protocols_insert on public.case_protocols;
drop policy if exists protocols_delete on public.case_protocols;

create policy protocols_select on public.case_protocols
for select using (
  public.can_access_case_in_org(case_id, organization_id)
);

create policy protocols_insert on public.case_protocols
for insert with check (
  public.can_access_case_in_org(case_id, organization_id)
  and (created_by is null or created_by = auth.uid())
);

create policy protocols_delete on public.case_protocols
for delete using (
  public.is_case_owner_or_manager(case_id)
  or created_by = auth.uid()
);

-- Metadane zalacznikow sprawy.
drop policy if exists attachments_all on public.attachments;
drop policy if exists attachments_select on public.attachments;
drop policy if exists attachments_insert on public.attachments;
drop policy if exists attachments_update on public.attachments;
drop policy if exists attachments_delete on public.attachments;

create policy attachments_select on public.attachments
for select using (
  public.can_access_case_in_org(case_id, organization_id)
);

create policy attachments_insert on public.attachments
for insert with check (
  public.can_access_case_in_org(case_id, organization_id)
  and (uploaded_by is null or uploaded_by = auth.uid())
  and public.uuid_or_null((storage.foldername(storage_path))[1]) = organization_id
  and public.uuid_or_null((storage.foldername(storage_path))[2]) = case_id
);

create policy attachments_update on public.attachments
for update using (
  public.can_access_case_in_org(case_id, organization_id)
  and (
    uploaded_by = auth.uid()
    or public.is_case_owner_or_manager(case_id)
  )
)
with check (
  public.can_access_case_in_org(case_id, organization_id)
  and (
    uploaded_by = auth.uid()
    or public.is_case_owner_or_manager(case_id)
  )
  and public.uuid_or_null((storage.foldername(storage_path))[1]) = organization_id
  and public.uuid_or_null((storage.foldername(storage_path))[2]) = case_id
);

create policy attachments_delete on public.attachments
for delete using (
  public.can_access_case_in_org(case_id, organization_id)
  and (
    uploaded_by = auth.uid()
    or public.is_case_owner_or_manager(case_id)
  )
);

-- Komentarze i zalaczniki zadan: kazdy zapis/odczyt musi przechodzic przez dostep do zadania.
drop policy if exists case_task_comments_select on public.case_task_comments;
drop policy if exists case_task_comments_insert on public.case_task_comments;
drop policy if exists case_task_comments_delete on public.case_task_comments;

create policy case_task_comments_select on public.case_task_comments
for select using (
  public.can_access_task_in_org(task_id, organization_id)
);

create policy case_task_comments_insert on public.case_task_comments
for insert with check (
  user_id = auth.uid()
  and public.can_access_task_in_org(task_id, organization_id)
);

create policy case_task_comments_delete on public.case_task_comments
for delete using (
  user_id = auth.uid()
  and public.can_access_task_in_org(task_id, organization_id)
);

drop policy if exists case_task_comment_attachments_select on public.case_task_comment_attachments;
drop policy if exists case_task_comment_attachments_insert on public.case_task_comment_attachments;
drop policy if exists case_task_comment_attachments_delete on public.case_task_comment_attachments;

create policy case_task_comment_attachments_select on public.case_task_comment_attachments
for select using (
  public.can_access_task_in_org(task_id, organization_id)
);

create policy case_task_comment_attachments_insert on public.case_task_comment_attachments
for insert with check (
  public.can_access_task_in_org(task_id, organization_id)
  and public.uuid_or_null((storage.foldername(storage_path))[1]) = organization_id
  and (storage.foldername(storage_path))[2] = 'tasks'
  and public.uuid_or_null((storage.foldername(storage_path))[3]) = task_id
  and exists (
    select 1
    from public.case_task_comments c
    where c.id = case_task_comment_attachments.comment_id
      and c.task_id = case_task_comment_attachments.task_id
      and c.organization_id = case_task_comment_attachments.organization_id
      and c.user_id = auth.uid()
  )
);

create policy case_task_comment_attachments_delete on public.case_task_comment_attachments
for delete using (
  public.can_access_task_in_org(task_id, organization_id)
  and exists (
    select 1
    from public.case_task_comments c
    where c.id = case_task_comment_attachments.comment_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists case_task_reads_all on public.case_task_reads;
create policy case_task_reads_all on public.case_task_reads
for all using (
  user_id = auth.uid()
  and public.can_access_task_in_org(task_id, organization_id)
)
with check (
  user_id = auth.uid()
  and public.can_access_task_in_org(task_id, organization_id)
);

-- Kosztorysy powykonawcze: dokument komercyjny, tylko role komercyjne w zakresie sprawy.
drop policy if exists case_as_built_estimates_select on public.case_as_built_estimates;
drop policy if exists case_as_built_estimates_insert on public.case_as_built_estimates;
drop policy if exists case_as_built_estimates_delete on public.case_as_built_estimates;

create policy case_as_built_estimates_select on public.case_as_built_estimates
for select using (
  public.can_access_case_commercial_in_org(case_id, organization_id)
);

create policy case_as_built_estimates_insert on public.case_as_built_estimates
for insert with check (
  public.can_access_case_commercial_in_org(case_id, organization_id)
  and (created_by is null or created_by = auth.uid())
  and public.uuid_or_null((storage.foldername(storage_path))[1]) = organization_id
  and public.uuid_or_null((storage.foldername(storage_path))[2]) = case_id
);

create policy case_as_built_estimates_delete on public.case_as_built_estimates
for delete using (
  public.is_case_owner_or_manager(case_id)
);

-- Godziny pracy: jesli sa podlaczone do sprawy, podlegaja dostepowi do tej sprawy.
drop policy if exists work_hours_all on public.work_hours;
drop policy if exists work_hours_select on public.work_hours;
drop policy if exists work_hours_write on public.work_hours;

create policy work_hours_select on public.work_hours
for select using (
  public.is_member_of(organization_id)
  and (
    public.can_see_all_cases(organization_id)
    or created_by = auth.uid()
    or (case_id is not null and public.can_access_case_in_org(case_id, organization_id))
    or (case_id is null and public.my_role_in(organization_id) = 'brygadzista')
  )
);

create policy work_hours_write on public.work_hours
for all using (
  public.can_edit_work_hours(organization_id)
  and (
    public.can_see_all_cases(organization_id)
    or created_by = auth.uid()
    or case_id is null
    or public.can_access_case_in_org(case_id, organization_id)
  )
)
with check (
  public.can_edit_work_hours(organization_id)
  and (
    public.can_see_all_cases(organization_id)
    or created_by = auth.uid()
    or case_id is null
    or public.can_access_case_in_org(case_id, organization_id)
  )
);

-- Helpery Storage. Odczyt/usuwanie opieramy o metadane w bazie; insert dopuszcza
-- sciezki org/case/... oraz org/tasks/task/... tylko gdy user ma dostep do celu.
create or replace function public.can_insert_case_attachment_object(object_name text)
returns boolean
language plpgsql
security definer
stable
set search_path = public, storage
as $$
declare
  parts text[];
  target_org uuid;
  target_case uuid;
  target_task uuid;
begin
  parts := storage.foldername(object_name);
  target_org := public.uuid_or_null(parts[1]);

  if target_org is null then
    return false;
  end if;

  if parts[2] = 'tasks' then
    target_task := public.uuid_or_null(parts[3]);
    return target_task is not null
      and public.can_access_task_in_org(target_task, target_org);
  end if;

  target_case := public.uuid_or_null(parts[2]);
  if target_case is null then
    return false;
  end if;

  if parts[3] = 'as-built-estimates' then
    return public.can_access_case_commercial_in_org(target_case, target_org);
  end if;

  return public.can_access_case_in_org(target_case, target_org);
end;
$$;

revoke all on function public.can_insert_case_attachment_object(text) from public;
grant execute on function public.can_insert_case_attachment_object(text) to authenticated;

create or replace function public.can_select_case_attachment_object(object_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.attachments a
    where a.storage_path = object_name
      and public.can_access_case_in_org(a.case_id, a.organization_id)
  )
  or exists (
    select 1
    from public.case_task_comment_attachments ta
    where ta.storage_path = object_name
      and public.can_access_task_in_org(ta.task_id, ta.organization_id)
  )
  or exists (
    select 1
    from public.case_as_built_estimates abe
    where abe.storage_path = object_name
      and public.can_access_case_commercial_in_org(abe.case_id, abe.organization_id)
  );
$$;

revoke all on function public.can_select_case_attachment_object(text) from public;
grant execute on function public.can_select_case_attachment_object(text) to authenticated;

create or replace function public.can_delete_case_attachment_object(object_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.attachments a
    where a.storage_path = object_name
      and public.can_access_case_in_org(a.case_id, a.organization_id)
      and (
        a.uploaded_by = auth.uid()
        or public.is_case_owner_or_manager(a.case_id)
      )
  )
  or exists (
    select 1
    from public.case_task_comment_attachments ta
    join public.case_task_comments c on c.id = ta.comment_id
    where ta.storage_path = object_name
      and public.can_access_task_in_org(ta.task_id, ta.organization_id)
      and c.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.case_as_built_estimates abe
    where abe.storage_path = object_name
      and public.is_case_owner_or_manager(abe.case_id)
  );
$$;

revoke all on function public.can_delete_case_attachment_object(text) from public;
grant execute on function public.can_delete_case_attachment_object(text) to authenticated;

drop policy if exists "case-attachments select" on storage.objects;
drop policy if exists "case-attachments insert" on storage.objects;
drop policy if exists "case-attachments update" on storage.objects;
drop policy if exists "case-attachments delete" on storage.objects;
drop policy if exists "case-attachments select hardened" on storage.objects;
drop policy if exists "case-attachments insert hardened" on storage.objects;
drop policy if exists "case-attachments update hardened" on storage.objects;
drop policy if exists "case-attachments delete hardened" on storage.objects;

create policy "case-attachments select hardened"
on storage.objects for select to authenticated
using (
  bucket_id = 'case-attachments'
  and public.can_select_case_attachment_object(name)
);

create policy "case-attachments insert hardened"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'case-attachments'
  and public.can_insert_case_attachment_object(name)
);

create policy "case-attachments update hardened"
on storage.objects for update to authenticated
using (
  bucket_id = 'case-attachments'
  and public.can_select_case_attachment_object(name)
)
with check (
  bucket_id = 'case-attachments'
  and public.can_insert_case_attachment_object(name)
);

create policy "case-attachments delete hardened"
on storage.objects for delete to authenticated
using (
  bucket_id = 'case-attachments'
  and public.can_delete_case_attachment_object(name)
);
