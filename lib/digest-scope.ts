import type { SupabaseClient } from "@supabase/supabase-js";
import { canSeeAllCasesInOrg } from "@/lib/notification-prefs";
import type { MemberRole } from "@/lib/types";
import type {
  OverdueContactRow,
  PaymentDigestRow,
  ProfitabilityDigestRow,
  ReminderDigestRow,
  ScheduleDigestRow,
  SettlementDigestRow,
  StaleCaseDigestRow,
  SupplierInvoiceDigestRow,
  TaskDigestRow
} from "@/lib/send-reminder-digest";

/** Sprawy widoczne dla użytkownika z ograniczoną rolą (jak RLS). */
export async function fetchAccessibleCaseIds(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  role: MemberRole
): Promise<Set<string> | null> {
  if (canSeeAllCasesInOrg(role)) return null;

  const { data: created } = await supabase
    .from("cases")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("created_by", userId);
  const { data: assigned } = await supabase
    .from("case_assignees")
    .select("case_id, cases!inner(organization_id)")
    .eq("user_id", userId);

  const ids = new Set<string>();
  for (const r of created || []) ids.add(r.id as string);
  for (const r of assigned || []) {
    const cases = r.cases as { organization_id: string } | { organization_id: string }[];
    const c = Array.isArray(cases) ? cases[0] : cases;
    if (c?.organization_id === organizationId) ids.add(r.case_id as string);
  }
  return ids;
}

function inScope(caseId: string, scope: Set<string> | null): boolean {
  return scope === null || scope.has(caseId);
}

export function scopeReminders(rows: ReminderDigestRow[], scope: Set<string> | null): ReminderDigestRow[] {
  return rows.filter((r) => inScope(r.case_id, scope));
}

export function scopeOverdueContacts(rows: OverdueContactRow[], scope: Set<string> | null): OverdueContactRow[] {
  return rows.filter((r) => inScope(r.id, scope));
}

export function scopeSchedule(rows: ScheduleDigestRow[], scope: Set<string> | null): ScheduleDigestRow[] {
  return rows.filter((r) => inScope(r.case_id, scope));
}

export function scopePayments(rows: PaymentDigestRow[], scope: Set<string> | null): PaymentDigestRow[] {
  return rows.filter((r) => inScope(r.case_id, scope));
}

export function scopeTasks(rows: TaskDigestRow[], userEmail: string, scope: Set<string> | null): TaskDigestRow[] {
  let out = rows.filter((r) => inScope(r.case_id, scope));
  if (scope !== null) {
    out = out.filter((t) => t.assignee_emails.length === 0 || t.assignee_emails.includes(userEmail));
  }
  return out;
}

export function scopeSupplierInvoices(rows: SupplierInvoiceDigestRow[], scope: Set<string> | null): SupplierInvoiceDigestRow[] {
  if (scope === null) return rows;
  return rows.filter((r) => !r.case_id || inScope(r.case_id, scope));
}

export function scopeProfitabilityAlerts(rows: ProfitabilityDigestRow[], scope: Set<string> | null): ProfitabilityDigestRow[] {
  if (scope === null) return rows;
  return rows.filter((r) => !r.case_id || inScope(r.case_id, scope));
}

export function scopeSettlements(rows: SettlementDigestRow[], scope: Set<string> | null): SettlementDigestRow[] {
  if (scope === null) return rows;
  return rows.filter((r) => !r.case_id || inScope(r.case_id, scope));
}

export function scopeStaleCases(rows: StaleCaseDigestRow[], scope: Set<string> | null): StaleCaseDigestRow[] {
  return rows.filter((r) => inScope(r.id, scope));
}
