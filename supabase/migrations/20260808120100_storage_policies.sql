-- Polityki RLS na storage.objects, odtworzone ze stanu produkcyjnego.
-- 'supabase db dump' pomija schemat storage, więc trzymamy je w osobnej migracji,
-- żeby lokalne 'db reset' dawało ochronę plików identyczną jak na produkcji.
-- Źródło historyczne: migracje 0033, 0040, 0047, 0050, 0057.

drop policy if exists "ai-attachments delete" on storage.objects;
drop policy if exists "ai-attachments insert" on storage.objects;
drop policy if exists "ai-attachments select" on storage.objects;
drop policy if exists "ai-attachments update" on storage.objects;
drop policy if exists "case-attachments delete hardened" on storage.objects;
drop policy if exists "case-attachments insert hardened" on storage.objects;
drop policy if exists "case-attachments select hardened" on storage.objects;
drop policy if exists "case-attachments update hardened" on storage.objects;
drop policy if exists "employee-documents management delete" on storage.objects;
drop policy if exists "employee-documents management insert" on storage.objects;
drop policy if exists "employee-documents management select" on storage.objects;
drop policy if exists "employee-documents management update" on storage.objects;

CREATE POLICY "ai-attachments delete" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'ai-attachments'::"text") AND "public"."owns_ai_attachment_object"("name")));

CREATE POLICY "ai-attachments insert" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'ai-attachments'::"text") AND "public"."owns_ai_attachment_object"("name")));

CREATE POLICY "ai-attachments select" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'ai-attachments'::"text") AND "public"."owns_ai_attachment_object"("name")));

CREATE POLICY "ai-attachments update" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'ai-attachments'::"text") AND "public"."owns_ai_attachment_object"("name")));

CREATE POLICY "case-attachments delete hardened" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'case-attachments'::"text") AND "public"."can_delete_case_attachment_object"("name")));

CREATE POLICY "case-attachments insert hardened" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'case-attachments'::"text") AND "public"."can_insert_case_attachment_object"("name")));

CREATE POLICY "case-attachments select hardened" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'case-attachments'::"text") AND "public"."can_select_case_attachment_object"("name")));

CREATE POLICY "case-attachments update hardened" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'case-attachments'::"text") AND "public"."can_select_case_attachment_object"("name"))) WITH CHECK ((("bucket_id" = 'case-attachments'::"text") AND "public"."can_insert_case_attachment_object"("name")));

CREATE POLICY "employee-documents management delete" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'employee-documents'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"])) AND (("om"."organization_id")::"text" = "split_part"("objects"."name", '/'::"text", 1)))))));

CREATE POLICY "employee-documents management insert" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'employee-documents'::"text") AND (EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om"
     JOIN "public"."employee_profiles" "ep" ON (("ep"."organization_id" = "om"."organization_id")))
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"])) AND (("om"."organization_id")::"text" = "split_part"("objects"."name", '/'::"text", 1)) AND (("ep"."id")::"text" = "split_part"("objects"."name", '/'::"text", 2)))))));

CREATE POLICY "employee-documents management select" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'employee-documents'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"])) AND (("om"."organization_id")::"text" = "split_part"("objects"."name", '/'::"text", 1)))))));

CREATE POLICY "employee-documents management update" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'employee-documents'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"])) AND (("om"."organization_id")::"text" = "split_part"("objects"."name", '/'::"text", 1))))))) WITH CHECK ((("bucket_id" = 'employee-documents'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"text", 'office'::"text", 'manager'::"text"])) AND (("om"."organization_id")::"text" = "split_part"("objects"."name", '/'::"text", 1)))))));

