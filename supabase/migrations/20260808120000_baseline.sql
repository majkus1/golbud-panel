


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."add_employee_piecework_entry"("target_org" "uuid", "target_employee" "uuid", "target_activity" "uuid", "target_case" "uuid", "target_quantity" numeric, "target_date" "date", "target_note" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  activity_rate numeric;
  result_id uuid;
begin
  if not public.can_edit_work_hours(target_org) then
    raise exception 'Brak uprawnien do rejestrowania pracy';
  end if;
  if target_quantity is null or target_quantity <= 0 then
    raise exception 'Ilosc musi byc wieksza od zera';
  end if;
  if target_case is not null
     and not (public.can_see_all_cases(target_org) or public.can_access_case_in_org(target_case, target_org)) then
    raise exception 'Brak dostepu do sprawy';
  end if;
  if not exists (
    select 1 from public.employee_profiles ep
    where ep.id = target_employee and ep.organization_id = target_org and ep.active
  ) then
    raise exception 'Nie znaleziono pracownika w organizacji';
  end if;
  select pa.rate into activity_rate
  from public.piecework_activities pa
  where pa.id = target_activity and pa.organization_id = target_org and pa.active;
  if activity_rate is null then
    raise exception 'Nie znaleziono czynnosci akordowej';
  end if;

  insert into public.employee_piecework_entries (
    organization_id, employee_id, activity_id, case_id, quantity,
    unit_rate_snapshot, entry_date, note, created_by
  ) values (
    target_org, target_employee, target_activity, target_case, target_quantity,
    activity_rate, coalesce(target_date, current_date), nullif(trim(target_note), ''), auth.uid()
  ) returning id into result_id;
  return result_id;
end;
$$;


ALTER FUNCTION "public"."add_employee_piecework_entry"("target_org" "uuid", "target_employee" "uuid", "target_activity" "uuid", "target_case" "uuid", "target_quantity" numeric, "target_date" "date", "target_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_warehouse_movement"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.warehouse_items
  set quantity = case
    when NEW.movement_type = 'in' then quantity + NEW.quantity
    else quantity - NEW.quantity
  end
  where id = NEW.warehouse_item_id;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."apply_warehouse_movement"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_case"("target_case" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.cases c
    where c.id = target_case
      and public.can_access_case_in_org(c.id, c.organization_id)
  );
$$;


ALTER FUNCTION "public"."can_access_case"("target_case" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_case_commercial_in_org"("target_case" "uuid", "target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.can_see_case_commercial(target_org)
    and public.can_access_case_in_org(target_case, target_org);
$$;


ALTER FUNCTION "public"."can_access_case_commercial_in_org"("target_case" "uuid", "target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_case_in_org"("target_case" "uuid", "target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."can_access_case_in_org"("target_case" "uuid", "target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_task_in_org"("target_task" "uuid", "target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."can_access_task_in_org"("target_task" "uuid", "target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_delete_case_attachment_object"("object_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."can_delete_case_attachment_object"("object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_edit_work_hours"("target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.my_role_in(target_org) in ('owner', 'office', 'manager', 'brygadzista');
$$;


ALTER FUNCTION "public"."can_edit_work_hours"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_insert_case_attachment_object"("object_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'storage'
    AS $$
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


ALTER FUNCTION "public"."can_insert_case_attachment_object"("object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_operate_resources"("target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.my_role_in(target_org) in ('owner', 'office', 'manager', 'brygadzista', 'member');
$$;


ALTER FUNCTION "public"."can_operate_resources"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_see_all_cases"("target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.my_role_in(target_org) in ('owner', 'office', 'manager');
$$;


ALTER FUNCTION "public"."can_see_all_cases"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_see_case_commercial"("target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.my_role_in(target_org) in ('owner', 'office', 'manager', 'sales');
$$;


ALTER FUNCTION "public"."can_see_case_commercial"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_select_case_attachment_object"("object_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."can_select_case_attachment_object"("object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_use_ai_assistant"("target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.my_role_in(target_org) in ('owner', 'office', 'manager', 'sales', 'brygadzista');
$$;


ALTER FUNCTION "public"."can_use_ai_assistant"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_directory_profile"("target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    target_user_id = auth.uid()
    or exists (
      select 1
      from public.organization_members target_member
      join public.organization_members current_member
        on current_member.organization_id = target_member.organization_id
      where target_member.user_id = target_user_id
        and current_member.user_id = auth.uid()
    );
$$;


ALTER FUNCTION "public"."can_view_directory_profile"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_employee_hr"("target_employee_id" "uuid", "target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.employee_profiles target
    where target.id = target_employee_id
      and target.organization_id = target_org
      and public.is_member_of(target_org)
      and (
        public.can_see_all_cases(target_org)
        or target.user_id = auth.uid()
        or (
          public.my_role_in(target_org) = 'brygadzista'
          and exists (
            select 1
            from public.employee_profiles me
            where me.organization_id = target_org
              and me.user_id = auth.uid()
              and (
                (me.crew_id is not null and me.crew_id = target.crew_id)
                or target.manager_employee_id = me.id
              )
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_view_employee_hr"("target_employee_id" "uuid", "target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_labor_costs"("target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_member_of(target_org)
    and public.my_role_in(target_org) in ('owner', 'office', 'manager');
$$;


ALTER FUNCTION "public"."can_view_labor_costs"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_payroll"("target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_member_of(target_org)
    and public.my_role_in(target_org) in ('owner', 'manager');
$$;


ALTER FUNCTION "public"."can_view_payroll"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_org_for_user"("target_user" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."create_org_for_user"("target_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_employee_piecework_entry"("target_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  row_data public.employee_piecework_entries%rowtype;
begin
  select * into row_data from public.employee_piecework_entries where id = target_id;
  if row_data.id is null then return; end if;
  if not public.is_member_of(row_data.organization_id)
     or not (
       public.can_view_payroll(row_data.organization_id)
       or public.can_see_all_cases(row_data.organization_id)
       or (public.can_edit_work_hours(row_data.organization_id) and row_data.created_by = auth.uid())
     ) then
    raise exception 'Brak uprawnien do usuniecia wpisu';
  end if;
  delete from public.employee_piecework_entries where id = target_id;
end;
$$;


ALTER FUNCTION "public"."delete_employee_piecework_entry"("target_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."employee_hr_documents_visible"("target_org" "uuid") RETURNS TABLE("id" "uuid", "employee_id" "uuid", "document_type" "text", "title" "text", "valid_until" "date", "requires_renewal" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select d.id, d.employee_id, d.document_type, d.title, d.valid_until, d.requires_renewal
  from public.employee_documents d
  where d.organization_id = target_org
    and d.status = 'active'
    and d.requires_renewal
    and d.document_type in ('bhp', 'medical', 'training', 'qualification', 'certificate')
    and public.can_view_employee_hr(d.employee_id, target_org);
$$;


ALTER FUNCTION "public"."employee_hr_documents_visible"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."employee_hr_profiles_visible"("target_org" "uuid") RETURNS TABLE("id" "uuid", "full_name" "text", "crew_id" "uuid", "manager_employee_id" "uuid", "bhp_valid_until" "date", "medical_valid_until" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select ep.id, ep.full_name, ep.crew_id, ep.manager_employee_id, ep.bhp_valid_until, ep.medical_valid_until
  from public.employee_profiles ep
  where ep.organization_id = target_org
    and ep.active
    and public.can_view_employee_hr(ep.id, target_org);
$$;


ALTER FUNCTION "public"."employee_hr_profiles_visible"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."employee_piecework_entries_operational"("target_org" "uuid", "date_from" "date", "date_to" "date") RETURNS TABLE("id" "uuid", "organization_id" "uuid", "employee_id" "uuid", "activity_id" "uuid", "case_id" "uuid", "quantity" numeric, "entry_date" "date", "note" "text", "created_by" "uuid", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select pe.id, pe.organization_id, pe.employee_id, pe.activity_id,
    pe.case_id, pe.quantity, pe.entry_date, pe.note, pe.created_by, pe.created_at
  from public.employee_piecework_entries pe
  where pe.organization_id = target_org
    and pe.entry_date between date_from and date_to
    and public.is_member_of(target_org)
    and (
      public.can_view_payroll(target_org)
      or public.can_see_all_cases(target_org)
      or pe.created_by = auth.uid()
      or (pe.case_id is not null and public.can_access_case_in_org(pe.case_id, target_org))
      or (pe.case_id is null and public.my_role_in(target_org) = 'brygadzista')
    )
  order by pe.entry_date desc, pe.created_at desc;
$$;


ALTER FUNCTION "public"."employee_piecework_entries_operational"("target_org" "uuid", "date_from" "date", "date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."employee_work_profiles_visible"("target_org" "uuid") RETURNS TABLE("id" "uuid", "organization_id" "uuid", "full_name" "text", "crew_id" "uuid", "employment_type" "text", "active" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select ep.id, ep.organization_id, ep.full_name, ep.crew_id, ep.employment_type, ep.active
  from public.employee_profiles ep
  where ep.organization_id = target_org
    and ep.active
    and public.can_edit_work_hours(target_org)
  order by ep.full_name;
$$;


ALTER FUNCTION "public"."employee_work_profiles_visible"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_user_org"() RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.create_org_for_user(auth.uid());
$$;


ALTER FUNCTION "public"."ensure_user_org"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.create_org_for_user(new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_case_assignee"("target_case" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.case_assignees
    where case_id = target_case and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_case_assignee"("target_case" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_case_owner_or_manager"("target_case" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.cases c
    where c.id = target_case
      and public.is_member_of(c.organization_id)
      and public.can_see_all_cases(c.organization_id)
  );
$$;


ALTER FUNCTION "public"."is_case_owner_or_manager"("target_case" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_of"("target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.organization_members
    where user_id = auth.uid() and organization_id = target_org
  );
$$;


ALTER FUNCTION "public"."is_member_of"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_owner_of"("target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.organization_members
    where user_id = auth.uid()
      and organization_id = target_org
      and role = 'owner'
  );
$$;


ALTER FUNCTION "public"."is_owner_of"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_task_assignee"("target_task" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.case_task_assignees
    where task_id = target_task and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_task_assignee"("target_task" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_organization_activity"("p_organization_id" "uuid", "p_category" "text", "p_action" "text", "p_summary" "text", "p_details" "text" DEFAULT NULL::"text", "p_case_id" "uuid" DEFAULT NULL::"uuid", "p_entity_type" "text" DEFAULT NULL::"text", "p_entity_id" "uuid" DEFAULT NULL::"uuid", "p_meta" "jsonb" DEFAULT NULL::"jsonb", "p_created_by" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  new_id uuid;
  actor uuid;
begin
  actor := coalesce(p_created_by, auth.uid());
  insert into public.organization_activity_log (
    organization_id, case_id, category, entity_type, entity_id, action, summary, details, meta, created_by
  ) values (
    p_organization_id,
    p_case_id,
    p_category,
    coalesce(p_entity_type, p_category),
    p_entity_id,
    p_action,
    left(p_summary, 500),
    p_details,
    p_meta,
    actor
  )
  returning id into new_id;
  return new_id;
end;
$$;


ALTER FUNCTION "public"."log_organization_activity"("p_organization_id" "uuid", "p_category" "text", "p_action" "text", "p_summary" "text", "p_details" "text", "p_case_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_meta" "jsonb", "p_created_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_role_in"("target_org" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.organization_members
  where user_id = auth.uid() and organization_id = target_org
  limit 1;
$$;


ALTER FUNCTION "public"."my_role_in"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_invoice_seq"("p_org" "uuid", "p_kind" "text", "p_year" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."next_invoice_seq"("p_org" "uuid", "p_kind" "text", "p_year" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."organization_member_directory"("target_org" "uuid") RETURNS TABLE("organization_id" "uuid", "user_id" "uuid", "role" "text", "email" "text", "display_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    member.organization_id,
    member.user_id,
    member.role,
    directory.email,
    coalesce(
      nullif(btrim(employee.full_name), ''),
      nullif(directory.email, ''),
      member.user_id::text
    ) as display_name
  from public.organization_members member
  join public.user_directory_profiles directory on directory.user_id = member.user_id
  left join public.employee_profiles employee
    on employee.organization_id = member.organization_id
   and employee.user_id = member.user_id
  where member.organization_id = target_org
    and public.is_member_of(target_org);
$$;


ALTER FUNCTION "public"."organization_member_directory"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."owns_ai_attachment_object"("name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.ai_conversations c
    where c.id = public.uuid_or_null((storage.foldername(name))[2])
      and c.organization_id = public.uuid_or_null((storage.foldername(name))[1])
      and c.created_by = auth.uid()
      and public.can_use_ai_assistant(c.organization_id)
  );
$$;


ALTER FUNCTION "public"."owns_ai_attachment_object"("name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."payroll_labor_costs_aggregated"("target_org" "uuid") RETURNS TABLE("case_id" "uuid", "cost_date" "date", "amount" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with matched_hours as (
    select wh.id, wh.case_id, wh.work_date, wh.hours, ep.id as employee_id,
      ep.employment_type, ec.hourly_rate, ec.day_rate, ec.monthly_salary
    from public.work_hours wh
    join public.employee_profiles ep on ep.organization_id = wh.organization_id
      and (ep.id = wh.employee_id or (wh.employee_id is null and lower(regexp_replace(trim(wh.worker_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(ep.full_name), '\s+', ' ', 'g'))))
    left join public.employee_compensation ec on ec.employee_id = ep.id and ec.organization_id = ep.organization_id
    where wh.organization_id = target_org and wh.case_id is not null and wh.hours > 0
  ),
  month_hours as (
    select employee_id, date_trunc('month', work_date)::date as month_start, sum(hours) as total
    from matched_hours group by employee_id, date_trunc('month', work_date)::date
  ),
  day_hours as (
    select employee_id, work_date, sum(hours) as total
    from matched_hours group by employee_id, work_date
  ),
  hour_costs as (
    select mh.case_id, mh.work_date as cost_date,
      case
        when ms.id is not null and mon.total > 0 then ms.base_amount * (mh.hours / mon.total)
        when mh.employment_type = 'godzinowka' then mh.hours * coalesce(mh.hourly_rate, 0)
        when mh.employment_type = 'dniowka' and dy.total > 0 then coalesce(mh.day_rate, 0) * (mh.hours / dy.total)
        when coalesce(mh.monthly_salary, 0) > 0 and mon.total > 0 then mh.monthly_salary * (mh.hours / mon.total)
        else mh.hours * coalesce(mh.hourly_rate, 0)
      end as amount
    from matched_hours mh
    join month_hours mon on mon.employee_id = mh.employee_id and mon.month_start = date_trunc('month', mh.work_date)::date
    join day_hours dy on dy.employee_id = mh.employee_id and dy.work_date = mh.work_date
    left join public.employee_monthly_settlements ms on ms.employee_id = mh.employee_id
      and ms.organization_id = target_org and ms.period_month = mon.month_start
  ),
  settlement_costs as (
    select ese.case_id, ese.entry_date as cost_date,
      case
        when ese.entry_type = 'potracenie' or (ese.entry_type = 'korekta' and ese.direction = 'minus') then -ese.amount
        when ese.entry_type in ('zaliczka', 'wyplata') then 0
        else ese.amount
      end as amount
    from public.employee_settlement_entries ese
    where ese.organization_id = target_org and ese.case_id is not null
  ),
  piecework_costs as (
    select epe.case_id, epe.entry_date as cost_date, epe.quantity * epe.unit_rate_snapshot as amount
    from public.employee_piecework_entries epe
    where epe.organization_id = target_org and epe.case_id is not null
  )
  select costs.case_id, costs.cost_date, round(sum(costs.amount), 2) as amount
  from (
    select * from hour_costs
    union all select * from settlement_costs
    union all select * from piecework_costs
  ) costs
  where public.can_view_labor_costs(target_org)
  group by costs.case_id, costs.cost_date
  order by costs.cost_date, costs.case_id;
$$;


ALTER FUNCTION "public"."payroll_labor_costs_aggregated"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."piecework_activities_operational"("target_org" "uuid") RETURNS TABLE("id" "uuid", "organization_id" "uuid", "name" "text", "unit" "text", "sort_order" integer, "active" boolean, "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select pa.id, pa.organization_id, pa.name, pa.unit, pa.sort_order, pa.active, pa.created_at
  from public.piecework_activities pa
  where pa.organization_id = target_org
    and public.is_member_of(target_org)
  order by pa.sort_order, pa.name;
$$;


ALTER FUNCTION "public"."piecework_activities_operational"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_case_security_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.can_see_all_cases(OLD.organization_id) and (
    NEW.organization_id is distinct from OLD.organization_id
    or NEW.created_by is distinct from OLD.created_by
  ) then
    raise exception 'Nie można zmienić właściciela ani organizacji sprawy';
  end if;
  if NEW.estimated_value is not null then
    raise exception 'Wartość sprawy należy zapisać w danych handlowych';
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."protect_case_security_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_equipment_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  active_quantity numeric;
begin
  if TG_OP = 'DELETE' then
    if exists (
      select 1 from public.equipment_assignments ea
      where ea.equipment_id = OLD.id
    ) then
      raise exception 'Nie można usunąć sprzętu z historią wydań';
    end if;
    return OLD;
  end if;

  if NEW.organization_id is distinct from OLD.organization_id then
    raise exception 'Nie można przenieść sprzętu do innej organizacji';
  end if;
  select coalesce(sum(quantity), 0)
  into active_quantity
  from public.equipment_assignments
  where equipment_id = OLD.id
    and returned = false;
  if NEW.total_quantity < active_quantity then
    raise exception 'Ilość łączna nie może być niższa niż ilość aktualnie wydana';
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."protect_equipment_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_warehouse_item_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if TG_OP = 'DELETE' then
    if exists (
      select 1 from public.warehouse_movements wm
      where wm.warehouse_item_id = OLD.id
    ) then
      raise exception 'Nie można usunąć pozycji z historią ruchów';
    end if;
    return OLD;
  end if;

  if NEW.organization_id is distinct from OLD.organization_id then
    raise exception 'Nie można przenieść pozycji do innej organizacji';
  end if;
  if NEW.quantity is distinct from OLD.quantity and pg_trigger_depth() <= 1 then
    raise exception 'Stan magazynowy można zmieniać wyłącznie przez ruch magazynowy';
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."protect_warehouse_item_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_invoice_totals"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."recalc_invoice_totals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_employee_compliance_dates"("p_employee_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform set_config('app.hr_compliance_from_document', 'true', true);
  update public.employee_profiles ep set
    bhp_valid_until = (
      select max(d.valid_until) from public.employee_documents d
      where d.employee_id = p_employee_id and d.document_type = 'bhp' and d.status = 'active'
    ),
    medical_valid_until = (
      select max(d.valid_until) from public.employee_documents d
      where d.employee_id = p_employee_id and d.document_type = 'medical' and d.status = 'active'
    )
  where ep.id = p_employee_id;
end;
$$;


ALTER FUNCTION "public"."refresh_employee_compliance_dates"("p_employee_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_employee_monthly_settlement"("p_employee_id" "uuid", "p_period_month" "date") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  emp public.employee_profiles%rowtype;
  comp public.employee_compensation%rowtype;
  period_start date := date_trunc('month', p_period_month)::date;
  period_end date := (date_trunc('month', p_period_month) + interval '1 month')::date;
  existing public.employee_monthly_settlements%rowtype;
  total_hours numeric := 0; total_days integer := 0;
  piecework_amount numeric := 0; piecework_qty numeric := 0; base_value numeric := 0;
  bonuses numeric := 0; reimbursements numeric := 0; corrections_plus numeric := 0;
  deductions numeric := 0; corrections_minus numeric := 0; advances numeric := 0;
  previous_payments numeric := 0; gross_value numeric := 0; due_value numeric := 0; result_id uuid;
begin
  select * into emp from public.employee_profiles where id = p_employee_id;
  if emp.id is null then raise exception 'Nie znaleziono pracownika'; end if;
  if not public.can_view_payroll(emp.organization_id) then raise exception 'Brak uprawnien do rozliczen'; end if;
  select * into comp from public.employee_compensation
  where employee_id = emp.id and organization_id = emp.organization_id;

  select * into existing from public.employee_monthly_settlements
  where organization_id = emp.organization_id and employee_id = emp.id and period_month = period_start;
  if existing.id is not null and existing.status <> 'draft' then return existing.id; end if;

  select coalesce(sum(wh.hours), 0), count(distinct wh.work_date)::integer
  into total_hours, total_days from public.work_hours wh
  where wh.organization_id = emp.organization_id and wh.work_date >= period_start and wh.work_date < period_end
    and wh.hours > 0 and (wh.employee_id = emp.id or (wh.employee_id is null and lower(regexp_replace(trim(wh.worker_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(emp.full_name), '\s+', ' ', 'g'))));

  select coalesce(sum(pe.quantity * pe.unit_rate_snapshot), 0), coalesce(sum(pe.quantity), 0)
  into piecework_amount, piecework_qty from public.employee_piecework_entries pe
  where pe.employee_id = emp.id and pe.entry_date >= period_start and pe.entry_date < period_end;

  if emp.employment_type = 'godzinowka' then base_value := total_hours * coalesce(comp.hourly_rate, 0);
  elsif emp.employment_type = 'dniowka' then base_value := total_days * coalesce(comp.day_rate, 0);
  elsif emp.employment_type = 'akord' then base_value := piecework_amount;
  elsif coalesce(comp.monthly_salary, 0) > 0 then base_value := comp.monthly_salary;
  else base_value := total_hours * coalesce(comp.hourly_rate, 0); end if;

  select coalesce(sum(amount) filter (where entry_type = 'premia'), 0), coalesce(sum(amount) filter (where entry_type = 'zwrot_kosztow'), 0),
    coalesce(sum(amount) filter (where entry_type = 'korekta' and direction = 'plus'), 0), coalesce(sum(amount) filter (where entry_type = 'potracenie'), 0),
    coalesce(sum(amount) filter (where entry_type = 'korekta' and direction = 'minus'), 0), coalesce(sum(amount) filter (where entry_type = 'zaliczka'), 0),
    coalesce(sum(amount) filter (where entry_type = 'wyplata'), 0)
  into bonuses, reimbursements, corrections_plus, deductions, corrections_minus, advances, previous_payments
  from public.employee_settlement_entries where employee_id = emp.id and entry_date >= period_start and entry_date < period_end;

  gross_value := base_value + bonuses + reimbursements + corrections_plus;
  due_value := greatest(0, gross_value - deductions - corrections_minus - advances - previous_payments);
  insert into public.employee_monthly_settlements (
    organization_id, employee_id, period_month, status, employment_type_snapshot, hourly_rate_snapshot, day_rate_snapshot, monthly_salary_snapshot,
    hours_total, work_days_total, piecework_total, piecework_quantity_total, base_amount, bonuses_total, reimbursements_total,
    corrections_plus_total, deductions_total, corrections_minus_total, advances_total, previous_payments_total, gross_earnings, amount_due, calculated_at, created_by
  ) values (
    emp.organization_id, emp.id, period_start, 'draft', emp.employment_type, coalesce(comp.hourly_rate, 0), coalesce(comp.day_rate, 0), coalesce(comp.monthly_salary, 0),
    round(total_hours, 2), total_days, round(piecework_amount, 2), round(piecework_qty, 2), round(base_value, 2), round(bonuses, 2), round(reimbursements, 2),
    round(corrections_plus, 2), round(deductions, 2), round(corrections_minus, 2), round(advances, 2), round(previous_payments, 2), round(gross_value, 2), round(due_value, 2), now(), auth.uid()
  ) on conflict (organization_id, employee_id, period_month) do update set
    employment_type_snapshot = excluded.employment_type_snapshot, hourly_rate_snapshot = excluded.hourly_rate_snapshot,
    day_rate_snapshot = excluded.day_rate_snapshot, monthly_salary_snapshot = excluded.monthly_salary_snapshot,
    hours_total = excluded.hours_total, work_days_total = excluded.work_days_total, piecework_total = excluded.piecework_total,
    piecework_quantity_total = excluded.piecework_quantity_total, base_amount = excluded.base_amount, bonuses_total = excluded.bonuses_total,
    reimbursements_total = excluded.reimbursements_total, corrections_plus_total = excluded.corrections_plus_total, deductions_total = excluded.deductions_total,
    corrections_minus_total = excluded.corrections_minus_total, advances_total = excluded.advances_total,
    previous_payments_total = excluded.previous_payments_total, gross_earnings = excluded.gross_earnings,
    amount_due = excluded.amount_due, calculated_at = now()
  returning id into result_id;
  return result_id;
end;
$$;


ALTER FUNCTION "public"."refresh_employee_monthly_settlement"("p_employee_id" "uuid", "p_period_month" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_organization_member"("target_user" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  my_org uuid;
  owner_cnt int;
  uemail text;
  urole text;
begin
  select organization_id into my_org
  from public.organization_members
  where user_id = auth.uid() and role = 'owner'
  order by organization_id asc
  limit 1;

  if my_org is null then
    raise exception 'Tylko właściciel może usuwać członków zespołu';
  end if;

  if target_user = auth.uid() then
    raise exception 'Nie możesz usunąć siebie z listy. Poproś innego właściciela lub skontaktuj się z administratorem.';
  end if;

  select om.role, u.email::text into urole, uemail
  from public.organization_members om
  join auth.users u on u.id = om.user_id
  where om.organization_id = my_org and om.user_id = target_user;

  if urole is null then
    raise exception 'Ten użytkownik nie należy do Twojej organizacji';
  end if;

  select count(*)::int into owner_cnt
  from public.organization_members
  where organization_id = my_org and role = 'owner';

  if urole = 'owner' and owner_cnt <= 1 then
    raise exception 'W firmie musi zostać co najmniej jeden właściciel';
  end if;

  delete from public.digest_email_prefs
  where organization_id = my_org and user_id = target_user;

  delete from public.organization_members
  where organization_id = my_org and user_id = target_user;

  perform public.log_organization_activity(
    my_org, 'zespol', 'member_removed',
    'Usunięto z firmy: ' || coalesce(uemail, '?'),
    'Była rola: ' || urole,
    null, 'organization_member', target_user,
    jsonb_build_object('email', uemail, 'role', urole)
  );
end;
$$;


ALTER FUNCTION "public"."remove_organization_member"("target_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_employee_compensation"("target_org" "uuid", "target_employee" "uuid", "target_hourly_rate" numeric, "target_day_rate" numeric, "target_monthly_salary" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.can_view_payroll(target_org) then
    raise exception 'Brak uprawnien do wynagrodzen';
  end if;
  if coalesce(target_hourly_rate, 0) < 0
     or coalesce(target_day_rate, 0) < 0
     or coalesce(target_monthly_salary, 0) < 0 then
    raise exception 'Stawka nie moze byc ujemna';
  end if;
  if not exists (
    select 1 from public.employee_profiles ep
    where ep.id = target_employee and ep.organization_id = target_org
  ) then
    raise exception 'Nie znaleziono pracownika w organizacji';
  end if;

  insert into public.employee_compensation (
    employee_id, organization_id, hourly_rate, day_rate, monthly_salary,
    created_by, updated_by
  ) values (
    target_employee, target_org, target_hourly_rate, target_day_rate,
    target_monthly_salary, auth.uid(), auth.uid()
  )
  on conflict (employee_id) do update set
    hourly_rate = excluded.hourly_rate,
    day_rate = excluded.day_rate,
    monthly_salary = excluded.monthly_salary,
    updated_by = auth.uid(),
    updated_at = now()
  where public.employee_compensation.organization_id = target_org;
end;
$$;


ALTER FUNCTION "public"."save_employee_compensation"("target_org" "uuid", "target_employee" "uuid", "target_hourly_rate" numeric, "target_day_rate" numeric, "target_monthly_salary" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_catalog_for_org"("target_org" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."seed_catalog_for_org"("target_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_employee_crew_assignment"("p_employee_id" "uuid", "p_crew_id" "uuid", "p_valid_from" "date", "p_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  emp public.employee_profiles%rowtype;
  current_row public.employee_crew_history%rowtype;
  result_id uuid;
begin
  select * into emp from public.employee_profiles where id = p_employee_id;
  if emp.id is null then raise exception 'Nie znaleziono pracownika'; end if;
  if not (public.is_member_of(emp.organization_id) and public.can_see_all_cases(emp.organization_id)) then raise exception 'Brak uprawnien'; end if;
  if p_valid_from > current_date then raise exception 'Zmiane przyszla dodaj w dniu wejscia w zycie'; end if;
  if p_crew_id is not null and not exists (select 1 from public.crews where id = p_crew_id and organization_id = emp.organization_id) then raise exception 'Nieprawidlowa brygada'; end if;
  select * into current_row from public.employee_crew_history
  where employee_id = emp.id and valid_until is null order by valid_from desc, created_at desc limit 1;
  if current_row.id is not null and p_valid_from < current_row.valid_from then raise exception 'Data nie moze byc wczesniejsza niz obecne przypisanie'; end if;
  if current_row.id is not null and p_valid_from = current_row.valid_from then
    update public.employee_crew_history set crew_id = p_crew_id, notes = p_notes
    where id = current_row.id returning id into result_id;
  else
    update public.employee_crew_history set valid_until = p_valid_from - 1 where id = current_row.id;
    insert into public.employee_crew_history (
      organization_id, employee_id, crew_id, valid_from, notes, created_by
    ) values (emp.organization_id, emp.id, p_crew_id, p_valid_from, p_notes, auth.uid())
    returning id into result_id;
  end if;
  perform set_config('app.hr_history_manual', 'true', true);
  update public.employee_profiles set crew_id = p_crew_id where id = emp.id;
  return result_id;
end;
$$;


ALTER FUNCTION "public"."set_employee_crew_assignment"("p_employee_id" "uuid", "p_crew_id" "uuid", "p_valid_from" "date", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_employee_monthly_settlement_status"("p_settlement_id" "uuid", "p_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  card public.employee_monthly_settlements%rowtype;
begin
  if p_status not in ('draft', 'approved', 'paid', 'closed') then
    raise exception 'Nieprawidlowy status';
  end if;

  select * into card
  from public.employee_monthly_settlements
  where id = p_settlement_id;

  if card.id is null then raise exception 'Nie znaleziono karty'; end if;
  if not public.can_view_payroll(card.organization_id) then
    raise exception 'Brak uprawnien do rozliczen';
  end if;

  if p_status = 'approved' and card.status = 'draft' then
    perform public.refresh_employee_monthly_settlement(card.employee_id, card.period_month);
  elsif p_status = 'paid' and card.status <> 'approved' then
    raise exception 'Najpierw zatwierdz karte';
  elsif p_status = 'closed' and card.status <> 'paid' then
    raise exception 'Najpierw oznacz wyplate';
  elsif p_status = 'draft' and card.status not in ('approved', 'paid') then
    raise exception 'Tej karty nie mozna ponownie otworzyc';
  end if;

  update public.employee_monthly_settlements set
    status = p_status,
    approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) when p_status = 'draft' then null else approved_at end,
    approved_by = case when p_status = 'approved' then coalesce(approved_by, auth.uid()) when p_status = 'draft' then null else approved_by end,
    paid_at = case when p_status = 'paid' then now() when p_status in ('draft', 'approved') then null else paid_at end,
    paid_by = case when p_status = 'paid' then auth.uid() when p_status in ('draft', 'approved') then null else paid_by end,
    final_payment_amount = case when p_status = 'paid' then amount_due when p_status in ('draft', 'approved') then null else final_payment_amount end,
    closed_at = case when p_status = 'closed' then now() else closed_at end,
    closed_by = case when p_status = 'closed' then auth.uid() else closed_by end
  where id = p_settlement_id;
end;
$$;


ALTER FUNCTION "public"."set_employee_monthly_settlement_status"("p_settlement_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_employee_position_assignment"("p_employee_id" "uuid", "p_role_title" "text", "p_department" "text", "p_employment_type" "text", "p_manager_employee_id" "uuid", "p_valid_from" "date", "p_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  emp public.employee_profiles%rowtype;
  current_row public.employee_position_history%rowtype;
  result_id uuid;
begin
  select * into emp from public.employee_profiles where id = p_employee_id;
  if emp.id is null then raise exception 'Nie znaleziono pracownika'; end if;
  if not (public.is_member_of(emp.organization_id) and public.can_see_all_cases(emp.organization_id)) then raise exception 'Brak uprawnien'; end if;
  if p_valid_from > current_date then raise exception 'Zmiane przyszla dodaj w dniu wejscia w zycie'; end if;
  select * into current_row from public.employee_position_history
  where employee_id = emp.id and valid_until is null order by valid_from desc, created_at desc limit 1;
  if current_row.id is not null and p_valid_from < current_row.valid_from then raise exception 'Data nie moze byc wczesniejsza niz obecne przypisanie'; end if;
  if current_row.id is not null and p_valid_from = current_row.valid_from then
    update public.employee_position_history set
      role_title = p_role_title, department = p_department, employment_type = p_employment_type,
      manager_employee_id = p_manager_employee_id, notes = p_notes
    where id = current_row.id returning id into result_id;
  else
    update public.employee_position_history set valid_until = p_valid_from - 1 where id = current_row.id;
    insert into public.employee_position_history (
      organization_id, employee_id, role_title, department, employment_type,
      manager_employee_id, valid_from, notes, created_by
    ) values (
      emp.organization_id, emp.id, p_role_title, p_department, p_employment_type,
      p_manager_employee_id, p_valid_from, p_notes, auth.uid()
    ) returning id into result_id;
  end if;
  perform set_config('app.hr_history_manual', 'true', true);
  update public.employee_profiles set
    role_title = p_role_title, department = p_department, employment_type = p_employment_type,
    manager_employee_id = p_manager_employee_id
  where id = emp.id;
  return result_id;
end;
$$;


ALTER FUNCTION "public"."set_employee_position_assignment"("p_employee_id" "uuid", "p_role_title" "text", "p_department" "text", "p_employment_type" "text", "p_manager_employee_id" "uuid", "p_valid_from" "date", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_member_role"("target_email" "text", "target_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  my_org uuid;
  my_role text;
  target_user uuid;
  owner_cnt int;
  prev_role text;
begin
  select organization_id, role into my_org, my_role
  from public.organization_members
  where user_id = auth.uid() and role = 'owner'
  order by organization_id asc
  limit 1;

  if my_org is null then
    select organization_id, role into my_org, my_role
    from public.organization_members
    where user_id = auth.uid()
    order by organization_id asc
    limit 1;
  end if;

  if my_org is null then
    raise exception 'Brak organizacji dla użytkownika';
  end if;

  if my_role <> 'owner' then
    raise exception 'Tylko właściciel może zmieniać role';
  end if;

  if target_role not in (
    'owner', 'office', 'sales', 'manager', 'brygadzista', 'podwykonawca', 'member'
  ) then
    raise exception 'Nieprawidłowa rola: %', target_role;
  end if;

  select id into target_user from auth.users where lower(email) = lower(target_email);

  if target_user is null then
    raise exception 'Nie znaleziono użytkownika o e-mailu %', target_email;
  end if;

  select role into prev_role from public.organization_members
  where organization_id = my_org and user_id = target_user;

  if exists (
    select 1 from public.organization_members
    where organization_id = my_org and user_id = target_user and role = 'owner'
  ) and target_role <> 'owner' then
    select count(*)::int into owner_cnt
    from public.organization_members
    where organization_id = my_org and role = 'owner';

    if owner_cnt <= 1 then
      raise exception 'W firmie musi zostać co najmniej jeden właściciel';
    end if;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (my_org, target_user, target_role)
  on conflict (organization_id, user_id) do update
    set role = excluded.role;

  perform public.log_organization_activity(
    my_org, 'zespol',
    case when prev_role is null then 'member_added' else 'role_changed' end,
    case when prev_role is null then 'Dodano do zespołu: ' || target_email else 'Zmiana roli: ' || target_email end,
    case when prev_role is null then 'Rola: ' || target_role else coalesce(prev_role, '?') || ' → ' || target_role end,
    null, 'organization_member', target_user,
    jsonb_build_object('email', target_email, 'role', target_role, 'prev_role', prev_role)
  );
end;
$$;


ALTER FUNCTION "public"."set_member_role"("target_email" "text", "target_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_own_push_enabled"("p_organization_id" "uuid", "p_enabled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = auth.uid()
  ) then
    raise exception 'not a member';
  end if;

  insert into public.digest_email_prefs (organization_id, user_id, push_enabled, digest_enabled)
  values (p_organization_id, auth.uid(), p_enabled, false)
  on conflict (organization_id, user_id)
  do update set push_enabled = p_enabled, updated_at = now();
end;
$$;


ALTER FUNCTION "public"."set_own_push_enabled"("p_organization_id" "uuid", "p_enabled" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_own_push_enabled"("p_organization_id" "uuid", "p_enabled" boolean) IS 'Użytkownik włącza/wyłącza push na swoim koncie (niezależnie od roli)';



CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stamp_case_commercial_details"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  return NEW;
end;
$$;


ALTER FUNCTION "public"."stamp_case_commercial_details"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stamp_invoice_paid_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if TG_OP = 'INSERT' then
    if coalesce(NEW.paid_amount, 0) > 0 and NEW.paid_at is null then
      NEW.paid_at := now();
    end if;
    return NEW;
  end if;
  if coalesce(NEW.paid_amount, 0) > coalesce(OLD.paid_amount, 0) then
    NEW.paid_at := now();
  elsif coalesce(NEW.paid_amount, 0) = 0 then
    NEW.paid_at := null;
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."stamp_invoice_paid_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_user_directory_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.user_directory_profiles (user_id, email, updated_at)
  values (NEW.id, coalesce(NEW.email, ''), now())
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = excluded.updated_at;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."sync_user_directory_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_employee_profile_hr_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_position public.employee_position_history%rowtype;
  current_crew public.employee_crew_history%rowtype;
begin
  if current_setting('app.hr_history_manual', true) = 'true' then return NEW; end if;
  if TG_OP = 'INSERT' or OLD.role_title is distinct from NEW.role_title
    or OLD.department is distinct from NEW.department or OLD.employment_type is distinct from NEW.employment_type
    or OLD.manager_employee_id is distinct from NEW.manager_employee_id then
    select * into current_position from public.employee_position_history
    where employee_id = NEW.id and valid_until is null order by valid_from desc, created_at desc limit 1;
    if current_position.id is not null and current_position.valid_from = current_date then
      update public.employee_position_history set role_title = NEW.role_title, department = NEW.department,
        employment_type = NEW.employment_type, manager_employee_id = NEW.manager_employee_id
      where id = current_position.id;
    else
      update public.employee_position_history set valid_until = current_date - 1
      where employee_id = NEW.id and valid_until is null and valid_from < current_date;
      insert into public.employee_position_history (
        organization_id, employee_id, role_title, department, employment_type, manager_employee_id, valid_from, created_by
      ) values (NEW.organization_id, NEW.id, NEW.role_title, NEW.department, NEW.employment_type, NEW.manager_employee_id, current_date, auth.uid());
    end if;
  end if;
  if TG_OP = 'INSERT' or OLD.crew_id is distinct from NEW.crew_id then
    select * into current_crew from public.employee_crew_history
    where employee_id = NEW.id and valid_until is null order by valid_from desc, created_at desc limit 1;
    if current_crew.id is not null and current_crew.valid_from = current_date then
      update public.employee_crew_history set crew_id = NEW.crew_id where id = current_crew.id;
    else
      update public.employee_crew_history set valid_until = current_date - 1
      where employee_id = NEW.id and valid_until is null and valid_from < current_date;
      insert into public.employee_crew_history (organization_id, employee_id, crew_id, valid_from, created_by)
      values (NEW.organization_id, NEW.id, NEW.crew_id, current_date, auth.uid());
    end if;
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_employee_profile_hr_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_employee_settlement_entry_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  entry_row public.employee_settlement_entries%rowtype;
  card_id uuid;
  action_name text;
begin
  entry_row := coalesce(NEW, OLD);
  select id into card_id
  from public.employee_monthly_settlements
  where organization_id = entry_row.organization_id
    and employee_id = entry_row.employee_id
    and period_month = date_trunc('month', entry_row.entry_date)::date;
  action_name := case when TG_OP = 'INSERT' then 'entry_created' when TG_OP = 'DELETE' then 'entry_deleted' else 'entry_updated' end;
  insert into public.employee_settlement_history (
    organization_id, settlement_id, employee_id, period_month, action, summary,
    before_data, after_data, created_by
  ) values (
    entry_row.organization_id, card_id, entry_row.employee_id, date_trunc('month', entry_row.entry_date)::date,
    action_name,
    case when TG_OP = 'DELETE' then 'Usunieto wpis: ' else 'Zapisano wpis: ' end || entry_row.entry_type || ' ' || entry_row.amount::text || ' PLN',
    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
    auth.uid()
  );
  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_employee_settlement_entry_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_employee_settlement_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  old_json jsonb := case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end;
  new_json jsonb := case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end;
  row_data public.employee_monthly_settlements%rowtype;
  action_name text;
begin
  row_data := coalesce(NEW, OLD);
  action_name := case
    when TG_OP = 'INSERT' then 'created'
    when TG_OP = 'DELETE' then 'deleted'
    when OLD.status is distinct from NEW.status then 'status_changed'
    else 'recalculated'
  end;
  insert into public.employee_settlement_history (
    organization_id, settlement_id, employee_id, period_month, action, summary,
    before_data, after_data, created_by
  ) values (
    row_data.organization_id,
    case when TG_OP = 'DELETE' then null else row_data.id end,
    row_data.employee_id,
    row_data.period_month,
    action_name,
    case
      when action_name = 'status_changed' then 'Zmiana statusu: ' || OLD.status || ' -> ' || NEW.status
      when action_name = 'created' then 'Utworzono miesieczna karte rozliczeniowa'
      when action_name = 'deleted' then 'Usunieto miesieczna karte rozliczeniowa'
      else 'Przeliczono miesieczna karte rozliczeniowa'
    end,
    old_json,
    new_json,
    auth.uid()
  );
  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_employee_settlement_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_lock_employee_entries_for_closed_month"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  eid uuid := coalesce(NEW.employee_id, OLD.employee_id);
  edate date := coalesce(NEW.entry_date, OLD.entry_date);
begin
  if TG_OP <> 'INSERT' and exists (
    select 1 from public.employee_monthly_settlements s
    where s.employee_id = OLD.employee_id
      and s.period_month = date_trunc('month', OLD.entry_date)::date
      and s.status <> 'draft'
  ) then
    raise exception 'Miesiac jest zatwierdzony. Cofnij karte do wersji roboczej przed zmiana wpisow.';
  end if;
  if TG_OP <> 'DELETE' and exists (
    select 1 from public.employee_monthly_settlements s
    where s.employee_id = NEW.employee_id
      and s.period_month = date_trunc('month', NEW.entry_date)::date
      and s.status <> 'draft'
  ) then
    raise exception 'Miesiac jest zatwierdzony. Cofnij karte do wersji roboczej przed zmiana wpisow.';
  end if;
  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_lock_employee_entries_for_closed_month"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_case_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'sprawa', 'created',
      'Nowe zlecenie: ' || NEW.client_name,
      coalesce(NEW.location, ''),
      NEW.id, 'case', NEW.id,
      jsonb_build_object('status', NEW.status)
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.status is distinct from NEW.status then
      perform public.log_organization_activity(
        NEW.organization_id, 'sprawa', 'status_changed',
        'Status: «' || OLD.status || '» → «' || NEW.status || '»',
        'Sprawa: ' || NEW.client_name,
        NEW.id, 'case', NEW.id,
        jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status)
      );
    end if;
    if OLD.estimated_value is distinct from NEW.estimated_value then
      perform public.log_organization_activity(
        NEW.organization_id, 'sprawa', 'value_changed',
        'Zmiana szacowanej wartości sprawy',
        NEW.client_name || ': ' || coalesce(OLD.estimated_value::text, '—') || ' → ' || coalesce(NEW.estimated_value::text, '—'),
        NEW.id, 'case', NEW.id, null
      );
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    perform public.log_organization_activity(
      OLD.organization_id, 'sprawa', 'deleted',
      'Usunięto sprawę: ' || OLD.client_name,
      coalesce(OLD.location, ''),
      null, 'case', OLD.id,
      jsonb_build_object('status', OLD.status)
    );
    return OLD;
  end if;

  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_log_case_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_case_assignee_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  c_org uuid;
  cname text;
  uemail text;
begin
  select c.organization_id, c.client_name into c_org, cname
  from public.cases c where c.id = coalesce(NEW.case_id, OLD.case_id);

  -- Sprawa mogła zostać już usunięta w tej samej transakcji (kaskadowe
  -- kasowanie case_assignees przy DELETE FROM cases) — wtedy nie da się
  -- ustalić organization_id i pomijamy wpis zamiast blokować usunięcie.
  if c_org is null then
    return coalesce(NEW, OLD);
  end if;

  select u.email::text into uemail from auth.users u where u.id = coalesce(NEW.user_id, OLD.user_id);

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      c_org, 'przypisanie', 'assigned',
      'Przypisano do sprawy: ' || coalesce(cname, '?'),
      coalesce(uemail, 'użytkownik'),
      NEW.case_id, 'case_assignee', NEW.user_id, null
    );
  elsif TG_OP = 'DELETE' then
    perform public.log_organization_activity(
      c_org, 'przypisanie', 'unassigned',
      'Usunięto z sprawy: ' || coalesce(cname, '?'),
      coalesce(uemail, 'użytkownik'),
      OLD.case_id, 'case_assignee', OLD.user_id, null
    );
  end if;

  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_log_case_assignee_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_case_commercial_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  case_name text;
begin
  if TG_OP = 'UPDATE' and OLD.estimated_value is not distinct from NEW.estimated_value then
    return NEW;
  end if;
  if TG_OP = 'INSERT' and NEW.estimated_value is null then
    return NEW;
  end if;

  select client_name into case_name from public.cases where id = NEW.case_id;
  perform public.log_organization_activity(
    NEW.organization_id,
    'sprawa',
    case when TG_OP = 'INSERT' then 'value_set' else 'value_changed' end,
    case when TG_OP = 'INSERT' then 'Ustawienie szacowanej wartości sprawy' else 'Zmiana szacowanej wartości sprawy' end,
    coalesce(case_name, 'Sprawa') || ': '
      || case when TG_OP = 'INSERT' then '' else coalesce(OLD.estimated_value::text, '—') || ' → ' end
      || coalesce(NEW.estimated_value::text, '—'),
    NEW.case_id,
    'case',
    NEW.case_id,
    null,
    NEW.updated_by
  );
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_case_commercial_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_case_direct_cost_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cname text;
begin
  if TG_OP = 'INSERT' then
    select client_name into cname from public.cases where id = NEW.case_id;
    perform public.log_organization_activity(
      NEW.organization_id, 'rentownosc', 'direct_cost_created',
      'Dodano koszt budowy: ' || NEW.title,
      NEW.amount::text || ' PLN · ' || NEW.cost_type || ' · ' || coalesce(cname, 'budowa'),
      NEW.case_id, 'case_direct_cost', NEW.id,
      jsonb_build_object('amount', NEW.amount, 'cost_type', NEW.cost_type),
      NEW.created_by
    );
    return NEW;
  elsif TG_OP = 'UPDATE' and (OLD.amount is distinct from NEW.amount or OLD.cost_type is distinct from NEW.cost_type or OLD.title is distinct from NEW.title) then
    select client_name into cname from public.cases where id = NEW.case_id;
    perform public.log_organization_activity(
      NEW.organization_id, 'rentownosc', 'direct_cost_updated',
      'Zmieniono koszt budowy: ' || NEW.title,
      OLD.amount::text || ' -> ' || NEW.amount::text || ' PLN · ' || OLD.cost_type || ' -> ' || NEW.cost_type,
      NEW.case_id, 'case_direct_cost', NEW.id,
      jsonb_build_object('old_amount', OLD.amount, 'new_amount', NEW.amount, 'old_type', OLD.cost_type, 'new_type', NEW.cost_type)
    );
    return NEW;
  elsif TG_OP = 'DELETE' then
    -- Uwaga: NIE przekazujemy tu OLD.case_id — jeśli koszt jest kasowany
    -- kaskadowo razem ze sprawą, ta sprawa już nie istnieje i wstawienie
    -- takiego case_id do organization_activity_log naruszyłoby klucz obcy.
    select client_name into cname from public.cases where id = OLD.case_id;
    perform public.log_organization_activity(
      OLD.organization_id, 'rentownosc', 'direct_cost_deleted',
      'Usunieto koszt budowy: ' || OLD.title,
      OLD.amount::text || ' PLN · ' || OLD.cost_type || ' · ' || coalesce(cname, 'budowa'),
      null, 'case_direct_cost', OLD.id,
      jsonb_build_object('amount', OLD.amount, 'cost_type', OLD.cost_type)
    );
    return OLD;
  end if;
  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_log_case_direct_cost_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_case_profitability_plan_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cname text;
  old_cost numeric;
  new_cost numeric;
begin
  select client_name into cname from public.cases where id = NEW.case_id;
  new_cost := coalesce(NEW.planned_material_cost, 0) + coalesce(NEW.planned_labor_cost, 0) +
    coalesce(NEW.planned_subcontractor_cost, 0) + coalesce(NEW.planned_equipment_cost, 0) +
    coalesce(NEW.planned_transport_cost, 0) + coalesce(NEW.planned_other_cost, 0);

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'rentownosc', 'profitability_plan_created',
      'Utworzono plan rentownosci: ' || coalesce(cname, 'budowa'),
      'Przychod: ' || NEW.planned_revenue::text || ' PLN · koszty plan: ' || new_cost::text || ' PLN · postep: ' || NEW.progress_pct::text || '%',
      NEW.case_id, 'case_profitability_plan', NEW.id,
      jsonb_build_object('planned_revenue', NEW.planned_revenue, 'planned_cost', new_cost, 'progress_pct', NEW.progress_pct),
      NEW.created_by
    );
    return NEW;
  end if;

  old_cost := coalesce(OLD.planned_material_cost, 0) + coalesce(OLD.planned_labor_cost, 0) +
    coalesce(OLD.planned_subcontractor_cost, 0) + coalesce(OLD.planned_equipment_cost, 0) +
    coalesce(OLD.planned_transport_cost, 0) + coalesce(OLD.planned_other_cost, 0);

  if TG_OP = 'UPDATE' and (
    OLD.planned_revenue is distinct from NEW.planned_revenue
    or old_cost is distinct from new_cost
    or OLD.progress_pct is distinct from NEW.progress_pct
    or OLD.contingency_pct is distinct from NEW.contingency_pct
  ) then
    perform public.log_organization_activity(
      NEW.organization_id, 'rentownosc', 'profitability_plan_updated',
      'Zmieniono plan rentownosci: ' || coalesce(cname, 'budowa'),
      'Przychod: ' || OLD.planned_revenue::text || ' -> ' || NEW.planned_revenue::text ||
        ' PLN · koszty: ' || old_cost::text || ' -> ' || new_cost::text ||
        ' PLN · postep: ' || OLD.progress_pct::text || '% -> ' || NEW.progress_pct::text || '%',
      NEW.case_id, 'case_profitability_plan', NEW.id,
      jsonb_build_object(
        'old_planned_revenue', OLD.planned_revenue, 'new_planned_revenue', NEW.planned_revenue,
        'old_planned_cost', old_cost, 'new_planned_cost', new_cost,
        'old_progress_pct', OLD.progress_pct, 'new_progress_pct', NEW.progress_pct
      )
    );
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_case_profitability_plan_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_case_task_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cname text;
begin
  if NEW.case_id is not null then
    select client_name into cname from public.cases where id = NEW.case_id;
  end if;

  if TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status = 'zrobione' then
    perform public.log_organization_activity(
      NEW.organization_id, 'zadanie', 'completed',
      'Zadanie ukończone: ' || left(NEW.title, 80),
      coalesce(cname, 'bez sprawy'),
      NEW.case_id, 'case_task', NEW.id, null
    );
  end if;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_case_task_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_employee_compensation_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare employee_name text;
declare log_id uuid;
begin
  select full_name into employee_name from public.employee_profiles where id = NEW.employee_id;
  if TG_OP = 'UPDATE' and
     OLD.hourly_rate is not distinct from NEW.hourly_rate and
     OLD.day_rate is not distinct from NEW.day_rate and
     OLD.monthly_salary is not distinct from NEW.monthly_salary then
    return NEW;
  end if;
  log_id := public.log_organization_activity(
    NEW.organization_id, 'hr', 'employee_compensation_changed',
    'Zmieniono stawki pracownika: ' || coalesce(employee_name, 'pracownik'),
    'Zmieniono poufne dane wynagrodzenia', null, 'employee_compensation', NEW.employee_id,
    jsonb_build_object('changed', true), coalesce(NEW.updated_by, NEW.created_by, auth.uid())
  );
  update public.organization_activity_log set data_scope = 'payroll' where id = log_id;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_employee_compensation_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_employee_crew_history_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  employee_name text;
  crew_name text;
begin
  select full_name into employee_name from public.employee_profiles where id = NEW.employee_id;
  select name into crew_name from public.crews where id = NEW.crew_id;
  perform public.log_organization_activity(
    NEW.organization_id, 'hr', 'employee_crew_changed',
    'Zmiana brygady: ' || coalesce(employee_name, 'pracownik'),
    coalesce(crew_name, 'bez brygady') || ' · od ' || NEW.valid_from::text,
    null, 'employee_crew_history', NEW.id,
    jsonb_build_object('crew_id', NEW.crew_id, 'crew_name', crew_name),
    NEW.created_by
  );
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_employee_crew_history_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_employee_document_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  employee_name text;
begin
  if TG_OP = 'INSERT' then
    select full_name into employee_name from public.employee_profiles where id = NEW.employee_id;
    perform public.log_organization_activity(
      NEW.organization_id, 'hr', 'employee_document_created',
      'Dodano dokument HR: ' || coalesce(employee_name, 'pracownik'),
      NEW.title || case when NEW.valid_until is not null then ' · wazny do ' || NEW.valid_until::text else '' end,
      null, 'employee_document', NEW.id,
      jsonb_build_object('document_type', NEW.document_type, 'valid_until', NEW.valid_until, 'requires_renewal', NEW.requires_renewal),
      NEW.created_by
    );
    return NEW;
  elsif TG_OP = 'UPDATE' and (OLD.valid_until is distinct from NEW.valid_until or OLD.status is distinct from NEW.status or OLD.title is distinct from NEW.title) then
    select full_name into employee_name from public.employee_profiles where id = NEW.employee_id;
    perform public.log_organization_activity(
      NEW.organization_id, 'hr', 'employee_document_updated',
      'Zmieniono dokument HR: ' || coalesce(employee_name, 'pracownik'),
      OLD.title || ' -> ' || NEW.title || ' · termin: ' || coalesce(OLD.valid_until::text, 'brak') || ' -> ' || coalesce(NEW.valid_until::text, 'brak') ||
        case when OLD.status is distinct from NEW.status then ' · status: ' || OLD.status || ' -> ' || NEW.status else '' end,
      null, 'employee_document', NEW.id,
      jsonb_build_object('old_valid_until', OLD.valid_until, 'new_valid_until', NEW.valid_until, 'old_status', OLD.status, 'new_status', NEW.status)
    );
    return NEW;
  elsif TG_OP = 'DELETE' then
    select full_name into employee_name from public.employee_profiles where id = OLD.employee_id;
    perform public.log_organization_activity(
      OLD.organization_id, 'hr', 'employee_document_deleted',
      'Usunieto dokument HR: ' || coalesce(employee_name, 'pracownik'),
      OLD.title || case when OLD.valid_until is not null then ' · wazny do ' || OLD.valid_until::text else '' end,
      null, 'employee_document', OLD.id,
      jsonb_build_object('document_type', OLD.document_type, 'valid_until', OLD.valid_until)
    );
    return OLD;
  end if;
  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_log_employee_document_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_employee_monthly_settlement_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  employee_name text;
begin
  select full_name into employee_name from public.employee_profiles where id = coalesce(NEW.employee_id, OLD.employee_id);
  perform public.log_organization_activity(
    coalesce(NEW.organization_id, OLD.organization_id),
    'rozliczenia',
    case when TG_OP = 'INSERT' then 'created' when OLD.status is distinct from NEW.status then 'status_changed' else 'recalculated' end,
    coalesce(employee_name, 'Pracownik') || ' - ' || to_char(coalesce(NEW.period_month, OLD.period_month), 'MM/YYYY'),
    case when TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status
      then 'Status: ' || OLD.status || ' -> ' || NEW.status
      else 'Do wyplaty: ' || coalesce(NEW.amount_due, OLD.amount_due)::text || ' PLN'
    end,
    null, 'employee_monthly_settlement', coalesce(NEW.id, OLD.id), null
  );
  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_log_employee_monthly_settlement_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_employee_position_history_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  employee_name text;
  manager_name text;
begin
  select full_name into employee_name from public.employee_profiles where id = NEW.employee_id;
  if NEW.manager_employee_id is not null then
    select full_name into manager_name from public.employee_profiles where id = NEW.manager_employee_id;
  end if;
  perform public.log_organization_activity(
    NEW.organization_id, 'hr', 'employee_position_changed',
    'Zmiana stanowiska: ' || coalesce(employee_name, 'pracownik'),
    NEW.role_title || ' · ' || NEW.department || case when manager_name is not null then ' · przelozony: ' || manager_name else '' end ||
      ' · od ' || NEW.valid_from::text,
    null, 'employee_position_history', NEW.id,
    jsonb_build_object('role_title', NEW.role_title, 'department', NEW.department, 'employment_type', NEW.employment_type, 'manager_employee_id', NEW.manager_employee_id),
    NEW.created_by
  );
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_employee_position_history_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_employee_profile_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if current_setting('app.hr_compliance_from_document', true) = 'true' then return NEW; end if;
  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'hr', 'employee_created', 'Dodano pracownika: ' || NEW.full_name,
      NEW.role_title || ' · ' || NEW.department || case when NEW.has_system_access then ' · ma dostep do systemu' else ' · bez dostepu' end,
      null, 'employee_profile', NEW.id,
      jsonb_build_object('department', NEW.department, 'role_title', NEW.role_title, 'has_system_access', NEW.has_system_access), NEW.created_by
    );
  elsif TG_OP = 'UPDATE' then
    if OLD.active = true and NEW.active = false then
      perform public.log_organization_activity(NEW.organization_id, 'hr', 'employee_archived', 'Zarchiwizowano pracownika: ' || NEW.full_name, NEW.role_title || ' · ' || NEW.department, null, 'employee_profile', NEW.id, null);
    elsif OLD.has_system_access is distinct from NEW.has_system_access or OLD.user_id is distinct from NEW.user_id then
      perform public.log_organization_activity(NEW.organization_id, 'hr', 'employee_access_changed', 'Zmieniono dostep pracownika: ' || NEW.full_name, case when NEW.has_system_access then 'Przyznano dostep do systemu' else 'Odebrano/odlaczono dostep do systemu' end, null, 'employee_profile', NEW.id, jsonb_build_object('old_has_access', OLD.has_system_access, 'new_has_access', NEW.has_system_access));
    elsif OLD.bhp_valid_until is distinct from NEW.bhp_valid_until or OLD.medical_valid_until is distinct from NEW.medical_valid_until then
      perform public.log_organization_activity(NEW.organization_id, 'hr', 'employee_compliance_changed', 'Zmieniono terminy HR: ' || NEW.full_name, 'BHP: ' || coalesce(OLD.bhp_valid_until::text, 'brak') || ' -> ' || coalesce(NEW.bhp_valid_until::text, 'brak') || ' · badania: ' || coalesce(OLD.medical_valid_until::text, 'brak') || ' -> ' || coalesce(NEW.medical_valid_until::text, 'brak'), null, 'employee_profile', NEW.id, null);
    end if;
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_employee_profile_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_equipment_assignment_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  ename text;
  cname text;
begin
  select e.name into ename from public.equipment e where e.id = coalesce(NEW.equipment_id, OLD.equipment_id);
  if coalesce(NEW.case_id, OLD.case_id) is not null then
    select client_name into cname from public.cases where id = coalesce(NEW.case_id, OLD.case_id);
  end if;

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'sprzet', 'assigned',
      'Wydano sprzęt: ' || coalesce(ename, '?'),
      NEW.quantity::text || ' szt.' || case when cname is not null then ' · ' || cname else coalesce(' · ' || NEW.site_label, '') end,
      NEW.case_id, 'equipment_assignment', NEW.id, null, NEW.created_by
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and OLD.returned = false and NEW.returned = true then
    perform public.log_organization_activity(
      NEW.organization_id, 'sprzet', 'returned',
      'Zwrot sprzętu: ' || coalesce(ename, '?'),
      coalesce(cname, coalesce(NEW.site_label, '')),
      NEW.case_id, 'equipment_assignment', NEW.id, null
    );
    return NEW;
  end if;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_equipment_assignment_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_extra_work_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cname text;
begin
  select client_name into cname from public.cases where id = coalesce(NEW.case_id, OLD.case_id);

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'prace_dodatkowe', 'created',
      'Praca dodatkowa: ' || left(NEW.description, 80),
      NEW.line_total::text || ' zł' || case when cname is not null then ' · ' || cname else '' end,
      NEW.case_id, 'extra_work', NEW.id, null
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and OLD.accepted = false and NEW.accepted = true then
    perform public.log_organization_activity(
      NEW.organization_id, 'prace_dodatkowe', 'accepted',
      'Zaakceptowano pracę dodatkową',
      left(NEW.description, 120) || ' · ' || NEW.line_total::text || ' zł',
      NEW.case_id, 'extra_work', NEW.id, null
    );
  end if;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_extra_work_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_invoice_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cname text;
begin
  select client_name into cname from public.cases where id = coalesce(NEW.case_id, OLD.case_id);

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'faktura', 'created',
      'Utworzono fakturę ' || NEW.number,
      coalesce(cname, ''),
      NEW.case_id, 'invoice', NEW.id,
      jsonb_build_object('kind', NEW.kind, 'status', NEW.status)
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.status is distinct from NEW.status then
      perform public.log_organization_activity(
        NEW.organization_id, 'faktura', 'status_changed',
        'Faktura ' || NEW.number || ': ' || OLD.status || ' → ' || NEW.status,
        coalesce(cname, ''),
        NEW.case_id, 'invoice', NEW.id, null
      );
    end if;
    if OLD.sent_at is null and NEW.sent_at is not null then
      perform public.log_organization_activity(
        NEW.organization_id, 'faktura', 'email_sent',
        'Wysłano fakturę ' || NEW.number || ' e-mailem',
        coalesce(NEW.sent_to, ''),
        NEW.case_id, 'invoice', NEW.id, null
      );
    end if;
    return NEW;
  end if;

  return OLD;
end;
$$;


ALTER FUNCTION "public"."trg_log_invoice_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_organization_profile_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if TG_OP = 'UPDATE' and (
    OLD.offer_legal_name is distinct from NEW.offer_legal_name or
    OLD.offer_nip is distinct from NEW.offer_nip or
    OLD.offer_bank_account is distinct from NEW.offer_bank_account or
    OLD.offer_email is distinct from NEW.offer_email or
    OLD.accountant_email is distinct from NEW.accountant_email
  ) then
    perform public.log_organization_activity(
      NEW.id, 'firma', 'profile_updated',
      'Zmieniono dane firmy na ofertach/fakturach',
      'NIP, konto, e-mail lub dane prawne',
      null, 'organization', NEW.id, null
    );
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_organization_profile_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_payment_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cname text;
begin
  select client_name into cname from public.cases where id = coalesce(NEW.case_id, OLD.case_id);

  if TG_OP = 'INSERT' then
    perform public.log_organization_activity(
      NEW.organization_id, 'platnosc', 'created',
      'Nowa płatność: ' || NEW.title,
      'Kwota: ' || NEW.amount_due::text || ' zł' || case when cname is not null then ' · ' || cname else '' end,
      NEW.case_id, 'payment', NEW.id, null
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.amount_paid is distinct from NEW.amount_paid then
      perform public.log_organization_activity(
        NEW.organization_id, 'platnosc', 'payment_received',
        'Wpłata: ' || NEW.title,
        'Wpłacono: ' || OLD.amount_paid::text || ' → ' || NEW.amount_paid::text || ' zł (z ' || NEW.amount_due::text || ')' ||
          case when cname is not null then ' · ' || cname else '' end,
        NEW.case_id, 'payment', NEW.id,
        jsonb_build_object('old_paid', OLD.amount_paid, 'new_paid', NEW.amount_paid)
      );
    elsif OLD.amount_due is distinct from NEW.amount_due then
      perform public.log_organization_activity(
        NEW.organization_id, 'platnosc', 'amount_changed',
        'Zmiana kwoty: ' || NEW.title,
        OLD.amount_due::text || ' → ' || NEW.amount_due::text || ' zł',
        NEW.case_id, 'payment', NEW.id, null
      );
    end if;
    return NEW;
  end if;

  return OLD;
end;
$$;


ALTER FUNCTION "public"."trg_log_payment_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_subcontractor_settlement_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  sub_name text;
  cname text;
begin
  if TG_OP = 'INSERT' then
    select name into sub_name from public.subcontractors where id = NEW.subcontractor_id;
    if NEW.case_id is not null then
      select client_name into cname from public.cases where id = NEW.case_id;
    end if;
    perform public.log_organization_activity(
      NEW.organization_id, 'rozliczenia', 'subcontractor_settlement_created',
      'Rozliczenie podwykonawcy: ' || coalesce(sub_name, NEW.title, 'podwykonawca'),
      NEW.amount::text || ' PLN · ' || NEW.entry_type || case when cname is not null then ' · ' || cname else '' end,
      NEW.case_id, 'subcontractor_settlement_entry', NEW.id,
      jsonb_build_object('amount', NEW.amount, 'entry_type', NEW.entry_type),
      NEW.created_by
    );
    return NEW;
  elsif TG_OP = 'UPDATE' and (OLD.amount is distinct from NEW.amount or OLD.entry_type is distinct from NEW.entry_type or OLD.case_id is distinct from NEW.case_id) then
    select name into sub_name from public.subcontractors where id = NEW.subcontractor_id;
    if NEW.case_id is not null then
      select client_name into cname from public.cases where id = NEW.case_id;
    end if;
    perform public.log_organization_activity(
      NEW.organization_id, 'rozliczenia', 'subcontractor_settlement_updated',
      'Zmieniono rozliczenie podwykonawcy: ' || coalesce(sub_name, NEW.title, 'podwykonawca'),
      OLD.amount::text || ' -> ' || NEW.amount::text || ' PLN · ' || OLD.entry_type || ' -> ' || NEW.entry_type,
      NEW.case_id, 'subcontractor_settlement_entry', NEW.id,
      jsonb_build_object('old_amount', OLD.amount, 'new_amount', NEW.amount, 'old_type', OLD.entry_type, 'new_type', NEW.entry_type)
    );
  end if;
  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_log_subcontractor_settlement_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_supplier_invoice_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cname text;
  amount numeric;
begin
  if TG_OP = 'INSERT' then
    if NEW.case_id is not null then
      select client_name into cname from public.cases where id = NEW.case_id;
    end if;
    if NEW.import_batch_id is null then
      perform public.log_organization_activity(
        NEW.organization_id, 'rentownosc', 'supplier_invoice_created',
        'Dodano fakture kosztowa: ' || NEW.supplier_name,
        coalesce(NEW.invoice_number, 'bez numeru') || ' · ' || NEW.gross_total::text || ' PLN' ||
          case when cname is not null then ' · ' || cname else ' · bez przypisania do sprawy' end,
        NEW.case_id, 'supplier_invoice', NEW.id,
        jsonb_build_object('category', NEW.category, 'gross_total', NEW.gross_total, 'status', NEW.status, 'source', NEW.source),
        NEW.created_by
      );
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.case_id is not null then
      select client_name into cname from public.cases where id = NEW.case_id;
    end if;
    amount := coalesce(NEW.gross_total, 0) - coalesce(OLD.gross_total, 0);
    if OLD.gross_total is distinct from NEW.gross_total
      or OLD.category is distinct from NEW.category
      or OLD.case_id is distinct from NEW.case_id
      or OLD.status is distinct from NEW.status then
      perform public.log_organization_activity(
        NEW.organization_id, 'rentownosc', 'supplier_invoice_updated',
        'Zmieniono fakture kosztowa: ' || NEW.supplier_name,
        'Kwota: ' || OLD.gross_total::text || ' -> ' || NEW.gross_total::text || ' PLN · kategoria: ' ||
          OLD.category || ' -> ' || NEW.category || case when cname is not null then ' · ' || cname else '' end,
        NEW.case_id, 'supplier_invoice', NEW.id,
        jsonb_build_object(
          'old_gross_total', OLD.gross_total, 'new_gross_total', NEW.gross_total,
          'delta', amount, 'old_category', OLD.category, 'new_category', NEW.category,
          'old_status', OLD.status, 'new_status', NEW.status
        )
      );
    end if;
    if OLD.sent_at is null and NEW.sent_at is not null then
      perform public.log_organization_activity(
        NEW.organization_id, 'rentownosc', 'supplier_invoice_email_sent',
        'Wyslano fakture kosztowa do ksiegowosci',
        NEW.supplier_name || ' · ' || coalesce(NEW.sent_to, 'adres ksiegowosci'),
        NEW.case_id, 'supplier_invoice', NEW.id,
        jsonb_build_object('sent_to', NEW.sent_to)
      );
    end if;
    return NEW;
  end if;

  return OLD;
end;
$$;


ALTER FUNCTION "public"."trg_log_supplier_invoice_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_supplier_invoice_import_batch_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.log_organization_activity(
    NEW.organization_id, 'rentownosc', 'supplier_invoice_imported',
    'Import faktur kosztowych: ' || coalesce(NEW.file_name, NEW.source),
    'Zaimportowano: ' || NEW.row_count::text || ' · duplikaty pominiete: ' || NEW.duplicate_count::text,
    null, 'supplier_invoice_import_batch', NEW.id,
    jsonb_build_object('source', NEW.source, 'row_count', NEW.row_count, 'duplicate_count', NEW.duplicate_count),
    NEW.created_by
  );
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_supplier_invoice_import_batch_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_warehouse_audit_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.log_organization_activity(
    NEW.organization_id, 'magazyn', NEW.action,
    case NEW.action
      when 'item_created' then 'Nowa pozycja magazynowa: ' || NEW.label
      when 'items_imported' then 'Import z katalogu: ' || NEW.label
      when 'min_quantity_changed' then 'Zmiana stanu min.: ' || NEW.label
      else NEW.label
    end,
    NEW.details,
    null, 'warehouse_item', NEW.warehouse_item_id, null, NEW.created_by
  );
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_warehouse_audit_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_warehouse_movement_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  lbl text;
  cname text;
begin
  select wi.label into lbl from public.warehouse_items wi where wi.id = NEW.warehouse_item_id;
  if NEW.case_id is not null then
    select client_name into cname from public.cases where id = NEW.case_id;
  end if;

  perform public.log_organization_activity(
    NEW.organization_id, 'magazyn',
    case when NEW.movement_type = 'in' then 'stock_in' else 'stock_out' end,
    case when NEW.movement_type = 'in' then 'Przyjęcie na magazyn' else 'Zużycie z magazynu' end || ': ' || coalesce(lbl, '?'),
    (case when NEW.movement_type = 'in' then '+' else '−' end) || NEW.quantity::text ||
      case when cname is not null then ' · zlecenie: ' || cname else '' end ||
      case when NEW.note is not null and NEW.note <> '' then ' · ' || NEW.note else '' end,
    NEW.case_id, 'warehouse_movement', NEW.id, null, NEW.created_by
  );
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_log_warehouse_movement_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_log_work_hours_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cname text;
  scope text;
begin
  if coalesce(NEW.case_id, OLD.case_id) is not null then
    select client_name into cname from public.cases where id = coalesce(NEW.case_id, OLD.case_id);
  end if;
  scope := coalesce(cname, coalesce(NEW.site_label, OLD.site_label, 'budowa'));

  if TG_OP = 'INSERT' and coalesce(NEW.hours, 0) > 0 then
    perform public.log_organization_activity(
      NEW.organization_id, 'czas', 'hours_logged',
      'Godziny: ' || NEW.worker_name,
      NEW.hours::text || ' h · ' || scope || ' · ' || NEW.work_date::text,
      NEW.case_id, 'work_hour', NEW.id, null, NEW.created_by
    );
  elsif TG_OP = 'UPDATE' and OLD.hours is distinct from NEW.hours then
    perform public.log_organization_activity(
      NEW.organization_id, 'czas', 'hours_changed',
      'Korekta godzin: ' || NEW.worker_name,
      OLD.hours::text || ' → ' || NEW.hours::text || ' h · ' || scope || ' · ' || NEW.work_date::text,
      NEW.case_id, 'work_hour', NEW.id, null
    );
  elsif TG_OP = 'DELETE' then
    perform public.log_organization_activity(
      OLD.organization_id, 'czas', 'hours_deleted',
      'Usunięto wpis godzin: ' || OLD.worker_name,
      OLD.hours::text || ' h · ' || scope || ' · ' || OLD.work_date::text,
      OLD.case_id, 'work_hour', OLD.id, null
    );
    return OLD;
  end if;

  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_log_work_hours_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_refresh_employee_compliance_dates"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if current_setting('app.hr_migration_seed', true) = 'true' then return coalesce(NEW, OLD); end if;
  perform public.refresh_employee_compliance_dates(coalesce(NEW.employee_id, OLD.employee_id));
  if TG_OP = 'UPDATE' and OLD.employee_id is distinct from NEW.employee_id then
    perform public.refresh_employee_compliance_dates(OLD.employee_id);
  end if;
  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_refresh_employee_compliance_dates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_sync_profile_compliance_documents"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if current_setting('app.hr_compliance_from_document', true) = 'true' then return NEW; end if;
  if OLD.bhp_valid_until is distinct from NEW.bhp_valid_until then
    if NEW.bhp_valid_until is null then
      delete from public.employee_documents where employee_id = NEW.id and source_key = 'profile_bhp';
    else
      insert into public.employee_documents (
        organization_id, employee_id, document_type, title, valid_until, requires_renewal, source_key, created_by
      ) values (
        NEW.organization_id, NEW.id, 'bhp', 'Szkolenie BHP', NEW.bhp_valid_until, true, 'profile_bhp', auth.uid()
      ) on conflict (employee_id, source_key) where source_key is not null do update
      set valid_until = excluded.valid_until, status = 'active';
    end if;
  end if;
  if OLD.medical_valid_until is distinct from NEW.medical_valid_until then
    if NEW.medical_valid_until is null then
      delete from public.employee_documents where employee_id = NEW.id and source_key = 'profile_medical';
    else
      insert into public.employee_documents (
        organization_id, employee_id, document_type, title, valid_until, requires_renewal, source_key, created_by
      ) values (
        NEW.organization_id, NEW.id, 'medical', 'Badania lekarskie', NEW.medical_valid_until, true, 'profile_medical', auth.uid()
      ) on conflict (employee_id, source_key) where source_key is not null do update
      set valid_until = excluded.valid_until, status = 'active';
    end if;
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_sync_profile_compliance_documents"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_touch_ai_conversation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.ai_conversations
  set last_message_at = NEW.created_at, updated_at = now()
  where id = NEW.conversation_id;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_touch_ai_conversation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uuid_or_null"("value" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
begin
  return value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;


ALTER FUNCTION "public"."uuid_or_null"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_equipment_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  equipment_org uuid;
  equipment_total numeric;
  already_assigned numeric;
  is_manager boolean;
begin
  select organization_id, total_quantity
  into equipment_org, equipment_total
  from public.equipment
  where id = NEW.equipment_id
  for update;

  if equipment_org is null or equipment_org <> NEW.organization_id then
    raise exception 'Sprzęt nie należy do organizacji';
  end if;

  is_manager := public.can_see_all_cases(NEW.organization_id);
  if TG_OP = 'UPDATE' and not is_manager and (
    NEW.organization_id is distinct from OLD.organization_id
    or NEW.equipment_id is distinct from OLD.equipment_id
    or NEW.case_id is distinct from OLD.case_id
    or NEW.site_label is distinct from OLD.site_label
    or NEW.quantity is distinct from OLD.quantity
    or NEW.assigned_date is distinct from OLD.assigned_date
    or NEW.created_by is distinct from OLD.created_by
  ) then
    raise exception 'Rola operacyjna może wyłącznie oznaczyć zwrot sprzętu';
  end if;

  if TG_OP = 'INSERT' then
    NEW.created_by := auth.uid();
    if NEW.case_id is null and nullif(trim(coalesce(NEW.site_label, '')), '') is null then
      raise exception 'Wybierz sprawę albo podaj miejsce wydania';
    end if;
    if NEW.case_id is not null and not exists (
      select 1 from public.cases c
      where c.id = NEW.case_id
        and c.organization_id = NEW.organization_id
        and (
          public.can_see_all_cases(c.organization_id)
          or c.created_by = auth.uid()
          or public.is_case_assignee(c.id)
        )
    ) then
      raise exception 'Brak dostępu do wskazanej sprawy';
    end if;

    select coalesce(sum(quantity), 0)
    into already_assigned
    from public.equipment_assignments
    where equipment_id = NEW.equipment_id
      and returned = false;
    if already_assigned + NEW.quantity > equipment_total then
      raise exception 'Niewystarczająca dostępna ilość sprzętu';
    end if;
  end if;

  if NEW.returned and NEW.returned_date is null then
    NEW.returned_date := current_date;
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."validate_equipment_assignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_supplier_invoice_settlement_link"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  settlement_org uuid;
  settlement_case uuid;
  settlement_subcontractor uuid;
begin
  if NEW.linked_settlement_entry_id is null then
    return NEW;
  end if;
  if NEW.category <> 'podwykonawca' then
    raise exception 'Powiązanie z rozliczeniem jest dostępne tylko dla kosztu podwykonawcy';
  end if;

  select organization_id, case_id, subcontractor_id
  into settlement_org, settlement_case, settlement_subcontractor
  from public.subcontractor_settlement_entries
  where id = NEW.linked_settlement_entry_id;

  if settlement_org is null
    or settlement_org <> NEW.organization_id
    or settlement_case is distinct from NEW.case_id
    or settlement_subcontractor is distinct from NEW.subcontractor_id then
    raise exception 'Faktura i rozliczenie muszą dotyczyć tej samej organizacji, sprawy i podwykonawcy';
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."validate_supplier_invoice_settlement_link"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_warehouse_movement"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  item_org uuid;
  available numeric;
begin
  select organization_id, quantity
  into item_org, available
  from public.warehouse_items
  where id = NEW.warehouse_item_id
  for update;

  if item_org is null or item_org <> NEW.organization_id then
    raise exception 'Pozycja magazynowa nie należy do organizacji';
  end if;
  if NEW.movement_type = 'out' and NEW.quantity > available then
    raise exception 'Niewystarczający stan magazynowy';
  end if;
  NEW.created_by := auth.uid();
  return NEW;
end;
$$;


ALTER FUNCTION "public"."validate_warehouse_movement"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."warehouse_movement_set_created_by"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if NEW.created_by is null then
    NEW.created_by := auth.uid();
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."warehouse_movement_set_created_by"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ai_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "context_type" "text" DEFAULT 'global'::"text" NOT NULL,
    "title" "text" DEFAULT 'Nowa rozmowa AI'::"text" NOT NULL,
    "created_by" "uuid",
    "last_message_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_conversations_context_type_check" CHECK (("context_type" = ANY (ARRAY['global'::"text", 'case'::"text"])))
);


ALTER TABLE "public"."ai_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_generated_artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "conversation_id" "uuid",
    "case_id" "uuid",
    "artifact_type" "text" NOT NULL,
    "report_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "storage_path" "text",
    "file_name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_generated_artifacts_artifact_type_check" CHECK (("artifact_type" = ANY (ARRAY['pdf'::"text", 'xlsx'::"text"])))
);


ALTER TABLE "public"."ai_generated_artifacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_message_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "message_id" "uuid",
    "case_id" "uuid",
    "storage_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "mime_type" "text",
    "file_size" bigint DEFAULT 0 NOT NULL,
    "extracted_text" "text",
    "extraction_status" "text" DEFAULT 'ready'::"text" NOT NULL,
    "extraction_error" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_message_attachments_extraction_status_check" CHECK (("extraction_status" = ANY (ARRAY['ready'::"text", 'partial'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."ai_message_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "meta" "jsonb",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."ai_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "mime_type" "text",
    "size_bytes" bigint,
    "category" "text" DEFAULT 'w trakcie'::"text" NOT NULL,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text",
    CONSTRAINT "attachments_category_check" CHECK (("category" = ANY (ARRAY['przed pracami'::"text", 'w trakcie'::"text", 'po zakończeniu'::"text", 'usterki'::"text", 'materiały'::"text", 'projekt'::"text", 'inspiracje'::"text", 'kosztorys zewnętrzny'::"text", 'umowa'::"text", 'aneks'::"text", 'protokół'::"text", 'wezwanie do zapłaty'::"text", 'oświadczenie'::"text"]))),
    CONSTRAINT "attachments_size_bytes_check" CHECK ((("size_bytes" IS NULL) OR ("size_bytes" >= 0)))
);


ALTER TABLE "public"."attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_as_built_estimates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "variant_id" "uuid",
    "variant_name" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" DEFAULT 'Kosztorys powykonawczy'::"text" NOT NULL,
    "contract_number" "text",
    "contract_date" "date",
    "settlement_basis" "text",
    "footer_note" "text",
    "net_total" numeric DEFAULT 0 NOT NULL,
    "advances_paid" numeric DEFAULT 0 NOT NULL,
    "balance_due" numeric DEFAULT 0 NOT NULL,
    "line_count" integer DEFAULT 0 NOT NULL,
    "lines_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "size_bytes" bigint,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pdf_work_description" "text",
    CONSTRAINT "case_as_built_estimates_advances_paid_check" CHECK (("advances_paid" >= (0)::numeric)),
    CONSTRAINT "case_as_built_estimates_line_count_check" CHECK (("line_count" >= 0)),
    CONSTRAINT "case_as_built_estimates_net_total_check" CHECK (("net_total" >= (0)::numeric)),
    CONSTRAINT "case_as_built_estimates_size_bytes_check" CHECK ((("size_bytes" IS NULL) OR ("size_bytes" >= 0)))
);


ALTER TABLE "public"."case_as_built_estimates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_assignees" (
    "case_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "assignment_role" "text" DEFAULT 'field'::"text" NOT NULL,
    CONSTRAINT "case_assignees_assignment_role_check" CHECK (("assignment_role" = ANY (ARRAY['lead'::"text", 'field'::"text"])))
);


ALTER TABLE "public"."case_assignees" OWNER TO "postgres";


COMMENT ON COLUMN "public"."case_assignees"."assignment_role" IS 'lead = odpowiedzialny (prowadzący sprawę); field = przypisany do realizacji (teren)';



CREATE TABLE IF NOT EXISTS "public"."case_commercial_details" (
    "case_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "estimated_value" numeric,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "case_commercial_details_estimated_value_check" CHECK ((("estimated_value" IS NULL) OR ("estimated_value" >= (0)::numeric)))
);


ALTER TABLE "public"."case_commercial_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_direct_costs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "cost_type" "text" DEFAULT 'inne'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "cost_date" "date" DEFAULT ("now"())::"date" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_direct_costs_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "case_direct_costs_cost_type_check" CHECK (("cost_type" = ANY (ARRAY['materialy'::"text", 'robocizna'::"text", 'podwykonawcy'::"text", 'transport'::"text", 'sprzet'::"text", 'inne'::"text"])))
);


ALTER TABLE "public"."case_direct_costs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_profitability_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "planned_revenue" numeric DEFAULT 0 NOT NULL,
    "planned_material_cost" numeric DEFAULT 0 NOT NULL,
    "planned_labor_cost" numeric DEFAULT 0 NOT NULL,
    "planned_subcontractor_cost" numeric DEFAULT 0 NOT NULL,
    "planned_equipment_cost" numeric DEFAULT 0 NOT NULL,
    "planned_transport_cost" numeric DEFAULT 0 NOT NULL,
    "planned_other_cost" numeric DEFAULT 0 NOT NULL,
    "contingency_pct" numeric DEFAULT 8 NOT NULL,
    "progress_pct" numeric DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_profitability_plans_contingency_pct_check" CHECK ((("contingency_pct" >= (0)::numeric) AND ("contingency_pct" <= (100)::numeric))),
    CONSTRAINT "case_profitability_plans_planned_equipment_cost_check" CHECK (("planned_equipment_cost" >= (0)::numeric)),
    CONSTRAINT "case_profitability_plans_planned_labor_cost_check" CHECK (("planned_labor_cost" >= (0)::numeric)),
    CONSTRAINT "case_profitability_plans_planned_material_cost_check" CHECK (("planned_material_cost" >= (0)::numeric)),
    CONSTRAINT "case_profitability_plans_planned_other_cost_check" CHECK (("planned_other_cost" >= (0)::numeric)),
    CONSTRAINT "case_profitability_plans_planned_revenue_check" CHECK (("planned_revenue" >= (0)::numeric)),
    CONSTRAINT "case_profitability_plans_planned_subcontractor_cost_check" CHECK (("planned_subcontractor_cost" >= (0)::numeric)),
    CONSTRAINT "case_profitability_plans_planned_transport_cost_check" CHECK (("planned_transport_cost" >= (0)::numeric)),
    CONSTRAINT "case_profitability_plans_progress_pct_check" CHECK ((("progress_pct" >= (0)::numeric) AND ("progress_pct" <= (100)::numeric)))
);


ALTER TABLE "public"."case_profitability_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_protocols" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "protocol_type" "text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_protocols_protocol_type_check" CHECK (("protocol_type" = ANY (ARRAY['po ociepleniu'::"text", 'po siatce'::"text", 'po tynku'::"text", 'odbiór końcowy'::"text", 'prace dodatkowe'::"text"])))
);


ALTER TABLE "public"."case_protocols" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "crew_id" "uuid",
    "client_name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "location" "text",
    "work_description" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'nowe zapytanie'::"text" NOT NULL,
    "source" "text" DEFAULT 'telefon'::"text" NOT NULL,
    "estimated_value" numeric,
    "next_contact_date" "date",
    "realization_end_date" "date",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "contract_number" "text",
    "contract_date" "date",
    CONSTRAINT "cases_estimated_value_moved" CHECK (("estimated_value" IS NULL)),
    CONSTRAINT "cases_source_check" CHECK (("source" = ANY (ARRAY['Google Ads'::"text", 'strona'::"text", 'polecenie'::"text", 'OLX'::"text", 'telefon'::"text", 'mail'::"text", 'WhatsApp'::"text", 'SMS'::"text"]))),
    CONSTRAINT "cases_status_check" CHECK (("status" = ANY (ARRAY['nowe zapytanie'::"text", 'do kontaktu'::"text", 'wysłano pytania'::"text", 'oczekujemy na zdjęcia/projekt'::"text", 'do wyceny'::"text", 'wycena wysłana'::"text", 'do decyzji klienta'::"text", 'umowa do podpisu'::"text", 'zaliczka do wpłaty'::"text", 'termin zarezerwowany'::"text", 'realizacja'::"text", 'odbiór'::"text", 'rozliczone'::"text", 'utracone'::"text"])))
);


ALTER TABLE "public"."cases" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cases"."estimated_value" IS 'Deprecated security placeholder. Financial value is stored in case_commercial_details.';



COMMENT ON COLUMN "public"."cases"."contract_number" IS 'Numer umowy z klientem (np. 01/05) — widoczny na kosztorysie powykonawczym.';



COMMENT ON COLUMN "public"."cases"."contract_date" IS 'Data zawarcia umowy — widoczna na kosztorysie powykonawczym.';



CREATE OR REPLACE VIEW "public"."case_records" WITH ("security_invoker"='true', "security_barrier"='true') AS
 SELECT "c"."id",
    "c"."organization_id",
    "c"."crew_id",
    "c"."client_name",
    "c"."phone",
    "c"."email",
    "c"."location",
    "c"."work_description",
    "c"."status",
    "c"."source",
    "commercial"."estimated_value",
    "c"."next_contact_date",
    "c"."realization_end_date",
    "c"."contract_number",
    "c"."contract_date",
    "c"."created_by",
    "c"."created_at",
    "c"."updated_at"
   FROM ("public"."cases" "c"
     LEFT JOIN "public"."case_commercial_details" "commercial" ON (("commercial"."case_id" = "c"."id")));


ALTER VIEW "public"."case_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_schedule_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "due_date" "date",
    "completed" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."case_schedule_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_subcontractors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "subcontractor_id" "uuid" NOT NULL,
    "scope" "text" DEFAULT ''::"text" NOT NULL,
    "rate" numeric,
    "unit" "text" DEFAULT 'usługa'::"text",
    "agreed_total" numeric,
    "status" "text" DEFAULT 'planowane'::"text" NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_subcontractors_status_check" CHECK (("status" = ANY (ARRAY['planowane'::"text", 'w toku'::"text", 'zakończone'::"text", 'wstrzymane'::"text"]))),
    CONSTRAINT "case_subcontractors_unit_check" CHECK ((("unit" IS NULL) OR ("unit" = ANY (ARRAY['m²'::"text", 'mb'::"text", 'szt.'::"text", 'kpl.'::"text", 'roboczogodz.'::"text", 'usługa'::"text"]))))
);


ALTER TABLE "public"."case_subcontractors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_task_assignees" (
    "task_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."case_task_assignees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_task_comment_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "mime_type" "text",
    "size_bytes" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_task_comment_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_task_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_task_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_task_reads" (
    "organization_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_task_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "assignee_id" "uuid",
    "due_date" "date",
    "priority" "text" DEFAULT 'normalny'::"text" NOT NULL,
    "status" "text" DEFAULT 'do zrobienia'::"text" NOT NULL,
    "created_by" "uuid",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_tasks_priority_check" CHECK (("priority" = ANY (ARRAY['niski'::"text", 'normalny'::"text", 'wysoki'::"text", 'pilne'::"text"]))),
    CONSTRAINT "case_tasks_status_check" CHECK (("status" = ANY (ARRAY['do zrobienia'::"text", 'w toku'::"text", 'zrobione'::"text", 'anulowane'::"text"])))
);


ALTER TABLE "public"."case_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalog_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "default_unit" "text" DEFAULT 'm²'::"text" NOT NULL,
    "category" "text" DEFAULT 'material'::"text" NOT NULL,
    "suggested_rate" numeric,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "catalog_items_category_check" CHECK (("category" = ANY (ARRAY['material'::"text", 'labor'::"text"]))),
    CONSTRAINT "catalog_items_default_unit_check" CHECK (("default_unit" = ANY (ARRAY['m²'::"text", 'mb'::"text", 'szt.'::"text", 'kpl.'::"text", 'roboczogodz.'::"text", 'usługa'::"text"])))
);


ALTER TABLE "public"."catalog_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "policy_type" "text" NOT NULL,
    "policy_number" "text",
    "insurer" "text",
    "coverage_end" "date",
    "payment_due" "date",
    "amount" numeric(14,2),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "company_policies_amount_check" CHECK ((("amount" IS NULL) OR ("amount" >= (0)::numeric)))
);


ALTER TABLE "public"."company_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."crews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."digest_email_prefs" (
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "digest_enabled" boolean DEFAULT false NOT NULL,
    "include_reminders" boolean DEFAULT true NOT NULL,
    "include_overdue_contact" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "include_schedule" boolean DEFAULT true NOT NULL,
    "include_payments" boolean DEFAULT true NOT NULL,
    "include_tasks" boolean DEFAULT true NOT NULL,
    "include_fleet" boolean DEFAULT true NOT NULL,
    "include_warehouse" boolean DEFAULT true NOT NULL,
    "notify_new_case" boolean DEFAULT false NOT NULL,
    "notify_task_comment" boolean DEFAULT true NOT NULL,
    "push_enabled" boolean DEFAULT false NOT NULL,
    "include_profitability_alerts" boolean DEFAULT true NOT NULL,
    "include_cost_invoices" boolean DEFAULT true NOT NULL,
    "include_employee_compliance" boolean DEFAULT true NOT NULL,
    "include_settlements" boolean DEFAULT true NOT NULL,
    "include_stale_cases" boolean DEFAULT true NOT NULL,
    "notify_financial_alerts" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."digest_email_prefs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."digest_email_prefs"."include_schedule" IS 'Digest: etapy harmonogramu po terminie';



COMMENT ON COLUMN "public"."digest_email_prefs"."include_payments" IS 'Digest: płatności po terminie (role zarządcze)';



COMMENT ON COLUMN "public"."digest_email_prefs"."include_tasks" IS 'Digest: zadania po terminie';



COMMENT ON COLUMN "public"."digest_email_prefs"."include_fleet" IS 'Digest: flota i polisy';



COMMENT ON COLUMN "public"."digest_email_prefs"."include_warehouse" IS 'Digest: niski stan magazynu';



COMMENT ON COLUMN "public"."digest_email_prefs"."notify_new_case" IS 'Natychmiastowy mail przy nowym zapytaniu';



COMMENT ON COLUMN "public"."digest_email_prefs"."notify_task_comment" IS 'Natychmiastowy mail gdy ktoś napisze w dyskusji zadania, do którego osoba jest przypisana';



COMMENT ON COLUMN "public"."digest_email_prefs"."push_enabled" IS 'Push PWA/przeglądarka — ustawia sam użytkownik (Powiadomienia lub dzwoneczek)';



COMMENT ON COLUMN "public"."digest_email_prefs"."include_profitability_alerts" IS 'Digest: budowy ze stratą, niska marża, materiały ponad normę';



COMMENT ON COLUMN "public"."digest_email_prefs"."include_cost_invoices" IS 'Digest: faktury kosztowe po terminie i nadchodzące płatności do dostawców';



COMMENT ON COLUMN "public"."digest_email_prefs"."include_employee_compliance" IS 'Digest: terminy BHP i badań lekarskich pracowników';



COMMENT ON COLUMN "public"."digest_email_prefs"."include_settlements" IS 'Digest: duże zaliczki, wypłaty i rozliczenia pracowników/podwykonawców';



COMMENT ON COLUMN "public"."digest_email_prefs"."include_stale_cases" IS 'Digest: aktywne budowy bez aktualizacji przez kilka dni';



COMMENT ON COLUMN "public"."digest_email_prefs"."notify_financial_alerts" IS 'Powiadomienia natychmiastowe: duże koszty, faktury i rozliczenia wpływające na kasę';



CREATE TABLE IF NOT EXISTS "public"."employee_compensation" (
    "employee_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "hourly_rate" numeric,
    "day_rate" numeric,
    "monthly_salary" numeric,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_compensation_day_rate_check" CHECK ((("day_rate" IS NULL) OR ("day_rate" >= (0)::numeric))),
    CONSTRAINT "employee_compensation_hourly_rate_check" CHECK ((("hourly_rate" IS NULL) OR ("hourly_rate" >= (0)::numeric))),
    CONSTRAINT "employee_compensation_monthly_salary_check" CHECK ((("monthly_salary" IS NULL) OR ("monthly_salary" >= (0)::numeric)))
);


ALTER TABLE "public"."employee_compensation" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_crew_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "crew_id" "uuid",
    "valid_from" "date" NOT NULL,
    "valid_until" "date",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_crew_history_check" CHECK ((("valid_until" IS NULL) OR ("valid_until" >= "valid_from")))
);


ALTER TABLE "public"."employee_crew_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "document_number" "text",
    "issued_at" "date",
    "valid_from" "date",
    "valid_until" "date",
    "requires_renewal" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "storage_path" "text",
    "file_name" "text",
    "mime_type" "text",
    "size_bytes" bigint,
    "notes" "text",
    "source_key" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_documents_check" CHECK ((("valid_until" IS NULL) OR ("valid_from" IS NULL) OR ("valid_until" >= "valid_from"))),
    CONSTRAINT "employee_documents_document_type_check" CHECK (("document_type" = ANY (ARRAY['bhp'::"text", 'medical'::"text", 'training'::"text", 'qualification'::"text", 'contract'::"text", 'annex'::"text", 'certificate'::"text", 'other'::"text"]))),
    CONSTRAINT "employee_documents_size_bytes_check" CHECK ((("size_bytes" IS NULL) OR ("size_bytes" >= 0))),
    CONSTRAINT "employee_documents_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."employee_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_monthly_settlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "period_month" "date" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "employment_type_snapshot" "text" NOT NULL,
    "hourly_rate_snapshot" numeric DEFAULT 0 NOT NULL,
    "day_rate_snapshot" numeric DEFAULT 0 NOT NULL,
    "monthly_salary_snapshot" numeric DEFAULT 0 NOT NULL,
    "hours_total" numeric(10,2) DEFAULT 0 NOT NULL,
    "work_days_total" integer DEFAULT 0 NOT NULL,
    "base_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "bonuses_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "reimbursements_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "corrections_plus_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "deductions_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "corrections_minus_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "advances_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "previous_payments_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "gross_earnings" numeric(12,2) DEFAULT 0 NOT NULL,
    "amount_due" numeric(12,2) DEFAULT 0 NOT NULL,
    "final_payment_amount" numeric(12,2),
    "notes" "text",
    "calculated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "paid_at" timestamp with time zone,
    "paid_by" "uuid",
    "closed_at" timestamp with time zone,
    "closed_by" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "piecework_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "piecework_quantity_total" numeric(10,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "employee_monthly_settlements_day_rate_snapshot_check" CHECK (("day_rate_snapshot" >= (0)::numeric)),
    CONSTRAINT "employee_monthly_settlements_hourly_rate_snapshot_check" CHECK (("hourly_rate_snapshot" >= (0)::numeric)),
    CONSTRAINT "employee_monthly_settlements_hours_total_check" CHECK (("hours_total" >= (0)::numeric)),
    CONSTRAINT "employee_monthly_settlements_monthly_salary_snapshot_check" CHECK (("monthly_salary_snapshot" >= (0)::numeric)),
    CONSTRAINT "employee_monthly_settlements_period_month_check" CHECK (("period_month" = ("date_trunc"('month'::"text", ("period_month")::timestamp with time zone))::"date")),
    CONSTRAINT "employee_monthly_settlements_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'approved'::"text", 'paid'::"text", 'closed'::"text"]))),
    CONSTRAINT "employee_monthly_settlements_work_days_total_check" CHECK (("work_days_total" >= 0))
);


ALTER TABLE "public"."employee_monthly_settlements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_piecework_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "quantity" numeric NOT NULL,
    "unit_rate_snapshot" numeric DEFAULT 0 NOT NULL,
    "entry_date" "date" DEFAULT ("now"())::"date" NOT NULL,
    "note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_piecework_entries_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "employee_piecework_entries_unit_rate_snapshot_check" CHECK (("unit_rate_snapshot" >= (0)::numeric))
);


ALTER TABLE "public"."employee_piecework_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_position_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "role_title" "text" NOT NULL,
    "department" "text" NOT NULL,
    "employment_type" "text" NOT NULL,
    "manager_employee_id" "uuid",
    "valid_from" "date" NOT NULL,
    "valid_until" "date",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_position_history_check" CHECK ((("valid_until" IS NULL) OR ("valid_until" >= "valid_from"))),
    CONSTRAINT "employee_position_history_department_check" CHECK (("department" = ANY (ARRAY['zarzad'::"text", 'biuro'::"text", 'handlowcy'::"text", 'kierownicy'::"text", 'brygada'::"text", 'podwykonawcy'::"text", 'bhp'::"text", 'inne'::"text"]))),
    CONSTRAINT "employee_position_history_employment_type_check" CHECK (("employment_type" = ANY (ARRAY['godzinowka'::"text", 'dniowka'::"text", 'etat'::"text", 'ryczalt'::"text", 'b2b'::"text", 'podwykonawca'::"text", 'akord'::"text", 'inne'::"text"])))
);


ALTER TABLE "public"."employee_position_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "crew_id" "uuid",
    "manager_employee_id" "uuid",
    "full_name" "text" NOT NULL,
    "role_title" "text" DEFAULT 'pracownik'::"text" NOT NULL,
    "department" "text" DEFAULT 'realizacja'::"text" NOT NULL,
    "employment_type" "text" DEFAULT 'godzinowka'::"text" NOT NULL,
    "has_system_access" boolean DEFAULT false NOT NULL,
    "phone" "text",
    "email" "text",
    "bhp_valid_until" "date",
    "medical_valid_until" "date",
    "notes" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_profiles_department_check" CHECK (("department" = ANY (ARRAY['zarzad'::"text", 'biuro'::"text", 'handlowcy'::"text", 'kierownicy'::"text", 'brygada'::"text", 'podwykonawcy'::"text", 'bhp'::"text", 'inne'::"text"]))),
    CONSTRAINT "employee_profiles_employment_type_check" CHECK (("employment_type" = ANY (ARRAY['godzinowka'::"text", 'dniowka'::"text", 'etat'::"text", 'ryczalt'::"text", 'b2b'::"text", 'podwykonawca'::"text", 'akord'::"text", 'inne'::"text"])))
);


ALTER TABLE "public"."employee_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_settlement_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "entry_type" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "entry_date" "date" DEFAULT ("now"())::"date" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "direction" "text" DEFAULT 'plus'::"text" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_settlement_entries_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "employee_settlement_entries_direction_check" CHECK (("direction" = ANY (ARRAY['plus'::"text", 'minus'::"text"]))),
    CONSTRAINT "employee_settlement_entries_entry_type_check" CHECK (("entry_type" = ANY (ARRAY['zaliczka'::"text", 'wyplata'::"text", 'premia'::"text", 'potracenie'::"text", 'zwrot_kosztow'::"text", 'korekta'::"text"])))
);


ALTER TABLE "public"."employee_settlement_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_settlement_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "settlement_id" "uuid",
    "employee_id" "uuid" NOT NULL,
    "period_month" "date" NOT NULL,
    "action" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "before_data" "jsonb",
    "after_data" "jsonb",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."employee_settlement_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."equipment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" DEFAULT 'rusztowanie'::"text" NOT NULL,
    "unit" "text" DEFAULT 'szt.'::"text" NOT NULL,
    "total_quantity" numeric DEFAULT 0 NOT NULL,
    "notes" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "equipment_category_check" CHECK (("category" = ANY (ARRAY['rusztowanie'::"text", 'maszyna'::"text", 'narzędzie'::"text", 'sprzęt'::"text", 'inne'::"text"]))),
    CONSTRAINT "equipment_total_quantity_check" CHECK (("total_quantity" >= (0)::numeric))
);


ALTER TABLE "public"."equipment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."equipment_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "equipment_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "site_label" "text",
    "quantity" numeric NOT NULL,
    "assigned_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "returned" boolean DEFAULT false NOT NULL,
    "returned_date" "date",
    "note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "equipment_assignments_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."equipment_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."estimate_template_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "section" "text" NOT NULL,
    "label" "text" NOT NULL,
    "unit" "text" DEFAULT 'm²'::"text" NOT NULL,
    "quantity" numeric DEFAULT 1 NOT NULL,
    "unit_rate" numeric DEFAULT 0 NOT NULL,
    "line_total" numeric GENERATED ALWAYS AS ("round"(("quantity" * "unit_rate"), 2)) STORED,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "estimate_template_lines_quantity_check" CHECK (("quantity" >= (0)::numeric)),
    CONSTRAINT "estimate_template_lines_section_check" CHECK (("section" = ANY (ARRAY['labor'::"text", 'material'::"text"]))),
    CONSTRAINT "estimate_template_lines_unit_check" CHECK (("unit" = ANY (ARRAY['m²'::"text", 'mb'::"text", 'szt.'::"text", 'kpl.'::"text", 'roboczogodz.'::"text", 'usługa'::"text"]))),
    CONSTRAINT "estimate_template_lines_unit_rate_check" CHECK (("unit_rate" >= (0)::numeric))
);


ALTER TABLE "public"."estimate_template_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."estimate_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."estimate_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."extra_works" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "work_date" "date" DEFAULT ("now"())::"date" NOT NULL,
    "description" "text" NOT NULL,
    "quantity" numeric DEFAULT 1 NOT NULL,
    "unit" "text" DEFAULT 'szt.'::"text" NOT NULL,
    "unit_rate" numeric DEFAULT 0 NOT NULL,
    "line_total" numeric GENERATED ALWAYS AS ("round"(("quantity" * "unit_rate"), 2)) STORED,
    "accepted" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "extra_works_quantity_check" CHECK (("quantity" >= (0)::numeric)),
    CONSTRAINT "extra_works_unit_check" CHECK (("unit" = ANY (ARRAY['m²'::"text", 'mb'::"text", 'szt.'::"text", 'kpl.'::"text", 'roboczogodz.'::"text", 'usługa'::"text"]))),
    CONSTRAINT "extra_works_unit_rate_check" CHECK (("unit_rate" >= (0)::numeric))
);


ALTER TABLE "public"."extra_works" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_control_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "payment_id" "uuid",
    "section" "text" NOT NULL,
    "location" "text" DEFAULT ''::"text" NOT NULL,
    "address" "text",
    "client_label" "text",
    "title" "text",
    "scope" "text",
    "amount" numeric,
    "amount_label" "text",
    "payer" "text",
    "status_action" "text",
    "condition_label" "text",
    "phone" "text",
    "term_label" "text",
    "crew_label" "text",
    "notes" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "financial_control_items_amount_check" CHECK ((("amount" IS NULL) OR ("amount" >= (0)::numeric))),
    CONSTRAINT "financial_control_items_section_check" CHECK (("section" = ANY (ARRAY['confirmed_receivable'::"text", 'potential_scope'::"text", 'cash_outside_transfer'::"text", 'dispute'::"text", 'completion_receivable'::"text", 'scheduled_build'::"text", 'crew_settlement'::"text", 'employee_settlement'::"text", 'subcontractor_settlement'::"text"])))
);


ALTER TABLE "public"."financial_control_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_counters" (
    "organization_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "year" integer NOT NULL,
    "last_seq" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."invoice_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "unit" "text" DEFAULT 'usługa'::"text" NOT NULL,
    "quantity" numeric DEFAULT 1 NOT NULL,
    "unit_price_net" numeric DEFAULT 0 NOT NULL,
    "discount_pct" numeric DEFAULT 0 NOT NULL,
    "vat_rate" numeric DEFAULT 23 NOT NULL,
    "net_total" numeric GENERATED ALWAYS AS ("round"((("quantity" * "unit_price_net") * ((1)::numeric - (COALESCE("discount_pct", (0)::numeric) / 100.0))), 2)) STORED,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invoice_lines_discount_pct_check" CHECK ((("discount_pct" >= (0)::numeric) AND ("discount_pct" <= (100)::numeric))),
    CONSTRAINT "invoice_lines_quantity_check" CHECK (("quantity" >= (0)::numeric)),
    CONSTRAINT "invoice_lines_unit_check" CHECK (("unit" = ANY (ARRAY['m²'::"text", 'mb'::"text", 'szt.'::"text", 'kpl.'::"text", 'roboczogodz.'::"text", 'usługa'::"text"]))),
    CONSTRAINT "invoice_lines_unit_price_net_check" CHECK (("unit_price_net" >= (0)::numeric)),
    CONSTRAINT "invoice_lines_vat_rate_check" CHECK ((("vat_rate" >= (0)::numeric) AND ("vat_rate" <= (100)::numeric)))
);


ALTER TABLE "public"."invoice_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "status" "text" DEFAULT 'szkic'::"text" NOT NULL,
    "number" "text" NOT NULL,
    "number_seq" integer DEFAULT 0 NOT NULL,
    "number_year" integer NOT NULL,
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "sale_date" "date",
    "due_date" "date",
    "payment_method" "text" DEFAULT 'przelew'::"text" NOT NULL,
    "buyer_name" "text" DEFAULT ''::"text" NOT NULL,
    "buyer_nip" "text",
    "buyer_address" "text",
    "buyer_city" "text",
    "buyer_email" "text",
    "notes" "text",
    "net_total" numeric DEFAULT 0 NOT NULL,
    "vat_total" numeric DEFAULT 0 NOT NULL,
    "gross_total" numeric DEFAULT 0 NOT NULL,
    "paid_amount" numeric DEFAULT 0 NOT NULL,
    "source_variant_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "with_receipt" boolean DEFAULT false NOT NULL,
    "receipt_date" "date",
    "receipt_amount" numeric(14,2),
    "sent_at" timestamp with time zone,
    "sent_to" "text",
    "paid_at" timestamp with time zone,
    CONSTRAINT "invoices_kind_check" CHECK (("kind" = ANY (ARRAY['proforma'::"text", 'zaliczkowa'::"text", 'końcowa'::"text", 'vat'::"text"]))),
    CONSTRAINT "invoices_paid_amount_check" CHECK (("paid_amount" >= (0)::numeric)),
    CONSTRAINT "invoices_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['przelew'::"text", 'gotówka'::"text", 'karta'::"text", 'BLIK'::"text"]))),
    CONSTRAINT "invoices_receipt_amount_check" CHECK ((("receipt_amount" IS NULL) OR ("receipt_amount" >= (0)::numeric))),
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['szkic'::"text", 'wystawiona'::"text", 'opłacona'::"text", 'anulowana'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_positions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."job_positions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_dispatch_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dedupe_key" "text" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "sender_user_id" "uuid" NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "entity_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_dispatch_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."offer_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "variant_id" "uuid" NOT NULL,
    "section" "text" NOT NULL,
    "label" "text" NOT NULL,
    "unit" "text" DEFAULT 'm²'::"text" NOT NULL,
    "quantity" numeric DEFAULT 1 NOT NULL,
    "unit_rate" numeric DEFAULT 0 NOT NULL,
    "line_total" numeric GENERATED ALWAYS AS ("round"(("quantity" * "unit_rate"), 2)) STORED,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "offer_lines_quantity_check" CHECK (("quantity" >= (0)::numeric)),
    CONSTRAINT "offer_lines_section_check" CHECK (("section" = ANY (ARRAY['labor'::"text", 'material'::"text"]))),
    CONSTRAINT "offer_lines_unit_check" CHECK (("unit" = ANY (ARRAY['m²'::"text", 'mb'::"text", 'szt.'::"text", 'kpl.'::"text", 'roboczogodz.'::"text", 'usługa'::"text"]))),
    CONSTRAINT "offer_lines_unit_rate_check" CHECK (("unit_rate" >= (0)::numeric))
);


ALTER TABLE "public"."offer_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."offer_variants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "scope_notes" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."offer_variants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'office'::"text", 'sales'::"text", 'manager'::"text", 'brygadzista'::"text", 'podwykonawca'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_directory_profiles" (
    "user_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_directory_profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."org_member_profiles" WITH ("security_invoker"='true', "security_barrier"='true') AS
 SELECT "m"."organization_id",
    "m"."user_id",
    "m"."role",
    "p"."email"
   FROM ("public"."organization_members" "m"
     JOIN "public"."user_directory_profiles" "p" ON (("p"."user_id" = "m"."user_id")));


ALTER VIEW "public"."org_member_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_activity_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "category" "text" NOT NULL,
    "entity_type" "text" DEFAULT ''::"text" NOT NULL,
    "entity_id" "uuid",
    "action" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "details" "text",
    "meta" "jsonb",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data_scope" "text" DEFAULT 'operational'::"text" NOT NULL,
    CONSTRAINT "organization_activity_log_category_check" CHECK (("category" = ANY (ARRAY['sprawa'::"text", 'platnosc'::"text", 'faktura'::"text", 'magazyn'::"text", 'sprzet'::"text", 'czas'::"text", 'zespol'::"text", 'firma'::"text", 'przypisanie'::"text", 'prace_dodatkowe'::"text", 'zadanie'::"text", 'rozliczenia'::"text", 'rentownosc'::"text", 'hr'::"text", 'ai'::"text"]))),
    CONSTRAINT "organization_activity_log_data_scope_check" CHECK (("data_scope" = ANY (ARRAY['operational'::"text", 'payroll'::"text"])))
);


ALTER TABLE "public"."organization_activity_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" DEFAULT 'GolBud'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "offer_legal_name" "text",
    "offer_nip" "text",
    "offer_address_line" "text",
    "offer_postal_city" "text",
    "offer_phone" "text",
    "offer_email" "text",
    "offer_website" "text",
    "offer_bank_account" "text",
    "offer_bank_name" "text",
    "offer_payment_terms" "text",
    "offer_default_vat_rate" numeric DEFAULT 8,
    "offer_validity_days" integer DEFAULT 30,
    "accountant_email" "text",
    "invoice_email_subject" "text",
    "invoice_email_body" "text",
    CONSTRAINT "organizations_offer_default_vat_rate_check" CHECK ((("offer_default_vat_rate" IS NULL) OR (("offer_default_vat_rate" >= (0)::numeric) AND ("offer_default_vat_rate" <= (100)::numeric)))),
    CONSTRAINT "organizations_offer_validity_days_check" CHECK ((("offer_validity_days" IS NULL) OR (("offer_validity_days" > 0) AND ("offer_validity_days" <= 365))))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "due_date" "date",
    "amount_due" numeric DEFAULT 0 NOT NULL,
    "amount_paid" numeric DEFAULT 0 NOT NULL,
    "paid_at" timestamp with time zone,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payments_amount_due_check" CHECK (("amount_due" >= (0)::numeric)),
    CONSTRAINT "payments_amount_paid_check" CHECK (("amount_paid" >= (0)::numeric))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."piecework_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "unit" "text" DEFAULT 'szt.'::"text" NOT NULL,
    "rate" numeric DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "piecework_activities_rate_check" CHECK (("rate" >= (0)::numeric)),
    CONSTRAINT "piecework_activities_unit_check" CHECK (("unit" = ANY (ARRAY['m²'::"text", 'mb'::"text", 'szt.'::"text", 'kpl.'::"text", 'roboczogodz.'::"text", 'usługa'::"text"])))
);


ALTER TABLE "public"."piecework_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "remind_at" "date" NOT NULL,
    "title" "text" NOT NULL,
    "note" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subcontractor_settlement_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "subcontractor_id" "uuid",
    "case_subcontractor_id" "uuid",
    "entry_type" "text" DEFAULT 'zaliczka'::"text" NOT NULL,
    "amount" numeric NOT NULL,
    "entry_date" "date" DEFAULT ("now"())::"date" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subcontractor_settlement_entries_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "subcontractor_settlement_entries_entry_type_check" CHECK (("entry_type" = ANY (ARRAY['zaliczka'::"text", 'wyplata'::"text", 'rozliczenie_koncowe'::"text", 'dopłata'::"text", 'potracenie'::"text", 'korekta'::"text"])))
);


ALTER TABLE "public"."subcontractor_settlement_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subcontractors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "trade" "text",
    "contact_name" "text",
    "phone" "text",
    "email" "text",
    "default_rate" numeric,
    "notes" "text",
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subcontractors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_invoice_category_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "pattern" "text" NOT NULL,
    "match_field" "text" DEFAULT 'all'::"text" NOT NULL,
    "category" "text" NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supplier_invoice_category_rules_category_check" CHECK (("category" = ANY (ARRAY['materialy'::"text", 'robocizna'::"text", 'sprzet'::"text", 'transport'::"text", 'podwykonawca'::"text", 'inne'::"text"]))),
    CONSTRAINT "supplier_invoice_category_rules_match_field_check" CHECK (("match_field" = ANY (ARRAY['all'::"text", 'supplier'::"text", 'number'::"text", 'notes'::"text"])))
);


ALTER TABLE "public"."supplier_invoice_category_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_invoice_import_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'csv'::"text" NOT NULL,
    "file_name" "text",
    "row_count" integer DEFAULT 0 NOT NULL,
    "duplicate_count" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supplier_invoice_import_batches_duplicate_count_check" CHECK (("duplicate_count" >= 0)),
    CONSTRAINT "supplier_invoice_import_batches_row_count_check" CHECK (("row_count" >= 0)),
    CONSTRAINT "supplier_invoice_import_batches_source_check" CHECK (("source" = ANY (ARRAY['csv'::"text", 'xlsx'::"text", 'ocr'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."supplier_invoice_import_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "supplier_name" "text" NOT NULL,
    "invoice_number" "text",
    "invoice_date" "date" DEFAULT ("now"())::"date" NOT NULL,
    "due_date" "date",
    "category" "text" DEFAULT 'materialy'::"text" NOT NULL,
    "net_total" numeric,
    "gross_total" numeric DEFAULT 0 NOT NULL,
    "paid_amount" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'nieoplacona'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attachment_id" "uuid",
    "sent_to" "text",
    "sent_at" timestamp with time zone,
    "import_batch_id" "uuid",
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "category_confidence" numeric,
    "category_reason" "text",
    "raw_import_data" "jsonb",
    "paid_at" timestamp with time zone,
    "subcontractor_id" "uuid",
    "case_subcontractor_id" "uuid",
    "linked_settlement_entry_id" "uuid",
    CONSTRAINT "supplier_invoices_category_check" CHECK (("category" = ANY (ARRAY['materialy'::"text", 'robocizna'::"text", 'sprzet'::"text", 'transport'::"text", 'podwykonawca'::"text", 'inne'::"text"]))),
    CONSTRAINT "supplier_invoices_category_confidence_check" CHECK ((("category_confidence" IS NULL) OR (("category_confidence" >= (0)::numeric) AND ("category_confidence" <= (1)::numeric)))),
    CONSTRAINT "supplier_invoices_gross_total_check" CHECK (("gross_total" >= (0)::numeric)),
    CONSTRAINT "supplier_invoices_net_total_check" CHECK ((("net_total" IS NULL) OR ("net_total" >= (0)::numeric))),
    CONSTRAINT "supplier_invoices_paid_amount_check" CHECK (("paid_amount" >= (0)::numeric)),
    CONSTRAINT "supplier_invoices_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'csv'::"text", 'xlsx'::"text", 'ocr'::"text"]))),
    CONSTRAINT "supplier_invoices_status_check" CHECK (("status" = ANY (ARRAY['nieoplacona'::"text", 'czesciowo'::"text", 'oplacona'::"text"])))
);


ALTER TABLE "public"."supplier_invoices" OWNER TO "postgres";


COMMENT ON COLUMN "public"."supplier_invoices"."attachment_id" IS 'Opcjonalny skan/PDF faktury kosztowej z tabeli attachments';



COMMENT ON COLUMN "public"."supplier_invoices"."sent_to" IS 'Adresy, na które wysłano fakturę kosztową do księgowości';



COMMENT ON COLUMN "public"."supplier_invoices"."sent_at" IS 'Data wysyłki faktury kosztowej do księgowości';



COMMENT ON COLUMN "public"."supplier_invoices"."linked_settlement_entry_id" IS 'Jeśli faktura dokumentuje wskazane rozliczenie podwykonawcy, jej kwota nie jest drugi raz doliczana do kosztu.';



CREATE TABLE IF NOT EXISTS "public"."user_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "href" "text" DEFAULT '/'::"text" NOT NULL,
    "entity_id" "uuid",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_key" "text",
    CONSTRAINT "user_notifications_type_check" CHECK (("type" = ANY (ARRAY['new_case'::"text", 'case_assigned'::"text", 'task_created'::"text", 'task_comment'::"text", 'financial_alert'::"text", 'employee_compliance'::"text"])))
);


ALTER TABLE "public"."user_notifications" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_notifications"."event_key" IS 'Klucz idempotencji dla automatycznych alertow (uzytkownik + dokument + data waznosci + prog).';



CREATE TABLE IF NOT EXISTS "public"."vehicle_service_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "service_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "cost" numeric,
    "vendor" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vehicle_service_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "registration_number" "text",
    "make_model" "text",
    "notes" "text",
    "insurance_expires" "date",
    "inspection_expires" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "insurance_oc_expires" "date",
    "insurance_ac_expires" "date"
);


ALTER TABLE "public"."vehicles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."warehouse_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "warehouse_item_id" "uuid",
    "action" "text" NOT NULL,
    "label" "text" DEFAULT ''::"text" NOT NULL,
    "details" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "warehouse_audit_log_action_check" CHECK (("action" = ANY (ARRAY['item_created'::"text", 'items_imported'::"text", 'min_quantity_changed'::"text"])))
);


ALTER TABLE "public"."warehouse_audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."warehouse_audit_log" IS 'Zmiany konfiguracji magazynu (nowa pozycja, import, próg min.) — ruchy ilości w warehouse_movements.';



CREATE TABLE IF NOT EXISTS "public"."warehouse_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "catalog_item_id" "uuid",
    "label" "text" NOT NULL,
    "unit" "text" DEFAULT 'szt.'::"text" NOT NULL,
    "quantity" numeric DEFAULT 0 NOT NULL,
    "min_quantity" numeric DEFAULT 0 NOT NULL,
    "location" "text" DEFAULT 'Baza'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "warehouse_items_min_quantity_check" CHECK (("min_quantity" >= (0)::numeric)),
    CONSTRAINT "warehouse_items_quantity_check" CHECK (("quantity" >= (0)::numeric))
);


ALTER TABLE "public"."warehouse_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."warehouse_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "warehouse_item_id" "uuid" NOT NULL,
    "movement_type" "text" NOT NULL,
    "quantity" numeric NOT NULL,
    "note" "text",
    "case_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "warehouse_movements_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['in'::"text", 'out'::"text"]))),
    CONSTRAINT "warehouse_movements_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."warehouse_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_hours" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "site_label" "text",
    "worker_name" "text" NOT NULL,
    "work_date" "date" NOT NULL,
    "hours" numeric(5,2) DEFAULT 0 NOT NULL,
    "note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "employee_id" "uuid",
    CONSTRAINT "work_hours_hours_check" CHECK ((("hours" >= (0)::numeric) AND ("hours" <= (24)::numeric)))
);


ALTER TABLE "public"."work_hours" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_conversations"
    ADD CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_generated_artifacts"
    ADD CONSTRAINT "ai_generated_artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_message_attachments"
    ADD CONSTRAINT "ai_message_attachments_organization_id_storage_path_key" UNIQUE ("organization_id", "storage_path");



ALTER TABLE ONLY "public"."ai_message_attachments"
    ADD CONSTRAINT "ai_message_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_messages"
    ADD CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_organization_id_storage_path_key" UNIQUE ("organization_id", "storage_path");



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_as_built_estimates"
    ADD CONSTRAINT "case_as_built_estimates_organization_id_storage_path_key" UNIQUE ("organization_id", "storage_path");



ALTER TABLE ONLY "public"."case_as_built_estimates"
    ADD CONSTRAINT "case_as_built_estimates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_assignees"
    ADD CONSTRAINT "case_assignees_pkey" PRIMARY KEY ("case_id", "user_id");



ALTER TABLE ONLY "public"."case_commercial_details"
    ADD CONSTRAINT "case_commercial_details_pkey" PRIMARY KEY ("case_id");



ALTER TABLE ONLY "public"."case_direct_costs"
    ADD CONSTRAINT "case_direct_costs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_notes"
    ADD CONSTRAINT "case_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_profitability_plans"
    ADD CONSTRAINT "case_profitability_plans_organization_id_case_id_key" UNIQUE ("organization_id", "case_id");



ALTER TABLE ONLY "public"."case_profitability_plans"
    ADD CONSTRAINT "case_profitability_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_protocols"
    ADD CONSTRAINT "case_protocols_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_schedule_items"
    ADD CONSTRAINT "case_schedule_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_subcontractors"
    ADD CONSTRAINT "case_subcontractors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_task_assignees"
    ADD CONSTRAINT "case_task_assignees_pkey" PRIMARY KEY ("task_id", "user_id");



ALTER TABLE ONLY "public"."case_task_comment_attachments"
    ADD CONSTRAINT "case_task_comment_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_task_comments"
    ADD CONSTRAINT "case_task_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_task_reads"
    ADD CONSTRAINT "case_task_reads_pkey" PRIMARY KEY ("task_id", "user_id");



ALTER TABLE ONLY "public"."case_tasks"
    ADD CONSTRAINT "case_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalog_items"
    ADD CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_policies"
    ADD CONSTRAINT "company_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crews"
    ADD CONSTRAINT "crews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."digest_email_prefs"
    ADD CONSTRAINT "digest_email_prefs_pkey" PRIMARY KEY ("organization_id", "user_id");



ALTER TABLE ONLY "public"."employee_compensation"
    ADD CONSTRAINT "employee_compensation_organization_id_employee_id_key" UNIQUE ("organization_id", "employee_id");



ALTER TABLE ONLY "public"."employee_compensation"
    ADD CONSTRAINT "employee_compensation_pkey" PRIMARY KEY ("employee_id");



ALTER TABLE ONLY "public"."employee_crew_history"
    ADD CONSTRAINT "employee_crew_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_documents"
    ADD CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_monthly_settlements"
    ADD CONSTRAINT "employee_monthly_settlements_organization_id_employee_id_pe_key" UNIQUE ("organization_id", "employee_id", "period_month");



ALTER TABLE ONLY "public"."employee_monthly_settlements"
    ADD CONSTRAINT "employee_monthly_settlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_piecework_entries"
    ADD CONSTRAINT "employee_piecework_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_position_history"
    ADD CONSTRAINT "employee_position_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_organization_id_user_id_key" UNIQUE ("organization_id", "user_id");



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_settlement_entries"
    ADD CONSTRAINT "employee_settlement_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_settlement_history"
    ADD CONSTRAINT "employee_settlement_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment_assignments"
    ADD CONSTRAINT "equipment_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."estimate_template_lines"
    ADD CONSTRAINT "estimate_template_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."estimate_templates"
    ADD CONSTRAINT "estimate_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extra_works"
    ADD CONSTRAINT "extra_works_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_control_items"
    ADD CONSTRAINT "financial_control_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_counters"
    ADD CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("organization_id", "kind", "year");



ALTER TABLE ONLY "public"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_organization_id_number_key" UNIQUE ("organization_id", "number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_positions"
    ADD CONSTRAINT "job_positions_organization_id_name_key" UNIQUE ("organization_id", "name");



ALTER TABLE ONLY "public"."job_positions"
    ADD CONSTRAINT "job_positions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_dispatch_events"
    ADD CONSTRAINT "notification_dispatch_events_dedupe_key_key" UNIQUE ("dedupe_key");



ALTER TABLE ONLY "public"."notification_dispatch_events"
    ADD CONSTRAINT "notification_dispatch_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offer_lines"
    ADD CONSTRAINT "offer_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offer_variants"
    ADD CONSTRAINT "offer_variants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_activity_log"
    ADD CONSTRAINT "organization_activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("organization_id", "user_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."piecework_activities"
    ADD CONSTRAINT "piecework_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subcontractor_settlement_entries"
    ADD CONSTRAINT "subcontractor_settlement_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subcontractors"
    ADD CONSTRAINT "subcontractors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_invoice_category_rules"
    ADD CONSTRAINT "supplier_invoice_category_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_invoice_import_batches"
    ADD CONSTRAINT "supplier_invoice_import_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_invoices"
    ADD CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_directory_profiles"
    ADD CONSTRAINT "user_directory_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_notifications"
    ADD CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_notifications"
    ADD CONSTRAINT "user_notifications_user_event_key_key" UNIQUE ("user_id", "event_key");



ALTER TABLE ONLY "public"."vehicle_service_entries"
    ADD CONSTRAINT "vehicle_service_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."warehouse_audit_log"
    ADD CONSTRAINT "warehouse_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."warehouse_items"
    ADD CONSTRAINT "warehouse_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."warehouse_movements"
    ADD CONSTRAINT "warehouse_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_hours"
    ADD CONSTRAINT "work_hours_pkey" PRIMARY KEY ("id");



CREATE INDEX "ai_conversations_case_idx" ON "public"."ai_conversations" USING "btree" ("case_id", "last_message_at" DESC) WHERE ("case_id" IS NOT NULL);



CREATE INDEX "ai_conversations_org_idx" ON "public"."ai_conversations" USING "btree" ("organization_id", "last_message_at" DESC);



CREATE INDEX "ai_generated_artifacts_case_idx" ON "public"."ai_generated_artifacts" USING "btree" ("case_id", "created_at" DESC) WHERE ("case_id" IS NOT NULL);



CREATE INDEX "ai_generated_artifacts_org_idx" ON "public"."ai_generated_artifacts" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "ai_message_attachments_case_idx" ON "public"."ai_message_attachments" USING "btree" ("case_id", "created_at" DESC) WHERE ("case_id" IS NOT NULL);



CREATE INDEX "ai_message_attachments_conversation_idx" ON "public"."ai_message_attachments" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "ai_message_attachments_message_idx" ON "public"."ai_message_attachments" USING "btree" ("message_id") WHERE ("message_id" IS NOT NULL);



CREATE INDEX "ai_messages_conversation_idx" ON "public"."ai_messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "ai_messages_org_idx" ON "public"."ai_messages" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "attachments_case_idx" ON "public"."attachments" USING "btree" ("case_id");



CREATE INDEX "case_as_built_estimates_case_idx" ON "public"."case_as_built_estimates" USING "btree" ("case_id");



CREATE INDEX "case_as_built_estimates_org_idx" ON "public"."case_as_built_estimates" USING "btree" ("organization_id");



CREATE INDEX "case_assignees_case_idx" ON "public"."case_assignees" USING "btree" ("case_id");



CREATE INDEX "case_assignees_user_idx" ON "public"."case_assignees" USING "btree" ("user_id");



CREATE INDEX "case_commercial_details_org_idx" ON "public"."case_commercial_details" USING "btree" ("organization_id");



CREATE INDEX "case_direct_costs_case_idx" ON "public"."case_direct_costs" USING "btree" ("case_id");



CREATE INDEX "case_direct_costs_org_type_idx" ON "public"."case_direct_costs" USING "btree" ("organization_id", "cost_type");



CREATE INDEX "case_notes_case_idx" ON "public"."case_notes" USING "btree" ("case_id");



CREATE INDEX "case_profitability_plans_case_idx" ON "public"."case_profitability_plans" USING "btree" ("case_id");



CREATE INDEX "case_profitability_plans_org_idx" ON "public"."case_profitability_plans" USING "btree" ("organization_id");



CREATE INDEX "case_protocols_case_idx" ON "public"."case_protocols" USING "btree" ("case_id");



CREATE INDEX "case_schedule_case_idx" ON "public"."case_schedule_items" USING "btree" ("case_id");



CREATE INDEX "case_schedule_items_org_due_idx" ON "public"."case_schedule_items" USING "btree" ("organization_id", "due_date") WHERE (("completed" = false) AND ("due_date" IS NOT NULL));



CREATE INDEX "case_subcontractors_case_idx" ON "public"."case_subcontractors" USING "btree" ("case_id");



CREATE INDEX "case_subcontractors_sub_idx" ON "public"."case_subcontractors" USING "btree" ("subcontractor_id");



CREATE INDEX "case_task_comment_attachments_comment_idx" ON "public"."case_task_comment_attachments" USING "btree" ("comment_id");



CREATE INDEX "case_task_comments_org_idx" ON "public"."case_task_comments" USING "btree" ("organization_id", "created_at");



CREATE INDEX "case_task_comments_task_idx" ON "public"."case_task_comments" USING "btree" ("task_id", "created_at");



CREATE INDEX "case_task_reads_user_idx" ON "public"."case_task_reads" USING "btree" ("user_id");



CREATE INDEX "case_tasks_assignee_idx" ON "public"."case_tasks" USING "btree" ("assignee_id");



CREATE INDEX "case_tasks_case_idx" ON "public"."case_tasks" USING "btree" ("case_id");



CREATE INDEX "case_tasks_org_idx" ON "public"."case_tasks" USING "btree" ("organization_id");



CREATE INDEX "cases_org_idx" ON "public"."cases" USING "btree" ("organization_id");



CREATE INDEX "cases_org_next_contact_idx" ON "public"."cases" USING "btree" ("organization_id", "next_contact_date");



CREATE INDEX "cases_org_status_idx" ON "public"."cases" USING "btree" ("organization_id", "status");



CREATE INDEX "catalog_items_org_idx" ON "public"."catalog_items" USING "btree" ("organization_id");



CREATE INDEX "company_policies_org_idx" ON "public"."company_policies" USING "btree" ("organization_id");



CREATE INDEX "crews_org_idx" ON "public"."crews" USING "btree" ("organization_id");



CREATE INDEX "digest_email_prefs_org_enabled_idx" ON "public"."digest_email_prefs" USING "btree" ("organization_id") WHERE ("digest_enabled" = true);



CREATE INDEX "employee_compensation_org_idx" ON "public"."employee_compensation" USING "btree" ("organization_id");



CREATE INDEX "employee_crew_history_crew_idx" ON "public"."employee_crew_history" USING "btree" ("crew_id", "valid_from" DESC);



CREATE INDEX "employee_crew_history_employee_idx" ON "public"."employee_crew_history" USING "btree" ("employee_id", "valid_from" DESC);



CREATE INDEX "employee_documents_employee_idx" ON "public"."employee_documents" USING "btree" ("employee_id", "status", "created_at" DESC);



CREATE INDEX "employee_documents_org_expiry_idx" ON "public"."employee_documents" USING "btree" ("organization_id", "valid_until") WHERE ("status" = 'active'::"text");



CREATE UNIQUE INDEX "employee_documents_source_key_idx" ON "public"."employee_documents" USING "btree" ("employee_id", "source_key") WHERE ("source_key" IS NOT NULL);



CREATE INDEX "employee_monthly_settlements_employee_idx" ON "public"."employee_monthly_settlements" USING "btree" ("employee_id", "period_month" DESC);



CREATE INDEX "employee_monthly_settlements_org_period_idx" ON "public"."employee_monthly_settlements" USING "btree" ("organization_id", "period_month" DESC, "status");



CREATE INDEX "employee_piecework_entries_case_idx" ON "public"."employee_piecework_entries" USING "btree" ("case_id");



CREATE INDEX "employee_piecework_entries_employee_idx" ON "public"."employee_piecework_entries" USING "btree" ("employee_id", "entry_date" DESC);



CREATE INDEX "employee_piecework_entries_org_date_idx" ON "public"."employee_piecework_entries" USING "btree" ("organization_id", "entry_date" DESC);



CREATE INDEX "employee_position_history_employee_idx" ON "public"."employee_position_history" USING "btree" ("employee_id", "valid_from" DESC);



CREATE INDEX "employee_profiles_crew_idx" ON "public"."employee_profiles" USING "btree" ("crew_id");



CREATE INDEX "employee_profiles_manager_idx" ON "public"."employee_profiles" USING "btree" ("manager_employee_id");



CREATE INDEX "employee_profiles_org_idx" ON "public"."employee_profiles" USING "btree" ("organization_id", "active");



CREATE INDEX "employee_settlement_entries_case_idx" ON "public"."employee_settlement_entries" USING "btree" ("case_id");



CREATE INDEX "employee_settlement_entries_employee_idx" ON "public"."employee_settlement_entries" USING "btree" ("employee_id", "entry_date" DESC);



CREATE INDEX "employee_settlement_entries_org_date_idx" ON "public"."employee_settlement_entries" USING "btree" ("organization_id", "entry_date" DESC);



CREATE INDEX "employee_settlement_history_org_idx" ON "public"."employee_settlement_history" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "employee_settlement_history_settlement_idx" ON "public"."employee_settlement_history" USING "btree" ("settlement_id", "created_at" DESC);



CREATE INDEX "equipment_assignments_case_idx" ON "public"."equipment_assignments" USING "btree" ("case_id");



CREATE INDEX "equipment_assignments_equipment_idx" ON "public"."equipment_assignments" USING "btree" ("equipment_id");



CREATE INDEX "equipment_assignments_org_active_idx" ON "public"."equipment_assignments" USING "btree" ("organization_id", "returned");



CREATE INDEX "equipment_org_idx" ON "public"."equipment" USING "btree" ("organization_id");



CREATE INDEX "estimate_template_lines_template_idx" ON "public"."estimate_template_lines" USING "btree" ("template_id");



CREATE INDEX "estimate_templates_org_idx" ON "public"."estimate_templates" USING "btree" ("organization_id", "sort_order");



CREATE INDEX "extra_works_case_idx" ON "public"."extra_works" USING "btree" ("case_id");



CREATE INDEX "financial_control_items_case_idx" ON "public"."financial_control_items" USING "btree" ("case_id");



CREATE INDEX "financial_control_items_org_section_idx" ON "public"."financial_control_items" USING "btree" ("organization_id", "section", "sort_order");



CREATE INDEX "invoice_lines_invoice_idx" ON "public"."invoice_lines" USING "btree" ("invoice_id");



CREATE INDEX "invoices_case_idx" ON "public"."invoices" USING "btree" ("case_id");



CREATE INDEX "invoices_org_idx" ON "public"."invoices" USING "btree" ("organization_id");



CREATE INDEX "invoices_org_status_idx" ON "public"."invoices" USING "btree" ("organization_id", "status");



CREATE INDEX "job_positions_org_idx" ON "public"."job_positions" USING "btree" ("organization_id", "sort_order");



CREATE INDEX "notification_dispatch_sender_created_idx" ON "public"."notification_dispatch_events" USING "btree" ("sender_user_id", "created_at" DESC);



CREATE INDEX "offer_lines_variant_idx" ON "public"."offer_lines" USING "btree" ("variant_id");



CREATE INDEX "offer_variants_case_idx" ON "public"."offer_variants" USING "btree" ("case_id");



CREATE INDEX "org_activity_log_case_idx" ON "public"."organization_activity_log" USING "btree" ("case_id", "created_at" DESC) WHERE ("case_id" IS NOT NULL);



CREATE INDEX "org_activity_log_org_category_idx" ON "public"."organization_activity_log" USING "btree" ("organization_id", "category", "created_at" DESC);



CREATE INDEX "org_activity_log_org_created_idx" ON "public"."organization_activity_log" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "organization_members_user_idx" ON "public"."organization_members" USING "btree" ("user_id");



CREATE INDEX "payments_case_idx" ON "public"."payments" USING "btree" ("case_id");



CREATE INDEX "piecework_activities_org_idx" ON "public"."piecework_activities" USING "btree" ("organization_id", "sort_order");



CREATE INDEX "push_subscriptions_user_idx" ON "public"."push_subscriptions" USING "btree" ("user_id");



CREATE INDEX "reminders_case_idx" ON "public"."reminders" USING "btree" ("case_id");



CREATE INDEX "reminders_org_date_idx" ON "public"."reminders" USING "btree" ("organization_id", "remind_at");



CREATE INDEX "reminders_org_remind_idx" ON "public"."reminders" USING "btree" ("organization_id", "remind_at") WHERE ("completed_at" IS NULL);



CREATE INDEX "subcontractor_settlement_entries_case_idx" ON "public"."subcontractor_settlement_entries" USING "btree" ("case_id");



CREATE INDEX "subcontractor_settlement_entries_org_date_idx" ON "public"."subcontractor_settlement_entries" USING "btree" ("organization_id", "entry_date" DESC);



CREATE INDEX "subcontractor_settlement_entries_sub_idx" ON "public"."subcontractor_settlement_entries" USING "btree" ("subcontractor_id");



CREATE INDEX "subcontractors_org_idx" ON "public"."subcontractors" USING "btree" ("organization_id");



CREATE INDEX "supplier_invoice_category_rules_org_idx" ON "public"."supplier_invoice_category_rules" USING "btree" ("organization_id", "active", "priority");



CREATE INDEX "supplier_invoice_import_batches_org_idx" ON "public"."supplier_invoice_import_batches" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "supplier_invoices_attachment_idx" ON "public"."supplier_invoices" USING "btree" ("attachment_id");



CREATE INDEX "supplier_invoices_case_idx" ON "public"."supplier_invoices" USING "btree" ("case_id");



CREATE INDEX "supplier_invoices_category_idx" ON "public"."supplier_invoices" USING "btree" ("organization_id", "category");



CREATE INDEX "supplier_invoices_import_batch_idx" ON "public"."supplier_invoices" USING "btree" ("import_batch_id");



CREATE UNIQUE INDEX "supplier_invoices_linked_settlement_uidx" ON "public"."supplier_invoices" USING "btree" ("linked_settlement_entry_id") WHERE ("linked_settlement_entry_id" IS NOT NULL);



CREATE INDEX "supplier_invoices_org_date_idx" ON "public"."supplier_invoices" USING "btree" ("organization_id", "invoice_date" DESC);



CREATE INDEX "supplier_invoices_org_supplier_number_idx" ON "public"."supplier_invoices" USING "btree" ("organization_id", "supplier_name", "invoice_number");



CREATE INDEX "supplier_invoices_subcontractor_idx" ON "public"."supplier_invoices" USING "btree" ("organization_id", "subcontractor_id", "invoice_date" DESC);



CREATE INDEX "task_assignees_task_idx" ON "public"."case_task_assignees" USING "btree" ("task_id");



CREATE INDEX "task_assignees_user_idx" ON "public"."case_task_assignees" USING "btree" ("user_id");



CREATE INDEX "user_notifications_user_created_idx" ON "public"."user_notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "user_notifications_user_unread_idx" ON "public"."user_notifications" USING "btree" ("user_id") WHERE ("read_at" IS NULL);



CREATE INDEX "vehicle_service_vehicle_idx" ON "public"."vehicle_service_entries" USING "btree" ("vehicle_id");



CREATE INDEX "vehicles_org_idx" ON "public"."vehicles" USING "btree" ("organization_id");



CREATE INDEX "warehouse_audit_log_org_created_idx" ON "public"."warehouse_audit_log" USING "btree" ("organization_id", "created_at" DESC);



CREATE UNIQUE INDEX "warehouse_items_org_catalog_uidx" ON "public"."warehouse_items" USING "btree" ("organization_id", "catalog_item_id") WHERE ("catalog_item_id" IS NOT NULL);



CREATE INDEX "warehouse_items_org_idx" ON "public"."warehouse_items" USING "btree" ("organization_id");



CREATE INDEX "warehouse_movements_item_idx" ON "public"."warehouse_movements" USING "btree" ("warehouse_item_id");



CREATE INDEX "warehouse_movements_org_created_idx" ON "public"."warehouse_movements" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "work_hours_case_idx" ON "public"."work_hours" USING "btree" ("case_id");



CREATE INDEX "work_hours_employee_idx" ON "public"."work_hours" USING "btree" ("employee_id");



CREATE INDEX "work_hours_org_date_idx" ON "public"."work_hours" USING "btree" ("organization_id", "work_date");



CREATE UNIQUE INDEX "work_hours_unique_cell_idx" ON "public"."work_hours" USING "btree" ("organization_id", "worker_name", "work_date", COALESCE("case_id", '00000000-0000-0000-0000-000000000000'::"uuid"), COALESCE("site_label", ''::"text"));



CREATE OR REPLACE TRIGGER "employee_profile_hr_history" AFTER INSERT OR UPDATE OF "role_title", "department", "employment_type", "manager_employee_id", "crew_id" ON "public"."employee_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_employee_profile_hr_history"();



CREATE OR REPLACE TRIGGER "employee_settlement_entry_history_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."employee_settlement_entries" FOR EACH ROW EXECUTE FUNCTION "public"."trg_employee_settlement_entry_history"();



CREATE OR REPLACE TRIGGER "employee_settlement_history_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."employee_monthly_settlements" FOR EACH ROW EXECUTE FUNCTION "public"."trg_employee_settlement_history"();



CREATE OR REPLACE TRIGGER "equipment_assignment_validate" BEFORE INSERT OR UPDATE ON "public"."equipment_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."validate_equipment_assignment"();



CREATE OR REPLACE TRIGGER "invoice_lines_recalc" AFTER INSERT OR DELETE OR UPDATE ON "public"."invoice_lines" FOR EACH ROW EXECUTE FUNCTION "public"."recalc_invoice_totals"();



CREATE OR REPLACE TRIGGER "lock_employee_entries_for_closed_month" BEFORE INSERT OR DELETE OR UPDATE ON "public"."employee_settlement_entries" FOR EACH ROW EXECUTE FUNCTION "public"."trg_lock_employee_entries_for_closed_month"();



CREATE OR REPLACE TRIGGER "log_case_activity" AFTER INSERT OR DELETE OR UPDATE ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_case_activity"();



CREATE OR REPLACE TRIGGER "log_case_assignee_activity" AFTER INSERT OR DELETE ON "public"."case_assignees" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_case_assignee_activity"();



CREATE OR REPLACE TRIGGER "log_case_commercial_activity" AFTER INSERT OR UPDATE OF "estimated_value" ON "public"."case_commercial_details" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_case_commercial_activity"();



CREATE OR REPLACE TRIGGER "log_case_direct_cost_activity" AFTER INSERT OR DELETE OR UPDATE ON "public"."case_direct_costs" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_case_direct_cost_activity"();



CREATE OR REPLACE TRIGGER "log_case_profitability_plan_activity" AFTER INSERT OR UPDATE ON "public"."case_profitability_plans" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_case_profitability_plan_activity"();



CREATE OR REPLACE TRIGGER "log_case_task_activity" AFTER UPDATE ON "public"."case_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_case_task_activity"();



CREATE OR REPLACE TRIGGER "log_employee_compensation_activity" AFTER INSERT OR UPDATE ON "public"."employee_compensation" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_employee_compensation_activity"();



CREATE OR REPLACE TRIGGER "log_employee_crew_history_activity" AFTER INSERT ON "public"."employee_crew_history" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_employee_crew_history_activity"();



CREATE OR REPLACE TRIGGER "log_employee_document_activity" AFTER INSERT OR DELETE OR UPDATE ON "public"."employee_documents" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_employee_document_activity"();



CREATE OR REPLACE TRIGGER "log_employee_monthly_settlement_activity" AFTER INSERT OR UPDATE ON "public"."employee_monthly_settlements" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_employee_monthly_settlement_activity"();



CREATE OR REPLACE TRIGGER "log_employee_position_history_activity" AFTER INSERT ON "public"."employee_position_history" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_employee_position_history_activity"();



CREATE OR REPLACE TRIGGER "log_employee_profile_activity" AFTER INSERT OR UPDATE ON "public"."employee_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_employee_profile_activity"();



CREATE OR REPLACE TRIGGER "log_equipment_assignment_activity" AFTER INSERT OR UPDATE ON "public"."equipment_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_equipment_assignment_activity"();



CREATE OR REPLACE TRIGGER "log_extra_work_activity" AFTER INSERT OR UPDATE ON "public"."extra_works" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_extra_work_activity"();



CREATE OR REPLACE TRIGGER "log_invoice_activity" AFTER INSERT OR UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_invoice_activity"();



CREATE OR REPLACE TRIGGER "log_organization_profile_activity" AFTER UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_organization_profile_activity"();



CREATE OR REPLACE TRIGGER "log_payment_activity" AFTER INSERT OR UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_payment_activity"();



CREATE OR REPLACE TRIGGER "log_subcontractor_settlement_activity" AFTER INSERT OR UPDATE ON "public"."subcontractor_settlement_entries" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_subcontractor_settlement_activity"();



CREATE OR REPLACE TRIGGER "log_supplier_invoice_activity" AFTER INSERT OR UPDATE ON "public"."supplier_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_supplier_invoice_activity"();



CREATE OR REPLACE TRIGGER "log_supplier_invoice_import_batch_activity" AFTER INSERT ON "public"."supplier_invoice_import_batches" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_supplier_invoice_import_batch_activity"();



CREATE OR REPLACE TRIGGER "log_warehouse_audit_activity" AFTER INSERT ON "public"."warehouse_audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_warehouse_audit_activity"();



CREATE OR REPLACE TRIGGER "log_warehouse_movement_activity" AFTER INSERT ON "public"."warehouse_movements" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_warehouse_movement_activity"();



CREATE OR REPLACE TRIGGER "log_work_hours_activity" AFTER INSERT OR DELETE OR UPDATE ON "public"."work_hours" FOR EACH ROW EXECUTE FUNCTION "public"."trg_log_work_hours_activity"();



CREATE OR REPLACE TRIGGER "protect_case_security_columns" BEFORE UPDATE ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."protect_case_security_columns"();



CREATE OR REPLACE TRIGGER "protect_equipment_history" BEFORE DELETE OR UPDATE ON "public"."equipment" FOR EACH ROW EXECUTE FUNCTION "public"."protect_equipment_history"();



CREATE OR REPLACE TRIGGER "protect_warehouse_item_history" BEFORE DELETE OR UPDATE ON "public"."warehouse_items" FOR EACH ROW EXECUTE FUNCTION "public"."protect_warehouse_item_history"();



CREATE OR REPLACE TRIGGER "refresh_employee_compliance_dates" AFTER INSERT OR DELETE OR UPDATE ON "public"."employee_documents" FOR EACH ROW EXECUTE FUNCTION "public"."trg_refresh_employee_compliance_dates"();



CREATE OR REPLACE TRIGGER "set_case_profitability_plans_updated_at" BEFORE UPDATE ON "public"."case_profitability_plans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_cases_updated_at" BEFORE UPDATE ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_company_policies_updated_at" BEFORE UPDATE ON "public"."company_policies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_digest_email_prefs_updated_at" BEFORE UPDATE ON "public"."digest_email_prefs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_employee_documents_updated_at" BEFORE UPDATE ON "public"."employee_documents" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_employee_monthly_settlements_updated_at" BEFORE UPDATE ON "public"."employee_monthly_settlements" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_employee_profiles_updated_at" BEFORE UPDATE ON "public"."employee_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_employee_settlement_entries_updated_at" BEFORE UPDATE ON "public"."employee_settlement_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_equipment_updated_at" BEFORE UPDATE ON "public"."equipment" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_financial_control_items_updated_at" BEFORE UPDATE ON "public"."financial_control_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_invoices_updated_at" BEFORE UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_supplier_invoices_updated_at" BEFORE UPDATE ON "public"."supplier_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_vehicles_updated_at" BEFORE UPDATE ON "public"."vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_warehouse_items_updated_at" BEFORE UPDATE ON "public"."warehouse_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_work_hours_updated_at" BEFORE UPDATE ON "public"."work_hours" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "stamp_case_commercial_details" BEFORE INSERT OR UPDATE ON "public"."case_commercial_details" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_case_commercial_details"();



CREATE OR REPLACE TRIGGER "stamp_invoice_paid_at" BEFORE INSERT OR UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_invoice_paid_at"();



CREATE OR REPLACE TRIGGER "stamp_supplier_invoice_paid_at" BEFORE INSERT OR UPDATE ON "public"."supplier_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_invoice_paid_at"();



CREATE OR REPLACE TRIGGER "sync_profile_compliance_documents" AFTER UPDATE OF "bhp_valid_until", "medical_valid_until" ON "public"."employee_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_sync_profile_compliance_documents"();



CREATE OR REPLACE TRIGGER "touch_ai_conversation" AFTER INSERT ON "public"."ai_messages" FOR EACH ROW EXECUTE FUNCTION "public"."trg_touch_ai_conversation"();



CREATE OR REPLACE TRIGGER "validate_supplier_invoice_settlement_link" BEFORE INSERT OR UPDATE ON "public"."supplier_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."validate_supplier_invoice_settlement_link"();



CREATE OR REPLACE TRIGGER "warehouse_movement_apply" AFTER INSERT ON "public"."warehouse_movements" FOR EACH ROW EXECUTE FUNCTION "public"."apply_warehouse_movement"();



CREATE OR REPLACE TRIGGER "warehouse_movement_validate" BEFORE INSERT ON "public"."warehouse_movements" FOR EACH ROW EXECUTE FUNCTION "public"."validate_warehouse_movement"();



ALTER TABLE ONLY "public"."ai_conversations"
    ADD CONSTRAINT "ai_conversations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_conversations"
    ADD CONSTRAINT "ai_conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_conversations"
    ADD CONSTRAINT "ai_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_generated_artifacts"
    ADD CONSTRAINT "ai_generated_artifacts_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_generated_artifacts"
    ADD CONSTRAINT "ai_generated_artifacts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_generated_artifacts"
    ADD CONSTRAINT "ai_generated_artifacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_generated_artifacts"
    ADD CONSTRAINT "ai_generated_artifacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_message_attachments"
    ADD CONSTRAINT "ai_message_attachments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_message_attachments"
    ADD CONSTRAINT "ai_message_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_message_attachments"
    ADD CONSTRAINT "ai_message_attachments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_message_attachments"
    ADD CONSTRAINT "ai_message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."ai_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_message_attachments"
    ADD CONSTRAINT "ai_message_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_messages"
    ADD CONSTRAINT "ai_messages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_messages"
    ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_messages"
    ADD CONSTRAINT "ai_messages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_messages"
    ADD CONSTRAINT "ai_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_as_built_estimates"
    ADD CONSTRAINT "case_as_built_estimates_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_as_built_estimates"
    ADD CONSTRAINT "case_as_built_estimates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_as_built_estimates"
    ADD CONSTRAINT "case_as_built_estimates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_as_built_estimates"
    ADD CONSTRAINT "case_as_built_estimates_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."offer_variants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_assignees"
    ADD CONSTRAINT "case_assignees_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_assignees"
    ADD CONSTRAINT "case_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_commercial_details"
    ADD CONSTRAINT "case_commercial_details_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_commercial_details"
    ADD CONSTRAINT "case_commercial_details_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_commercial_details"
    ADD CONSTRAINT "case_commercial_details_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_direct_costs"
    ADD CONSTRAINT "case_direct_costs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_direct_costs"
    ADD CONSTRAINT "case_direct_costs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_direct_costs"
    ADD CONSTRAINT "case_direct_costs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_notes"
    ADD CONSTRAINT "case_notes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_notes"
    ADD CONSTRAINT "case_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_notes"
    ADD CONSTRAINT "case_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_profitability_plans"
    ADD CONSTRAINT "case_profitability_plans_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_profitability_plans"
    ADD CONSTRAINT "case_profitability_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_profitability_plans"
    ADD CONSTRAINT "case_profitability_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_protocols"
    ADD CONSTRAINT "case_protocols_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_protocols"
    ADD CONSTRAINT "case_protocols_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_protocols"
    ADD CONSTRAINT "case_protocols_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_schedule_items"
    ADD CONSTRAINT "case_schedule_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_schedule_items"
    ADD CONSTRAINT "case_schedule_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_subcontractors"
    ADD CONSTRAINT "case_subcontractors_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_subcontractors"
    ADD CONSTRAINT "case_subcontractors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_subcontractors"
    ADD CONSTRAINT "case_subcontractors_subcontractor_id_fkey" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."subcontractors"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_task_assignees"
    ADD CONSTRAINT "case_task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."case_tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_task_assignees"
    ADD CONSTRAINT "case_task_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_task_comment_attachments"
    ADD CONSTRAINT "case_task_comment_attachments_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."case_task_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_task_comment_attachments"
    ADD CONSTRAINT "case_task_comment_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_task_comment_attachments"
    ADD CONSTRAINT "case_task_comment_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."case_tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_task_comments"
    ADD CONSTRAINT "case_task_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_task_comments"
    ADD CONSTRAINT "case_task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."case_tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_task_comments"
    ADD CONSTRAINT "case_task_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_task_reads"
    ADD CONSTRAINT "case_task_reads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_task_reads"
    ADD CONSTRAINT "case_task_reads_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."case_tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_task_reads"
    ADD CONSTRAINT "case_task_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_tasks"
    ADD CONSTRAINT "case_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_tasks"
    ADD CONSTRAINT "case_tasks_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_tasks"
    ADD CONSTRAINT "case_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_tasks"
    ADD CONSTRAINT "case_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."catalog_items"
    ADD CONSTRAINT "catalog_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_policies"
    ADD CONSTRAINT "company_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crews"
    ADD CONSTRAINT "crews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."digest_email_prefs"
    ADD CONSTRAINT "digest_email_prefs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."digest_email_prefs"
    ADD CONSTRAINT "digest_email_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_compensation"
    ADD CONSTRAINT "employee_compensation_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_compensation"
    ADD CONSTRAINT "employee_compensation_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_compensation"
    ADD CONSTRAINT "employee_compensation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_compensation"
    ADD CONSTRAINT "employee_compensation_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_crew_history"
    ADD CONSTRAINT "employee_crew_history_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_crew_history"
    ADD CONSTRAINT "employee_crew_history_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_crew_history"
    ADD CONSTRAINT "employee_crew_history_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_crew_history"
    ADD CONSTRAINT "employee_crew_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_documents"
    ADD CONSTRAINT "employee_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_documents"
    ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_documents"
    ADD CONSTRAINT "employee_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_monthly_settlements"
    ADD CONSTRAINT "employee_monthly_settlements_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_monthly_settlements"
    ADD CONSTRAINT "employee_monthly_settlements_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_monthly_settlements"
    ADD CONSTRAINT "employee_monthly_settlements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_monthly_settlements"
    ADD CONSTRAINT "employee_monthly_settlements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."employee_monthly_settlements"
    ADD CONSTRAINT "employee_monthly_settlements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_monthly_settlements"
    ADD CONSTRAINT "employee_monthly_settlements_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_piecework_entries"
    ADD CONSTRAINT "employee_piecework_entries_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."piecework_activities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."employee_piecework_entries"
    ADD CONSTRAINT "employee_piecework_entries_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_piecework_entries"
    ADD CONSTRAINT "employee_piecework_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_piecework_entries"
    ADD CONSTRAINT "employee_piecework_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_piecework_entries"
    ADD CONSTRAINT "employee_piecework_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_position_history"
    ADD CONSTRAINT "employee_position_history_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_position_history"
    ADD CONSTRAINT "employee_position_history_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_position_history"
    ADD CONSTRAINT "employee_position_history_manager_employee_id_fkey" FOREIGN KEY ("manager_employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_position_history"
    ADD CONSTRAINT "employee_position_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_manager_employee_id_fkey" FOREIGN KEY ("manager_employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_settlement_entries"
    ADD CONSTRAINT "employee_settlement_entries_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_settlement_entries"
    ADD CONSTRAINT "employee_settlement_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_settlement_entries"
    ADD CONSTRAINT "employee_settlement_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_settlement_entries"
    ADD CONSTRAINT "employee_settlement_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_settlement_entries"
    ADD CONSTRAINT "employee_settlement_entries_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_settlement_history"
    ADD CONSTRAINT "employee_settlement_history_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_settlement_history"
    ADD CONSTRAINT "employee_settlement_history_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."employee_settlement_history"
    ADD CONSTRAINT "employee_settlement_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_settlement_history"
    ADD CONSTRAINT "employee_settlement_history_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "public"."employee_monthly_settlements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_assignments"
    ADD CONSTRAINT "equipment_assignments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment_assignments"
    ADD CONSTRAINT "equipment_assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment_assignments"
    ADD CONSTRAINT "equipment_assignments_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_assignments"
    ADD CONSTRAINT "equipment_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."estimate_template_lines"
    ADD CONSTRAINT "estimate_template_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."estimate_template_lines"
    ADD CONSTRAINT "estimate_template_lines_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."estimate_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."estimate_templates"
    ADD CONSTRAINT "estimate_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."estimate_templates"
    ADD CONSTRAINT "estimate_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extra_works"
    ADD CONSTRAINT "extra_works_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extra_works"
    ADD CONSTRAINT "extra_works_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."financial_control_items"
    ADD CONSTRAINT "financial_control_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_control_items"
    ADD CONSTRAINT "financial_control_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_control_items"
    ADD CONSTRAINT "financial_control_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."financial_control_items"
    ADD CONSTRAINT "financial_control_items_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_counters"
    ADD CONSTRAINT "invoice_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_source_variant_id_fkey" FOREIGN KEY ("source_variant_id") REFERENCES "public"."offer_variants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."job_positions"
    ADD CONSTRAINT "job_positions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_dispatch_events"
    ADD CONSTRAINT "notification_dispatch_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_dispatch_events"
    ADD CONSTRAINT "notification_dispatch_events_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_dispatch_events"
    ADD CONSTRAINT "notification_dispatch_events_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offer_lines"
    ADD CONSTRAINT "offer_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offer_lines"
    ADD CONSTRAINT "offer_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."offer_variants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offer_variants"
    ADD CONSTRAINT "offer_variants_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offer_variants"
    ADD CONSTRAINT "offer_variants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_activity_log"
    ADD CONSTRAINT "organization_activity_log_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_activity_log"
    ADD CONSTRAINT "organization_activity_log_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_activity_log"
    ADD CONSTRAINT "organization_activity_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."piecework_activities"
    ADD CONSTRAINT "piecework_activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subcontractor_settlement_entries"
    ADD CONSTRAINT "subcontractor_settlement_entries_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subcontractor_settlement_entries"
    ADD CONSTRAINT "subcontractor_settlement_entries_case_subcontractor_id_fkey" FOREIGN KEY ("case_subcontractor_id") REFERENCES "public"."case_subcontractors"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subcontractor_settlement_entries"
    ADD CONSTRAINT "subcontractor_settlement_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subcontractor_settlement_entries"
    ADD CONSTRAINT "subcontractor_settlement_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subcontractor_settlement_entries"
    ADD CONSTRAINT "subcontractor_settlement_entries_subcontractor_id_fkey" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."subcontractors"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subcontractors"
    ADD CONSTRAINT "subcontractors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_invoice_category_rules"
    ADD CONSTRAINT "supplier_invoice_category_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_invoice_category_rules"
    ADD CONSTRAINT "supplier_invoice_category_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_invoice_import_batches"
    ADD CONSTRAINT "supplier_invoice_import_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_invoice_import_batches"
    ADD CONSTRAINT "supplier_invoice_import_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_invoices"
    ADD CONSTRAINT "supplier_invoices_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_invoices"
    ADD CONSTRAINT "supplier_invoices_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_invoices"
    ADD CONSTRAINT "supplier_invoices_case_subcontractor_id_fkey" FOREIGN KEY ("case_subcontractor_id") REFERENCES "public"."case_subcontractors"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_invoices"
    ADD CONSTRAINT "supplier_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_invoices"
    ADD CONSTRAINT "supplier_invoices_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "public"."supplier_invoice_import_batches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_invoices"
    ADD CONSTRAINT "supplier_invoices_linked_settlement_entry_id_fkey" FOREIGN KEY ("linked_settlement_entry_id") REFERENCES "public"."subcontractor_settlement_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_invoices"
    ADD CONSTRAINT "supplier_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_invoices"
    ADD CONSTRAINT "supplier_invoices_subcontractor_id_fkey" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."subcontractors"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_directory_profiles"
    ADD CONSTRAINT "user_directory_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_notifications"
    ADD CONSTRAINT "user_notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_notifications"
    ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_service_entries"
    ADD CONSTRAINT "vehicle_service_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_service_entries"
    ADD CONSTRAINT "vehicle_service_entries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."warehouse_audit_log"
    ADD CONSTRAINT "warehouse_audit_log_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warehouse_audit_log"
    ADD CONSTRAINT "warehouse_audit_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."warehouse_audit_log"
    ADD CONSTRAINT "warehouse_audit_log_warehouse_item_id_fkey" FOREIGN KEY ("warehouse_item_id") REFERENCES "public"."warehouse_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warehouse_items"
    ADD CONSTRAINT "warehouse_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warehouse_items"
    ADD CONSTRAINT "warehouse_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."warehouse_movements"
    ADD CONSTRAINT "warehouse_movements_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warehouse_movements"
    ADD CONSTRAINT "warehouse_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warehouse_movements"
    ADD CONSTRAINT "warehouse_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."warehouse_movements"
    ADD CONSTRAINT "warehouse_movements_warehouse_item_id_fkey" FOREIGN KEY ("warehouse_item_id") REFERENCES "public"."warehouse_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_hours"
    ADD CONSTRAINT "work_hours_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."work_hours"
    ADD CONSTRAINT "work_hours_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."work_hours"
    ADD CONSTRAINT "work_hours_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."work_hours"
    ADD CONSTRAINT "work_hours_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE "public"."ai_conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_conversations_delete" ON "public"."ai_conversations" FOR DELETE USING ((("created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("organization_id")));



CREATE POLICY "ai_conversations_insert" ON "public"."ai_conversations" FOR INSERT WITH CHECK ((("created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("organization_id")));



CREATE POLICY "ai_conversations_select" ON "public"."ai_conversations" FOR SELECT USING ((("created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("organization_id")));



CREATE POLICY "ai_conversations_update" ON "public"."ai_conversations" FOR UPDATE USING ((("created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("organization_id"))) WITH CHECK ((("created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("organization_id")));



ALTER TABLE "public"."ai_generated_artifacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_generated_artifacts_insert" ON "public"."ai_generated_artifacts" FOR INSERT WITH CHECK ((("created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("organization_id")));



CREATE POLICY "ai_generated_artifacts_select" ON "public"."ai_generated_artifacts" FOR SELECT USING ((("created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("organization_id")));



ALTER TABLE "public"."ai_message_attachments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_message_attachments_insert" ON "public"."ai_message_attachments" FOR INSERT WITH CHECK ((("created_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."ai_conversations" "c"
  WHERE (("c"."id" = "ai_message_attachments"."conversation_id") AND ("c"."organization_id" = "ai_message_attachments"."organization_id") AND ("c"."created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("c"."organization_id"))))));



CREATE POLICY "ai_message_attachments_select" ON "public"."ai_message_attachments" FOR SELECT USING ((("created_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."ai_conversations" "c"
  WHERE (("c"."id" = "ai_message_attachments"."conversation_id") AND ("c"."organization_id" = "ai_message_attachments"."organization_id") AND ("c"."created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("c"."organization_id"))))));



CREATE POLICY "ai_message_attachments_update" ON "public"."ai_message_attachments" FOR UPDATE USING ((("created_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."ai_conversations" "c"
  WHERE (("c"."id" = "ai_message_attachments"."conversation_id") AND ("c"."organization_id" = "ai_message_attachments"."organization_id") AND ("c"."created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("c"."organization_id")))))) WITH CHECK ((("created_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."ai_conversations" "c"
  WHERE (("c"."id" = "ai_message_attachments"."conversation_id") AND ("c"."organization_id" = "ai_message_attachments"."organization_id") AND ("c"."created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("c"."organization_id"))))));



ALTER TABLE "public"."ai_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_messages_insert" ON "public"."ai_messages" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."ai_conversations" "c"
  WHERE (("c"."id" = "ai_messages"."conversation_id") AND ("c"."organization_id" = "ai_messages"."organization_id") AND ("c"."created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("c"."organization_id")))));



CREATE POLICY "ai_messages_select" ON "public"."ai_messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."ai_conversations" "c"
  WHERE (("c"."id" = "ai_messages"."conversation_id") AND ("c"."created_by" = "auth"."uid"()) AND "public"."can_use_ai_assistant"("c"."organization_id")))));



ALTER TABLE "public"."attachments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attachments_delete" ON "public"."attachments" FOR DELETE USING (("public"."can_access_case_in_org"("case_id", "organization_id") AND (("uploaded_by" = "auth"."uid"()) OR "public"."is_case_owner_or_manager"("case_id"))));



CREATE POLICY "attachments_insert" ON "public"."attachments" FOR INSERT WITH CHECK (("public"."can_access_case_in_org"("case_id", "organization_id") AND (("uploaded_by" IS NULL) OR ("uploaded_by" = "auth"."uid"())) AND ("public"."uuid_or_null"(("storage"."foldername"("storage_path"))[1]) = "organization_id") AND ("public"."uuid_or_null"(("storage"."foldername"("storage_path"))[2]) = "case_id")));



CREATE POLICY "attachments_select" ON "public"."attachments" FOR SELECT USING ("public"."can_access_case_in_org"("case_id", "organization_id"));



CREATE POLICY "attachments_update" ON "public"."attachments" FOR UPDATE USING (("public"."can_access_case_in_org"("case_id", "organization_id") AND (("uploaded_by" = "auth"."uid"()) OR "public"."is_case_owner_or_manager"("case_id")))) WITH CHECK (("public"."can_access_case_in_org"("case_id", "organization_id") AND (("uploaded_by" = "auth"."uid"()) OR "public"."is_case_owner_or_manager"("case_id")) AND ("public"."uuid_or_null"(("storage"."foldername"("storage_path"))[1]) = "organization_id") AND ("public"."uuid_or_null"(("storage"."foldername"("storage_path"))[2]) = "case_id")));



ALTER TABLE "public"."case_as_built_estimates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_as_built_estimates_delete" ON "public"."case_as_built_estimates" FOR DELETE USING ("public"."is_case_owner_or_manager"("case_id"));



CREATE POLICY "case_as_built_estimates_insert" ON "public"."case_as_built_estimates" FOR INSERT WITH CHECK (("public"."can_access_case_commercial_in_org"("case_id", "organization_id") AND (("created_by" IS NULL) OR ("created_by" = "auth"."uid"())) AND ("public"."uuid_or_null"(("storage"."foldername"("storage_path"))[1]) = "organization_id") AND ("public"."uuid_or_null"(("storage"."foldername"("storage_path"))[2]) = "case_id")));



CREATE POLICY "case_as_built_estimates_select" ON "public"."case_as_built_estimates" FOR SELECT USING ("public"."can_access_case_commercial_in_org"("case_id", "organization_id"));



ALTER TABLE "public"."case_assignees" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_assignees_delete" ON "public"."case_assignees" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."cases" "c"
  WHERE (("c"."id" = "case_assignees"."case_id") AND "public"."is_member_of"("c"."organization_id") AND (("public"."my_role_in"("c"."organization_id") = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"])) OR (("public"."my_role_in"("c"."organization_id") = 'sales'::"text") AND (("c"."created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("c"."id"))))))));



CREATE POLICY "case_assignees_insert" ON "public"."case_assignees" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."cases" "c"
  WHERE (("c"."id" = "case_assignees"."case_id") AND "public"."is_member_of"("c"."organization_id") AND (("public"."my_role_in"("c"."organization_id") = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"])) OR (("public"."my_role_in"("c"."organization_id") = 'sales'::"text") AND (("c"."created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("c"."id"))))))));



CREATE POLICY "case_assignees_select" ON "public"."case_assignees" FOR SELECT USING ("public"."can_access_case"("case_id"));



CREATE POLICY "case_assignees_update" ON "public"."case_assignees" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."cases" "c"
  WHERE (("c"."id" = "case_assignees"."case_id") AND "public"."is_member_of"("c"."organization_id") AND (("public"."my_role_in"("c"."organization_id") = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"])) OR (("public"."my_role_in"("c"."organization_id") = 'sales'::"text") AND (("c"."created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("c"."id")))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."cases" "c"
  WHERE (("c"."id" = "case_assignees"."case_id") AND "public"."is_member_of"("c"."organization_id") AND (("public"."my_role_in"("c"."organization_id") = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"])) OR (("public"."my_role_in"("c"."organization_id") = 'sales'::"text") AND (("c"."created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("c"."id"))))))));



ALTER TABLE "public"."case_commercial_details" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_commercial_details_delete" ON "public"."case_commercial_details" FOR DELETE TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_case_commercial"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."cases" "c"
  WHERE (("c"."id" = "case_commercial_details"."case_id") AND ("c"."organization_id" = "case_commercial_details"."organization_id") AND ("public"."can_see_all_cases"("c"."organization_id") OR ("c"."created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("c"."id")))))));



CREATE POLICY "case_commercial_details_insert" ON "public"."case_commercial_details" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_case_commercial"("organization_id") AND (COALESCE("updated_by", "auth"."uid"()) = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."cases" "c"
  WHERE (("c"."id" = "case_commercial_details"."case_id") AND ("c"."organization_id" = "case_commercial_details"."organization_id") AND ("public"."can_see_all_cases"("c"."organization_id") OR ("c"."created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("c"."id")))))));



CREATE POLICY "case_commercial_details_select" ON "public"."case_commercial_details" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_case_commercial"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."cases" "c"
  WHERE (("c"."id" = "case_commercial_details"."case_id") AND ("c"."organization_id" = "case_commercial_details"."organization_id") AND ("public"."can_see_all_cases"("c"."organization_id") OR ("c"."created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("c"."id")))))));



CREATE POLICY "case_commercial_details_update" ON "public"."case_commercial_details" FOR UPDATE TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_case_commercial"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_case_commercial"("organization_id") AND (COALESCE("updated_by", "auth"."uid"()) = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."cases" "c"
  WHERE (("c"."id" = "case_commercial_details"."case_id") AND ("c"."organization_id" = "case_commercial_details"."organization_id") AND ("public"."can_see_all_cases"("c"."organization_id") OR ("c"."created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("c"."id")))))));



ALTER TABLE "public"."case_direct_costs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_direct_costs_manage" ON "public"."case_direct_costs" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."case_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_notes_delete" ON "public"."case_notes" FOR DELETE USING ((("user_id" = "auth"."uid"()) AND "public"."can_access_case_in_org"("case_id", "organization_id")));



CREATE POLICY "case_notes_insert" ON "public"."case_notes" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."can_access_case_in_org"("case_id", "organization_id")));



CREATE POLICY "case_notes_select" ON "public"."case_notes" FOR SELECT USING ("public"."can_access_case_in_org"("case_id", "organization_id"));



CREATE POLICY "case_notes_update" ON "public"."case_notes" FOR UPDATE USING ((("user_id" = "auth"."uid"()) AND "public"."can_access_case_in_org"("case_id", "organization_id"))) WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."can_access_case_in_org"("case_id", "organization_id")));



ALTER TABLE "public"."case_profitability_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_profitability_plans_manage" ON "public"."case_profitability_plans" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."case_protocols" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_schedule_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_subcontractors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_subcontractors_manage" ON "public"."case_subcontractors" USING ("public"."can_access_case_commercial_in_org"("case_id", "organization_id")) WITH CHECK ("public"."can_access_case_commercial_in_org"("case_id", "organization_id"));



CREATE POLICY "case_subcontractors_select" ON "public"."case_subcontractors" FOR SELECT USING ("public"."can_access_case_commercial_in_org"("case_id", "organization_id"));



ALTER TABLE "public"."case_task_assignees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_task_comment_attachments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_task_comment_attachments_delete" ON "public"."case_task_comment_attachments" FOR DELETE USING (("public"."can_access_task_in_org"("task_id", "organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."case_task_comments" "c"
  WHERE (("c"."id" = "case_task_comment_attachments"."comment_id") AND ("c"."user_id" = "auth"."uid"()))))));



CREATE POLICY "case_task_comment_attachments_insert" ON "public"."case_task_comment_attachments" FOR INSERT WITH CHECK (("public"."can_access_task_in_org"("task_id", "organization_id") AND ("public"."uuid_or_null"(("storage"."foldername"("storage_path"))[1]) = "organization_id") AND (("storage"."foldername"("storage_path"))[2] = 'tasks'::"text") AND ("public"."uuid_or_null"(("storage"."foldername"("storage_path"))[3]) = "task_id") AND (EXISTS ( SELECT 1
   FROM "public"."case_task_comments" "c"
  WHERE (("c"."id" = "case_task_comment_attachments"."comment_id") AND ("c"."task_id" = "case_task_comment_attachments"."task_id") AND ("c"."organization_id" = "case_task_comment_attachments"."organization_id") AND ("c"."user_id" = "auth"."uid"()))))));



CREATE POLICY "case_task_comment_attachments_select" ON "public"."case_task_comment_attachments" FOR SELECT USING ("public"."can_access_task_in_org"("task_id", "organization_id"));



ALTER TABLE "public"."case_task_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_task_comments_delete" ON "public"."case_task_comments" FOR DELETE USING ((("user_id" = "auth"."uid"()) AND "public"."can_access_task_in_org"("task_id", "organization_id")));



CREATE POLICY "case_task_comments_insert" ON "public"."case_task_comments" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."can_access_task_in_org"("task_id", "organization_id")));



CREATE POLICY "case_task_comments_select" ON "public"."case_task_comments" FOR SELECT USING ("public"."can_access_task_in_org"("task_id", "organization_id"));



ALTER TABLE "public"."case_task_reads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_task_reads_all" ON "public"."case_task_reads" USING ((("user_id" = "auth"."uid"()) AND "public"."can_access_task_in_org"("task_id", "organization_id"))) WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."can_access_task_in_org"("task_id", "organization_id")));



ALTER TABLE "public"."case_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_tasks_delete" ON "public"."case_tasks" FOR DELETE USING (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = "auth"."uid"()) AND ("organization_members"."role" = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"]))))));



CREATE POLICY "case_tasks_insert" ON "public"."case_tasks" FOR INSERT WITH CHECK (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "case_tasks_select" ON "public"."case_tasks" FOR SELECT USING (("public"."is_member_of"("organization_id") AND (("public"."my_role_in"("organization_id") = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"])) OR ("assignee_id" = "auth"."uid"()) OR ("created_by" = "auth"."uid"()) OR "public"."is_task_assignee"("id"))));



CREATE POLICY "case_tasks_update" ON "public"."case_tasks" FOR UPDATE USING ((("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))) AND ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."organization_id" = "case_tasks"."organization_id") AND ("m"."role" = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"]))))) OR ("assignee_id" = "auth"."uid"()) OR ("created_by" = "auth"."uid"())))) WITH CHECK (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."cases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cases_delete" ON "public"."cases" FOR DELETE USING (("public"."is_member_of"("organization_id") AND ("public"."my_role_in"("organization_id") = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"]))));



CREATE POLICY "cases_insert" ON "public"."cases" FOR INSERT WITH CHECK (("public"."is_member_of"("organization_id") AND ("public"."my_role_in"("organization_id") = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text", 'sales'::"text"]))));



CREATE POLICY "cases_select" ON "public"."cases" FOR SELECT USING (("public"."is_member_of"("organization_id") AND ("public"."can_see_all_cases"("organization_id") OR ("created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("id"))));



CREATE POLICY "cases_update" ON "public"."cases" FOR UPDATE TO "authenticated" USING (("public"."is_member_of"("organization_id") AND ("public"."can_see_all_cases"("organization_id") OR (("public"."my_role_in"("organization_id") = 'sales'::"text") AND (("created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("id")))))) WITH CHECK (("public"."is_member_of"("organization_id") AND ("public"."can_see_all_cases"("organization_id") OR (("public"."my_role_in"("organization_id") = 'sales'::"text") AND (("created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("id"))))));



CREATE POLICY "catalog_all" ON "public"."catalog_items" USING (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"())))) WITH CHECK (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."catalog_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_policies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_policies_manage" ON "public"."company_policies" TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."crews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "crews_all" ON "public"."crews" USING (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"())))) WITH CHECK (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."digest_email_prefs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "digest_email_prefs_owner_all" ON "public"."digest_email_prefs" USING ("public"."is_owner_of"("organization_id")) WITH CHECK ("public"."is_owner_of"("organization_id"));



CREATE POLICY "digest_email_prefs_self_read" ON "public"."digest_email_prefs" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."employee_compensation" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_compensation_payroll" ON "public"."employee_compensation" USING ("public"."can_view_payroll"("organization_id")) WITH CHECK (("public"."can_view_payroll"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."employee_profiles" "ep"
  WHERE (("ep"."id" = "employee_compensation"."employee_id") AND ("ep"."organization_id" = "ep"."organization_id"))))));



ALTER TABLE "public"."employee_crew_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_crew_history_manage" ON "public"."employee_crew_history" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."employee_documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_documents_manage" ON "public"."employee_documents" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."employee_monthly_settlements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_monthly_settlements_payroll" ON "public"."employee_monthly_settlements" USING ("public"."can_view_payroll"("organization_id")) WITH CHECK (("public"."can_view_payroll"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."employee_profiles" "ep"
  WHERE (("ep"."id" = "employee_monthly_settlements"."employee_id") AND ("ep"."organization_id" = "ep"."organization_id"))))));



ALTER TABLE "public"."employee_piecework_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_piecework_entries_payroll" ON "public"."employee_piecework_entries" USING ("public"."can_view_payroll"("organization_id")) WITH CHECK ("public"."can_view_payroll"("organization_id"));



ALTER TABLE "public"."employee_position_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_position_history_manage" ON "public"."employee_position_history" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."employee_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_profiles_manage" ON "public"."employee_profiles" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."employee_settlement_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_settlement_entries_payroll" ON "public"."employee_settlement_entries" USING ("public"."can_view_payroll"("organization_id")) WITH CHECK (("public"."can_view_payroll"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."employee_profiles" "ep"
  WHERE (("ep"."id" = "employee_settlement_entries"."employee_id") AND ("ep"."organization_id" = "ep"."organization_id"))))));



ALTER TABLE "public"."employee_settlement_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_settlement_history_payroll" ON "public"."employee_settlement_history" FOR SELECT USING ("public"."can_view_payroll"("organization_id"));



ALTER TABLE "public"."equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "equipment_assignments_insert" ON "public"."equipment_assignments" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_operate_resources"("organization_id") AND ("created_by" = "auth"."uid"())));



CREATE POLICY "equipment_assignments_select" ON "public"."equipment_assignments" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_operate_resources"("organization_id")));



CREATE POLICY "equipment_assignments_update" ON "public"."equipment_assignments" FOR UPDATE TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_operate_resources"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_operate_resources"("organization_id")));



CREATE POLICY "equipment_manage" ON "public"."equipment" TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



CREATE POLICY "equipment_select" ON "public"."equipment" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_operate_resources"("organization_id")));



ALTER TABLE "public"."estimate_template_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "estimate_template_lines_manage" ON "public"."estimate_template_lines" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_case_commercial"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_case_commercial"("organization_id")));



CREATE POLICY "estimate_template_lines_select" ON "public"."estimate_template_lines" FOR SELECT USING (("public"."is_member_of"("organization_id") AND "public"."can_see_case_commercial"("organization_id")));



ALTER TABLE "public"."estimate_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "estimate_templates_manage" ON "public"."estimate_templates" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_case_commercial"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_case_commercial"("organization_id")));



CREATE POLICY "estimate_templates_select" ON "public"."estimate_templates" FOR SELECT USING (("public"."is_member_of"("organization_id") AND "public"."can_see_case_commercial"("organization_id")));



ALTER TABLE "public"."extra_works" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extra_works_manage" ON "public"."extra_works" USING ("public"."can_access_case_commercial_in_org"("case_id", "organization_id")) WITH CHECK ("public"."can_access_case_commercial_in_org"("case_id", "organization_id"));



CREATE POLICY "extra_works_select" ON "public"."extra_works" FOR SELECT USING ("public"."can_access_case_commercial_in_org"("case_id", "organization_id"));



ALTER TABLE "public"."financial_control_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "financial_control_items_delete" ON "public"."financial_control_items" FOR DELETE USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id") AND (("section" <> 'employee_settlement'::"text") OR "public"."can_view_payroll"("organization_id"))));



CREATE POLICY "financial_control_items_insert" ON "public"."financial_control_items" FOR INSERT WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id") AND (("section" <> 'employee_settlement'::"text") OR "public"."can_view_payroll"("organization_id"))));



CREATE POLICY "financial_control_items_select" ON "public"."financial_control_items" FOR SELECT USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id") AND (("section" <> 'employee_settlement'::"text") OR "public"."can_view_payroll"("organization_id"))));



CREATE POLICY "financial_control_items_update" ON "public"."financial_control_items" FOR UPDATE USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id") AND (("section" <> 'employee_settlement'::"text") OR "public"."can_view_payroll"("organization_id")))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id") AND (("section" <> 'employee_settlement'::"text") OR "public"."can_view_payroll"("organization_id"))));



ALTER TABLE "public"."invoice_counters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_counters_select" ON "public"."invoice_counters" FOR SELECT USING (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."invoice_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_lines_all" ON "public"."invoice_lines" USING (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"())))) WITH CHECK (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "invoice_lines_manage" ON "public"."invoice_lines" USING ((EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE (("i"."id" = "invoice_lines"."invoice_id") AND "public"."is_member_of"("i"."organization_id") AND "public"."can_see_all_cases"("i"."organization_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE (("i"."id" = "invoice_lines"."invoice_id") AND "public"."is_member_of"("i"."organization_id") AND "public"."can_see_all_cases"("i"."organization_id")))));



ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoices_all" ON "public"."invoices" USING (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"())))) WITH CHECK (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "invoices_manage" ON "public"."invoices" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."job_positions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "job_positions_all" ON "public"."job_positions" USING (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"())))) WITH CHECK (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."notification_dispatch_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."offer_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "offer_lines_manage" ON "public"."offer_lines" USING ((EXISTS ( SELECT 1
   FROM "public"."offer_variants" "v"
  WHERE (("v"."id" = "offer_lines"."variant_id") AND ("v"."organization_id" = "offer_lines"."organization_id") AND "public"."can_access_case_commercial_in_org"("v"."case_id", "v"."organization_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."offer_variants" "v"
  WHERE (("v"."id" = "offer_lines"."variant_id") AND ("v"."organization_id" = "offer_lines"."organization_id") AND "public"."can_access_case_commercial_in_org"("v"."case_id", "v"."organization_id")))));



CREATE POLICY "offer_lines_select" ON "public"."offer_lines" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."offer_variants" "v"
  WHERE (("v"."id" = "offer_lines"."variant_id") AND ("v"."organization_id" = "offer_lines"."organization_id") AND "public"."can_access_case_commercial_in_org"("v"."case_id", "v"."organization_id")))));



ALTER TABLE "public"."offer_variants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "offer_variants_manage" ON "public"."offer_variants" USING ("public"."can_access_case_commercial_in_org"("case_id", "organization_id")) WITH CHECK ("public"."can_access_case_commercial_in_org"("case_id", "organization_id"));



CREATE POLICY "offer_variants_select" ON "public"."offer_variants" FOR SELECT USING ("public"."can_access_case_commercial_in_org"("case_id", "organization_id"));



CREATE POLICY "org_activity_log_insert" ON "public"."organization_activity_log" FOR INSERT WITH CHECK ("public"."is_member_of"("organization_id"));



CREATE POLICY "org_activity_log_select" ON "public"."organization_activity_log" FOR SELECT USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id") AND (("data_scope" = 'operational'::"text") OR "public"."can_view_payroll"("organization_id"))));



CREATE POLICY "org_members_select" ON "public"."organization_members" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_member_of"("organization_id")));



CREATE POLICY "org_members_update" ON "public"."organization_members" FOR UPDATE USING ("public"."is_owner_of"("organization_id")) WITH CHECK ("public"."is_owner_of"("organization_id"));



CREATE POLICY "org_select" ON "public"."organizations" FOR SELECT USING (("id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "org_update_owner" ON "public"."organizations" FOR UPDATE USING (("id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = "auth"."uid"()) AND ("organization_members"."role" = 'owner'::"text"))))) WITH CHECK (("id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = "auth"."uid"()) AND ("organization_members"."role" = 'owner'::"text")))));



ALTER TABLE "public"."organization_activity_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments_manage" ON "public"."payments" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."piecework_activities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "piecework_activities_payroll" ON "public"."piecework_activities" USING ("public"."can_view_payroll"("organization_id")) WITH CHECK ("public"."can_view_payroll"("organization_id"));



CREATE POLICY "protocols_delete" ON "public"."case_protocols" FOR DELETE USING (("public"."is_case_owner_or_manager"("case_id") OR ("created_by" = "auth"."uid"())));



CREATE POLICY "protocols_insert" ON "public"."case_protocols" FOR INSERT WITH CHECK (("public"."can_access_case_in_org"("case_id", "organization_id") AND (("created_by" IS NULL) OR ("created_by" = "auth"."uid"()))));



CREATE POLICY "protocols_select" ON "public"."case_protocols" FOR SELECT USING ("public"."can_access_case_in_org"("case_id", "organization_id"));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_subscriptions_own" ON "public"."push_subscriptions" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."reminders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reminders_manage" ON "public"."reminders" USING ("public"."can_access_case_commercial_in_org"("case_id", "organization_id")) WITH CHECK ("public"."can_access_case_commercial_in_org"("case_id", "organization_id"));



CREATE POLICY "reminders_select" ON "public"."reminders" FOR SELECT USING ("public"."can_access_case_commercial_in_org"("case_id", "organization_id"));



CREATE POLICY "schedule_manage" ON "public"."case_schedule_items" USING ("public"."can_access_case_in_org"("case_id", "organization_id")) WITH CHECK ("public"."can_access_case_in_org"("case_id", "organization_id"));



CREATE POLICY "schedule_select" ON "public"."case_schedule_items" FOR SELECT USING ("public"."can_access_case_in_org"("case_id", "organization_id"));



ALTER TABLE "public"."subcontractor_settlement_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subcontractor_settlement_entries_manage" ON "public"."subcontractor_settlement_entries" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."subcontractors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subcontractors_select" ON "public"."subcontractors" FOR SELECT USING (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "subcontractors_write" ON "public"."subcontractors" USING (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = "auth"."uid"()) AND ("organization_members"."role" = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"])))))) WITH CHECK (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = "auth"."uid"()) AND ("organization_members"."role" = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"]))))));



ALTER TABLE "public"."supplier_invoice_category_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supplier_invoice_category_rules_manage" ON "public"."supplier_invoice_category_rules" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."supplier_invoice_import_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supplier_invoice_import_batches_manage" ON "public"."supplier_invoice_import_batches" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."supplier_invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supplier_invoices_manage" ON "public"."supplier_invoices" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



CREATE POLICY "task_assignees_delete" ON "public"."case_task_assignees" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."case_tasks" "ct"
  WHERE (("ct"."id" = "case_task_assignees"."task_id") AND "public"."is_member_of"("ct"."organization_id")))));



CREATE POLICY "task_assignees_insert" ON "public"."case_task_assignees" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."case_tasks" "ct"
  WHERE (("ct"."id" = "case_task_assignees"."task_id") AND "public"."is_member_of"("ct"."organization_id")))));



