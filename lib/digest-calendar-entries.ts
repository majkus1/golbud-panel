import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEntryDigestRow } from "@/lib/send-reminder-digest";

type CaseRel = { client_name: string; location: string | null; deleted_at: string | null };

/**
 * Wpisy z kalendarza firmy na dany dzień (`case_tasks.kind = 'wpis'`, niezamknięte) —
 * do sekcji „Dziś w kalendarzu” w porannym podsumowaniu. Klient serwisowy, bez RLS:
 * zawężenie do odbiorcy robi `scopeCalendarEntries`.
 *
 * Sprawa jest opcjonalna, więc zwykły (nie `!inner`) join; wpisy spraw z kosza odrzucamy tutaj.
 */
export async function loadDigestCalendarEntries(
  supabase: SupabaseClient,
  day: string
): Promise<{ entries: CalendarEntryDigestRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("case_tasks")
    .select("id, title, description, due_date, due_time, priority, case_id, organization_id, created_by, assignee_id, cases(client_name,location,deleted_at)")
    .eq("kind", "wpis")
    .eq("due_date", day)
    .in("status", ["do zrobienia", "w toku"])
    .order("due_time", { ascending: true, nullsFirst: false });
  if (error) return { entries: [], error: error.message };

  const rows = (data || []) as Record<string, unknown>[];
  const assignees = new Map<string, string[]>();
  if (rows.length > 0) {
    const { data: links } = await supabase
      .from("case_task_assignees")
      .select("task_id, user_id")
      .in("task_id", rows.map((r) => r.id as string));
    for (const link of (links || []) as { task_id: string; user_id: string }[]) {
      assignees.set(link.task_id, [...(assignees.get(link.task_id) ?? []), link.user_id]);
    }
  }

  const entries: CalendarEntryDigestRow[] = [];
  for (const row of rows) {
    const rel = row.cases as CaseRel | CaseRel[] | null;
    const c = Array.isArray(rel) ? rel[0] : rel;
    if (row.case_id && (!c || c.deleted_at)) continue;
    const id = row.id as string;
    const assigneeIds = assignees.get(id) ?? [];
    if (row.assignee_id && !assigneeIds.includes(row.assignee_id as string)) assigneeIds.push(row.assignee_id as string);
    entries.push({
      id,
      organization_id: String(row.organization_id),
      case_id: (row.case_id as string | null) ?? null,
      title: String(row.title),
      due_date: String(row.due_date),
      due_time: typeof row.due_time === "string" ? row.due_time.slice(0, 5) : null,
      priority: String(row.priority),
      note: (row.description as string | null) ?? null,
      client_name: c ? `${c.client_name}${c.location ? ` — ${c.location}` : ""}` : null,
      created_by: (row.created_by as string | null) ?? null,
      assignee_ids: assigneeIds
    });
  }
  return { entries, error: null };
}
