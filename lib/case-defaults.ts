import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SCHEDULE_TITLES } from "@/lib/domain";

/** Domyślny harmonogram z listy klienta — wywołaj po utworzeniu sprawy. */
export async function insertDefaultSchedule(
  supabase: SupabaseClient,
  organizationId: string,
  caseId: string
): Promise<void> {
  const rows = DEFAULT_SCHEDULE_TITLES.map((title, i) => ({
    organization_id: organizationId,
    case_id: caseId,
    title,
    sort_order: i * 10,
    due_date: null as string | null,
    completed: false
  }));
  await supabase.from("case_schedule_items").insert(rows);
}