CREATE POLICY "task_assignees_select" ON "public"."case_task_assignees" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."case_tasks" "ct"
  WHERE (("ct"."id" = "case_task_assignees"."task_id") AND "public"."is_member_of"("ct"."organization_id")))));



ALTER TABLE "public"."user_directory_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_directory_profiles_select" ON "public"."user_directory_profiles" FOR SELECT TO "authenticated" USING ("public"."can_view_directory_profile"("user_id"));



ALTER TABLE "public"."user_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_notifications_select" ON "public"."user_notifications" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_notifications_update" ON "public"."user_notifications" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."vehicle_service_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vehicle_service_manage" ON "public"."vehicle_service_entries" TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."vehicles" "v"
  WHERE (("v"."id" = "vehicle_service_entries"."vehicle_id") AND ("v"."organization_id" = "vehicle_service_entries"."organization_id"))))));



CREATE POLICY "vehicle_service_select" ON "public"."vehicle_service_entries" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."vehicles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vehicles_manage" ON "public"."vehicles" TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



CREATE POLICY "vehicles_select" ON "public"."vehicles" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



ALTER TABLE "public"."warehouse_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "warehouse_audit_log_insert" ON "public"."warehouse_audit_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id") AND (COALESCE("created_by", "auth"."uid"()) = "auth"."uid"())));



CREATE POLICY "warehouse_audit_log_select" ON "public"."warehouse_audit_log" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_operate_resources"("organization_id")));



ALTER TABLE "public"."warehouse_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "warehouse_items_manage" ON "public"."warehouse_items" TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id"))) WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_see_all_cases"("organization_id")));



CREATE POLICY "warehouse_items_select" ON "public"."warehouse_items" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_operate_resources"("organization_id")));



ALTER TABLE "public"."warehouse_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "warehouse_movements_insert" ON "public"."warehouse_movements" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_member_of"("organization_id") AND "public"."can_operate_resources"("organization_id") AND ("created_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."warehouse_items" "wi"
  WHERE (("wi"."id" = "warehouse_movements"."warehouse_item_id") AND ("wi"."organization_id" = "warehouse_movements"."organization_id")))) AND (("case_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."cases" "c"
  WHERE (("c"."id" = "warehouse_movements"."case_id") AND ("c"."organization_id" = "warehouse_movements"."organization_id") AND ("public"."can_see_all_cases"("c"."organization_id") OR ("c"."created_by" = "auth"."uid"()) OR "public"."is_case_assignee"("c"."id"))))))));



CREATE POLICY "warehouse_movements_select" ON "public"."warehouse_movements" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("organization_id") AND "public"."can_operate_resources"("organization_id")));



ALTER TABLE "public"."work_hours" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "work_hours_select" ON "public"."work_hours" FOR SELECT USING (("public"."is_member_of"("organization_id") AND ("public"."can_see_all_cases"("organization_id") OR ("created_by" = "auth"."uid"()) OR (("case_id" IS NOT NULL) AND "public"."can_access_case_in_org"("case_id", "organization_id")) OR (("case_id" IS NULL) AND ("public"."my_role_in"("organization_id") = 'brygadzista'::"text")))));



CREATE POLICY "work_hours_write" ON "public"."work_hours" USING (("public"."can_edit_work_hours"("organization_id") AND ("public"."can_see_all_cases"("organization_id") OR ("created_by" = "auth"."uid"()) OR ("case_id" IS NULL) OR "public"."can_access_case_in_org"("case_id", "organization_id")))) WITH CHECK (("public"."can_edit_work_hours"("organization_id") AND ("public"."can_see_all_cases"("organization_id") OR ("created_by" = "auth"."uid"()) OR ("case_id" IS NULL) OR "public"."can_access_case_in_org"("case_id", "organization_id"))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."case_task_comments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."user_notifications";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."add_employee_piecework_entry"("target_org" "uuid", "target_employee" "uuid", "target_activity" "uuid", "target_case" "uuid", "target_quantity" numeric, "target_date" "date", "target_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_employee_piecework_entry"("target_org" "uuid", "target_employee" "uuid", "target_activity" "uuid", "target_case" "uuid", "target_quantity" numeric, "target_date" "date", "target_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_employee_piecework_entry"("target_org" "uuid", "target_employee" "uuid", "target_activity" "uuid", "target_case" "uuid", "target_quantity" numeric, "target_date" "date", "target_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_employee_piecework_entry"("target_org" "uuid", "target_employee" "uuid", "target_activity" "uuid", "target_case" "uuid", "target_quantity" numeric, "target_date" "date", "target_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_warehouse_movement"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_warehouse_movement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_warehouse_movement"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_case"("target_case" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_case"("target_case" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_case"("target_case" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_case"("target_case" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_case_commercial_in_org"("target_case" "uuid", "target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_case_commercial_in_org"("target_case" "uuid", "target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_case_commercial_in_org"("target_case" "uuid", "target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_case_commercial_in_org"("target_case" "uuid", "target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_case_in_org"("target_case" "uuid", "target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_case_in_org"("target_case" "uuid", "target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_case_in_org"("target_case" "uuid", "target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_case_in_org"("target_case" "uuid", "target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_task_in_org"("target_task" "uuid", "target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_task_in_org"("target_task" "uuid", "target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_task_in_org"("target_task" "uuid", "target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_task_in_org"("target_task" "uuid", "target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_delete_case_attachment_object"("object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_delete_case_attachment_object"("object_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_delete_case_attachment_object"("object_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_delete_case_attachment_object"("object_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_edit_work_hours"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_edit_work_hours"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_edit_work_hours"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_edit_work_hours"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_insert_case_attachment_object"("object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_insert_case_attachment_object"("object_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_insert_case_attachment_object"("object_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_insert_case_attachment_object"("object_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_operate_resources"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_operate_resources"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_operate_resources"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_operate_resources"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_see_all_cases"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_see_all_cases"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_see_all_cases"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_see_all_cases"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_see_case_commercial"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_see_case_commercial"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_see_case_commercial"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_see_case_commercial"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_select_case_attachment_object"("object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_select_case_attachment_object"("object_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_select_case_attachment_object"("object_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_select_case_attachment_object"("object_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_use_ai_assistant"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_use_ai_assistant"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_use_ai_assistant"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_use_ai_assistant"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_directory_profile"("target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_directory_profile"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_directory_profile"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_directory_profile"("target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_employee_hr"("target_employee_id" "uuid", "target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_employee_hr"("target_employee_id" "uuid", "target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_employee_hr"("target_employee_id" "uuid", "target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_employee_hr"("target_employee_id" "uuid", "target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_labor_costs"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_labor_costs"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_labor_costs"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_labor_costs"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_payroll"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_payroll"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_payroll"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_payroll"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_org_for_user"("target_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_org_for_user"("target_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_org_for_user"("target_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_org_for_user"("target_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_employee_piecework_entry"("target_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_employee_piecework_entry"("target_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_employee_piecework_entry"("target_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_employee_piecework_entry"("target_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."employee_hr_documents_visible"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."employee_hr_documents_visible"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."employee_hr_documents_visible"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."employee_hr_documents_visible"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."employee_hr_profiles_visible"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."employee_hr_profiles_visible"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."employee_hr_profiles_visible"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."employee_hr_profiles_visible"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."employee_piecework_entries_operational"("target_org" "uuid", "date_from" "date", "date_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."employee_piecework_entries_operational"("target_org" "uuid", "date_from" "date", "date_to" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."employee_piecework_entries_operational"("target_org" "uuid", "date_from" "date", "date_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."employee_piecework_entries_operational"("target_org" "uuid", "date_from" "date", "date_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."employee_work_profiles_visible"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."employee_work_profiles_visible"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."employee_work_profiles_visible"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."employee_work_profiles_visible"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_user_org"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_user_org"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_user_org"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_user_org"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_case_assignee"("target_case" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_case_assignee"("target_case" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_case_assignee"("target_case" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_case_assignee"("target_case" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_case_owner_or_manager"("target_case" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_case_owner_or_manager"("target_case" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_case_owner_or_manager"("target_case" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_case_owner_or_manager"("target_case" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_member_of"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_member_of"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_owner_of"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_owner_of"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_owner_of"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_owner_of"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_task_assignee"("target_task" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_task_assignee"("target_task" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_task_assignee"("target_task" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_task_assignee"("target_task" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_organization_activity"("p_organization_id" "uuid", "p_category" "text", "p_action" "text", "p_summary" "text", "p_details" "text", "p_case_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_meta" "jsonb", "p_created_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_organization_activity"("p_organization_id" "uuid", "p_category" "text", "p_action" "text", "p_summary" "text", "p_details" "text", "p_case_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_meta" "jsonb", "p_created_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."log_organization_activity"("p_organization_id" "uuid", "p_category" "text", "p_action" "text", "p_summary" "text", "p_details" "text", "p_case_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_meta" "jsonb", "p_created_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_organization_activity"("p_organization_id" "uuid", "p_category" "text", "p_action" "text", "p_summary" "text", "p_details" "text", "p_case_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_meta" "jsonb", "p_created_by" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_role_in"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_role_in"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."my_role_in"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_role_in"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."next_invoice_seq"("p_org" "uuid", "p_kind" "text", "p_year" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_invoice_seq"("p_org" "uuid", "p_kind" "text", "p_year" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."next_invoice_seq"("p_org" "uuid", "p_kind" "text", "p_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."next_invoice_seq"("p_org" "uuid", "p_kind" "text", "p_year" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."organization_member_directory"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."organization_member_directory"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."organization_member_directory"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."owns_ai_attachment_object"("name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."owns_ai_attachment_object"("name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."owns_ai_attachment_object"("name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."owns_ai_attachment_object"("name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."payroll_labor_costs_aggregated"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."payroll_labor_costs_aggregated"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."payroll_labor_costs_aggregated"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."payroll_labor_costs_aggregated"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."piecework_activities_operational"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."piecework_activities_operational"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."piecework_activities_operational"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."piecework_activities_operational"("target_org" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_case_security_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_case_security_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_case_security_columns"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_equipment_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_equipment_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_equipment_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_warehouse_item_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_warehouse_item_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_warehouse_item_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recalc_invoice_totals"() TO "anon";
GRANT ALL ON FUNCTION "public"."recalc_invoice_totals"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalc_invoice_totals"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_employee_compliance_dates"("p_employee_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_employee_compliance_dates"("p_employee_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_employee_compliance_dates"("p_employee_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_employee_monthly_settlement"("p_employee_id" "uuid", "p_period_month" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_employee_monthly_settlement"("p_employee_id" "uuid", "p_period_month" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_employee_monthly_settlement"("p_employee_id" "uuid", "p_period_month" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_employee_monthly_settlement"("p_employee_id" "uuid", "p_period_month" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_organization_member"("target_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_organization_member"("target_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_organization_member"("target_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_organization_member"("target_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_employee_compensation"("target_org" "uuid", "target_employee" "uuid", "target_hourly_rate" numeric, "target_day_rate" numeric, "target_monthly_salary" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_employee_compensation"("target_org" "uuid", "target_employee" "uuid", "target_hourly_rate" numeric, "target_day_rate" numeric, "target_monthly_salary" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."save_employee_compensation"("target_org" "uuid", "target_employee" "uuid", "target_hourly_rate" numeric, "target_day_rate" numeric, "target_monthly_salary" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_employee_compensation"("target_org" "uuid", "target_employee" "uuid", "target_hourly_rate" numeric, "target_day_rate" numeric, "target_monthly_salary" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."seed_catalog_for_org"("target_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."seed_catalog_for_org"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."seed_catalog_for_org"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_catalog_for_org"("target_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_employee_crew_assignment"("p_employee_id" "uuid", "p_crew_id" "uuid", "p_valid_from" "date", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_employee_crew_assignment"("p_employee_id" "uuid", "p_crew_id" "uuid", "p_valid_from" "date", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_employee_crew_assignment"("p_employee_id" "uuid", "p_crew_id" "uuid", "p_valid_from" "date", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_employee_crew_assignment"("p_employee_id" "uuid", "p_crew_id" "uuid", "p_valid_from" "date", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_employee_monthly_settlement_status"("p_settlement_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_employee_monthly_settlement_status"("p_settlement_id" "uuid", "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_employee_monthly_settlement_status"("p_settlement_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_employee_monthly_settlement_status"("p_settlement_id" "uuid", "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_employee_position_assignment"("p_employee_id" "uuid", "p_role_title" "text", "p_department" "text", "p_employment_type" "text", "p_manager_employee_id" "uuid", "p_valid_from" "date", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_employee_position_assignment"("p_employee_id" "uuid", "p_role_title" "text", "p_department" "text", "p_employment_type" "text", "p_manager_employee_id" "uuid", "p_valid_from" "date", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_employee_position_assignment"("p_employee_id" "uuid", "p_role_title" "text", "p_department" "text", "p_employment_type" "text", "p_manager_employee_id" "uuid", "p_valid_from" "date", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_employee_position_assignment"("p_employee_id" "uuid", "p_role_title" "text", "p_department" "text", "p_employment_type" "text", "p_manager_employee_id" "uuid", "p_valid_from" "date", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_member_role"("target_email" "text", "target_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_member_role"("target_email" "text", "target_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_member_role"("target_email" "text", "target_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_member_role"("target_email" "text", "target_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_own_push_enabled"("p_organization_id" "uuid", "p_enabled" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."set_own_push_enabled"("p_organization_id" "uuid", "p_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_own_push_enabled"("p_organization_id" "uuid", "p_enabled" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."stamp_case_commercial_details"() TO "anon";
GRANT ALL ON FUNCTION "public"."stamp_case_commercial_details"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."stamp_case_commercial_details"() TO "service_role";



GRANT ALL ON FUNCTION "public"."stamp_invoice_paid_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."stamp_invoice_paid_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."stamp_invoice_paid_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_user_directory_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_user_directory_profile"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_employee_profile_hr_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_employee_profile_hr_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_employee_profile_hr_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_employee_settlement_entry_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_employee_settlement_entry_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_employee_settlement_entry_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_employee_settlement_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_employee_settlement_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_employee_settlement_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_lock_employee_entries_for_closed_month"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_lock_employee_entries_for_closed_month"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_lock_employee_entries_for_closed_month"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_case_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_case_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_case_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_case_assignee_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_case_assignee_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_case_assignee_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_case_commercial_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_case_commercial_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_case_commercial_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_case_direct_cost_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_case_direct_cost_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_case_direct_cost_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_case_profitability_plan_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_case_profitability_plan_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_case_profitability_plan_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_case_task_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_case_task_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_case_task_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_employee_compensation_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_employee_compensation_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_employee_compensation_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_employee_crew_history_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_employee_crew_history_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_employee_crew_history_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_employee_document_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_employee_document_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_employee_document_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_employee_monthly_settlement_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_employee_monthly_settlement_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_employee_monthly_settlement_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_employee_position_history_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_employee_position_history_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_employee_position_history_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_employee_profile_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_employee_profile_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_employee_profile_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_equipment_assignment_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_equipment_assignment_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_equipment_assignment_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_extra_work_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_extra_work_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_extra_work_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_invoice_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_invoice_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_invoice_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_organization_profile_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_organization_profile_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_organization_profile_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_payment_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_payment_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_payment_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_subcontractor_settlement_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_subcontractor_settlement_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_subcontractor_settlement_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_supplier_invoice_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_supplier_invoice_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_supplier_invoice_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_supplier_invoice_import_batch_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_supplier_invoice_import_batch_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_supplier_invoice_import_batch_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_warehouse_audit_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_warehouse_audit_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_warehouse_audit_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_warehouse_movement_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_warehouse_movement_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_warehouse_movement_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_log_work_hours_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_log_work_hours_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_log_work_hours_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_refresh_employee_compliance_dates"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_refresh_employee_compliance_dates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_refresh_employee_compliance_dates"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_sync_profile_compliance_documents"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_sync_profile_compliance_documents"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_sync_profile_compliance_documents"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_touch_ai_conversation"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_touch_ai_conversation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_touch_ai_conversation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."uuid_or_null"("value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."uuid_or_null"("value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."uuid_or_null"("value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."uuid_or_null"("value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_equipment_assignment"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_equipment_assignment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_equipment_assignment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_supplier_invoice_settlement_link"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_supplier_invoice_settlement_link"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_supplier_invoice_settlement_link"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_warehouse_movement"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_warehouse_movement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_warehouse_movement"() TO "service_role";



GRANT ALL ON FUNCTION "public"."warehouse_movement_set_created_by"() TO "anon";
GRANT ALL ON FUNCTION "public"."warehouse_movement_set_created_by"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."warehouse_movement_set_created_by"() TO "service_role";


















GRANT ALL ON TABLE "public"."ai_conversations" TO "anon";
GRANT ALL ON TABLE "public"."ai_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."ai_generated_artifacts" TO "anon";
GRANT ALL ON TABLE "public"."ai_generated_artifacts" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_generated_artifacts" TO "service_role";



GRANT ALL ON TABLE "public"."ai_message_attachments" TO "anon";
GRANT ALL ON TABLE "public"."ai_message_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_message_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."ai_messages" TO "anon";
GRANT ALL ON TABLE "public"."ai_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_messages" TO "service_role";



GRANT ALL ON TABLE "public"."attachments" TO "anon";
GRANT ALL ON TABLE "public"."attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."attachments" TO "service_role";



GRANT ALL ON TABLE "public"."case_as_built_estimates" TO "anon";
GRANT ALL ON TABLE "public"."case_as_built_estimates" TO "authenticated";
GRANT ALL ON TABLE "public"."case_as_built_estimates" TO "service_role";



GRANT ALL ON TABLE "public"."case_assignees" TO "anon";
GRANT ALL ON TABLE "public"."case_assignees" TO "authenticated";
GRANT ALL ON TABLE "public"."case_assignees" TO "service_role";



GRANT ALL ON TABLE "public"."case_commercial_details" TO "anon";
GRANT ALL ON TABLE "public"."case_commercial_details" TO "authenticated";
GRANT ALL ON TABLE "public"."case_commercial_details" TO "service_role";



GRANT ALL ON TABLE "public"."case_direct_costs" TO "anon";
GRANT ALL ON TABLE "public"."case_direct_costs" TO "authenticated";
GRANT ALL ON TABLE "public"."case_direct_costs" TO "service_role";



GRANT ALL ON TABLE "public"."case_notes" TO "anon";
GRANT ALL ON TABLE "public"."case_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."case_notes" TO "service_role";



GRANT ALL ON TABLE "public"."case_profitability_plans" TO "anon";
GRANT ALL ON TABLE "public"."case_profitability_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."case_profitability_plans" TO "service_role";



GRANT ALL ON TABLE "public"."case_protocols" TO "anon";
GRANT ALL ON TABLE "public"."case_protocols" TO "authenticated";
GRANT ALL ON TABLE "public"."case_protocols" TO "service_role";



GRANT ALL ON TABLE "public"."cases" TO "anon";
GRANT ALL ON TABLE "public"."cases" TO "authenticated";
GRANT ALL ON TABLE "public"."cases" TO "service_role";



GRANT ALL ON TABLE "public"."case_records" TO "service_role";
GRANT SELECT ON TABLE "public"."case_records" TO "authenticated";



GRANT ALL ON TABLE "public"."case_schedule_items" TO "anon";
GRANT ALL ON TABLE "public"."case_schedule_items" TO "authenticated";
GRANT ALL ON TABLE "public"."case_schedule_items" TO "service_role";



GRANT ALL ON TABLE "public"."case_subcontractors" TO "anon";
GRANT ALL ON TABLE "public"."case_subcontractors" TO "authenticated";
GRANT ALL ON TABLE "public"."case_subcontractors" TO "service_role";



GRANT ALL ON TABLE "public"."case_task_assignees" TO "anon";
GRANT ALL ON TABLE "public"."case_task_assignees" TO "authenticated";
GRANT ALL ON TABLE "public"."case_task_assignees" TO "service_role";



GRANT ALL ON TABLE "public"."case_task_comment_attachments" TO "anon";
GRANT ALL ON TABLE "public"."case_task_comment_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."case_task_comment_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."case_task_comments" TO "anon";
GRANT ALL ON TABLE "public"."case_task_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."case_task_comments" TO "service_role";



GRANT ALL ON TABLE "public"."case_task_reads" TO "anon";
GRANT ALL ON TABLE "public"."case_task_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."case_task_reads" TO "service_role";



GRANT ALL ON TABLE "public"."case_tasks" TO "anon";
GRANT ALL ON TABLE "public"."case_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."case_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."catalog_items" TO "anon";
GRANT ALL ON TABLE "public"."catalog_items" TO "authenticated";
GRANT ALL ON TABLE "public"."catalog_items" TO "service_role";



GRANT ALL ON TABLE "public"."company_policies" TO "anon";
GRANT ALL ON TABLE "public"."company_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."company_policies" TO "service_role";



GRANT ALL ON TABLE "public"."crews" TO "anon";
GRANT ALL ON TABLE "public"."crews" TO "authenticated";
GRANT ALL ON TABLE "public"."crews" TO "service_role";



GRANT ALL ON TABLE "public"."digest_email_prefs" TO "anon";
GRANT ALL ON TABLE "public"."digest_email_prefs" TO "authenticated";
GRANT ALL ON TABLE "public"."digest_email_prefs" TO "service_role";



GRANT ALL ON TABLE "public"."employee_compensation" TO "anon";
GRANT ALL ON TABLE "public"."employee_compensation" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_compensation" TO "service_role";



GRANT ALL ON TABLE "public"."employee_crew_history" TO "anon";
GRANT ALL ON TABLE "public"."employee_crew_history" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_crew_history" TO "service_role";



GRANT ALL ON TABLE "public"."employee_documents" TO "anon";
GRANT ALL ON TABLE "public"."employee_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_documents" TO "service_role";



GRANT ALL ON TABLE "public"."employee_monthly_settlements" TO "anon";
GRANT ALL ON TABLE "public"."employee_monthly_settlements" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_monthly_settlements" TO "service_role";



GRANT ALL ON TABLE "public"."employee_piecework_entries" TO "anon";
GRANT ALL ON TABLE "public"."employee_piecework_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_piecework_entries" TO "service_role";



GRANT ALL ON TABLE "public"."employee_position_history" TO "anon";
GRANT ALL ON TABLE "public"."employee_position_history" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_position_history" TO "service_role";



GRANT ALL ON TABLE "public"."employee_profiles" TO "anon";
GRANT ALL ON TABLE "public"."employee_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."employee_settlement_entries" TO "anon";
GRANT ALL ON TABLE "public"."employee_settlement_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_settlement_entries" TO "service_role";



GRANT ALL ON TABLE "public"."employee_settlement_history" TO "anon";
GRANT ALL ON TABLE "public"."employee_settlement_history" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_settlement_history" TO "service_role";



GRANT ALL ON TABLE "public"."equipment" TO "anon";
GRANT ALL ON TABLE "public"."equipment" TO "authenticated";
GRANT ALL ON TABLE "public"."equipment" TO "service_role";



GRANT ALL ON TABLE "public"."equipment_assignments" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."equipment_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."equipment_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."estimate_template_lines" TO "anon";
GRANT ALL ON TABLE "public"."estimate_template_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."estimate_template_lines" TO "service_role";



GRANT ALL ON TABLE "public"."estimate_templates" TO "anon";
GRANT ALL ON TABLE "public"."estimate_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."estimate_templates" TO "service_role";



GRANT ALL ON TABLE "public"."extra_works" TO "anon";
GRANT ALL ON TABLE "public"."extra_works" TO "authenticated";
GRANT ALL ON TABLE "public"."extra_works" TO "service_role";



GRANT ALL ON TABLE "public"."financial_control_items" TO "anon";
GRANT ALL ON TABLE "public"."financial_control_items" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_control_items" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_counters" TO "anon";
GRANT ALL ON TABLE "public"."invoice_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_counters" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_lines" TO "anon";
GRANT ALL ON TABLE "public"."invoice_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_lines" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."job_positions" TO "anon";
GRANT ALL ON TABLE "public"."job_positions" TO "authenticated";
GRANT ALL ON TABLE "public"."job_positions" TO "service_role";



GRANT ALL ON TABLE "public"."notification_dispatch_events" TO "service_role";



GRANT ALL ON TABLE "public"."offer_lines" TO "anon";
GRANT ALL ON TABLE "public"."offer_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."offer_lines" TO "service_role";



GRANT ALL ON TABLE "public"."offer_variants" TO "anon";
GRANT ALL ON TABLE "public"."offer_variants" TO "authenticated";
GRANT ALL ON TABLE "public"."offer_variants" TO "service_role";



GRANT ALL ON TABLE "public"."organization_members" TO "anon";
GRANT ALL ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";



GRANT ALL ON TABLE "public"."user_directory_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."user_directory_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."org_member_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."org_member_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."organization_activity_log" TO "anon";
GRANT ALL ON TABLE "public"."organization_activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_activity_log" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."piecework_activities" TO "anon";
GRANT ALL ON TABLE "public"."piecework_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."piecework_activities" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."reminders" TO "anon";
GRANT ALL ON TABLE "public"."reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."reminders" TO "service_role";



GRANT ALL ON TABLE "public"."subcontractor_settlement_entries" TO "anon";
GRANT ALL ON TABLE "public"."subcontractor_settlement_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."subcontractor_settlement_entries" TO "service_role";



GRANT ALL ON TABLE "public"."subcontractors" TO "anon";
GRANT ALL ON TABLE "public"."subcontractors" TO "authenticated";
GRANT ALL ON TABLE "public"."subcontractors" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_invoice_category_rules" TO "anon";
GRANT ALL ON TABLE "public"."supplier_invoice_category_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_invoice_category_rules" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_invoice_import_batches" TO "anon";
GRANT ALL ON TABLE "public"."supplier_invoice_import_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_invoice_import_batches" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_invoices" TO "anon";
GRANT ALL ON TABLE "public"."supplier_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_invoices" TO "service_role";



GRANT ALL ON TABLE "public"."user_notifications" TO "anon";
GRANT ALL ON TABLE "public"."user_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."user_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_service_entries" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_service_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_service_entries" TO "service_role";



GRANT ALL ON TABLE "public"."vehicles" TO "anon";
GRANT ALL ON TABLE "public"."vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicles" TO "service_role";



GRANT ALL ON TABLE "public"."warehouse_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."warehouse_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."warehouse_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."warehouse_items" TO "anon";
GRANT ALL ON TABLE "public"."warehouse_items" TO "authenticated";
GRANT ALL ON TABLE "public"."warehouse_items" TO "service_role";



GRANT ALL ON TABLE "public"."warehouse_movements" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."warehouse_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."warehouse_movements" TO "service_role";



GRANT ALL ON TABLE "public"."work_hours" TO "anon";
GRANT ALL ON TABLE "public"."work_hours" TO "authenticated";
GRANT ALL ON TABLE "public"."work_hours" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































