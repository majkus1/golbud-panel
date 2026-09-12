import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import {
  sendDigestToRecipient,
  sendReminderDigestEmailLegacy,
  type EmployeeComplianceDigestRow,
  type FleetDigestRow,
  type OverdueContactRow,
  type PaymentDigestRow,
  type ProfitabilityDigestRow,
  type ReminderDigestRow,
  type ScheduleDigestRow,
  type SettlementDigestRow,
  type StaleCaseDigestRow,
  type SupplierInvoiceDigestRow,
  type TaskDigestRow,
  type WarehouseDigestRow
} from "@/lib/send-reminder-digest";
import { buildProfitabilitySummary } from "@/lib/profitability-report";
import { daysUntil, fleetDocLabel, isLowStock, type FleetDocKind } from "@/lib/ops-alerts";
import { warsawTodayIso } from "@/lib/warsaw-today";
import {
  fetchAccessibleCaseIds,
  scopeOverdueContacts,
  scopePayments,
  scopeProfitabilityAlerts,
  scopeReminders,
  scopeSchedule,
  scopeSettlements,
  scopeStaleCases,
  scopeSupplierInvoices,
  scopeTasks
} from "@/lib/digest-scope";
import { mergeNotificationPrefs } from "@/lib/notification-prefs";
import { sendPushToUser } from "@/lib/web-push-server";
import type {
  CaseDirectCost,
  CaseRow,
  CaseSubcontractor,
  DigestEmailPref,
  EmployeeDocument,
  EmployeeCompensation,
  EmployeePayrollProfile,
  EmployeeProfile,
  EmployeeMonthlySettlement,
  EmployeePieceworkEntry,
  EmployeeSettlementEntry,
  Invoice,
  MemberRole,
  Payment,
  SubcontractorSettlementEntry,
  SupplierInvoice,
  WorkHour
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set<string>(["rozliczone", "utracone"]);
const MANAGEMENT = new Set<MemberRole>(["owner", "office", "manager"]);
const COMPLIANCE_MILESTONES = new Set([30, 14, 7, 1, 0]);

type CompliancePushAlert = {
  employee: EmployeeProfile;
  documentId: string;
  documentKind: string;
  documentLabel: string;
  expires: string;
  daysLeft: number;
  milestone: string;
};

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function n(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function casesRelation(row: Record<string, unknown>): { client_name: string; status?: string; location?: string | null } | null {
  const cases = row.cases as { client_name: string; status?: string; location?: string | null } | { client_name: string; status?: string; location?: string | null }[] | null;
  return Array.isArray(cases) ? cases[0] ?? null : cases;
}

async function optionalSelect<T>(
  query: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
  label: string
): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    console.error(`[digest] ${label}`, error);
    return [];
  }
  return (data || []) as T[];
}

function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return "http://localhost:3000";
}

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function fetchMemberRoles(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  orgId: string,
  userIds: string[]
): Promise<Map<string, MemberRole>> {
  const map = new Map<string, MemberRole>();
  if (userIds.length === 0) return map;
  const { data } = await supabase
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", orgId)
    .in("user_id", userIds);
  for (const row of (data || []) as { user_id: string; role: MemberRole }[]) {
    map.set(row.user_id, row.role);
  }
  return map;
}

async function fetchUserEmailsById(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  userIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const uid of userIds) {
    const { data, error } = await supabase.auth.admin.getUserById(uid);
    if (!error && data.user?.email) map.set(uid, data.user.email.trim());
  }
  return map;
}

function complianceMilestone(daysLeft: number): string | null {
  if (daysLeft < 0) return "overdue";
  return COMPLIANCE_MILESTONES.has(daysLeft) ? String(daysLeft) : null;
}

function complianceCopy(alert: CompliancePushAlert): { title: string; body: string } {
  if (alert.daysLeft < 0) {
    const overdueDays = Math.abs(alert.daysLeft);
    return {
      title: `${alert.documentLabel} po terminie`,
      body: `${alert.employee.full_name}: termin minął ${overdueDays} ${overdueDays === 1 ? "dzień" : "dni"} temu (${alert.expires}).`
    };
  }
  if (alert.daysLeft === 0) {
    return {
      title: `${alert.documentLabel} wygasa dzisiaj`,
      body: `${alert.employee.full_name}: ważność kończy się dzisiaj (${alert.expires}).`
    };
  }
  return {
    title: `${alert.documentLabel} wygasa za ${alert.daysLeft} dni`,
    body: `${alert.employee.full_name}: ważność do ${alert.expires}. Zaplanuj odnowienie dokumentu.`
  };
}

async function dispatchCompliancePushAlerts(
  service: ReturnType<typeof createSupabaseServiceClient>,
  alerts: CompliancePushAlert[]
): Promise<{ created: number; pushSent: number }> {
  if (alerts.length === 0) return { created: 0, pushSent: 0 };

  const organizationIds = Array.from(new Set(alerts.map((alert) => alert.employee.organization_id)));
  const { data: memberRows, error: membersError } = await service
    .from("organization_members")
    .select("organization_id, user_id, role")
    .in("organization_id", organizationIds)
    .in("role", Array.from(MANAGEMENT));

  if (membersError) {
    console.error("[digest] compliance push members", membersError);
    return { created: 0, pushSent: 0 };
  }

  const members = (memberRows || []) as { organization_id: string; user_id: string; role: MemberRole }[];
  const userIds = Array.from(new Set(members.map((member) => member.user_id)));
  if (userIds.length === 0) return { created: 0, pushSent: 0 };

  const { data: prefRows, error: prefsError } = await service
    .from("digest_email_prefs")
    .select("*")
    .in("user_id", userIds);

  if (prefsError) console.error("[digest] compliance push prefs", prefsError);
  const prefsByUser = new Map(((prefRows || []) as DigestEmailPref[]).map((pref) => [pref.user_id, pref]));
  const rows: Array<{
    organization_id: string;
    user_id: string;
    type: "employee_compliance";
    title: string;
    body: string;
    href: string;
    entity_id: string;
    event_key: string;
  }> = [];

  for (const alert of alerts) {
    const copy = complianceCopy(alert);
    for (const member of members) {
      if (member.organization_id !== alert.employee.organization_id) continue;
      const merged = mergeNotificationPrefs(member.role, prefsByUser.get(member.user_id));
      if (!merged.include_employee_compliance) continue;
      rows.push({
        organization_id: alert.employee.organization_id,
        user_id: member.user_id,
        type: "employee_compliance",
        title: copy.title,
        body: copy.body,
        href: `/hr?employee=${alert.employee.id}`,
        entity_id: alert.employee.id,
        event_key: `employee-compliance:${alert.employee.id}:${alert.documentId}:${alert.documentKind}:${alert.expires}:${alert.milestone}`
      });
    }
  }

  if (rows.length === 0) return { created: 0, pushSent: 0 };
  const { data: insertedRows, error: insertError } = await service
    .from("user_notifications")
    .upsert(rows, { onConflict: "user_id,event_key", ignoreDuplicates: true })
    .select("user_id, title, body, href, event_key");

  if (insertError) {
    console.error("[digest] compliance notifications insert", insertError);
    return { created: 0, pushSent: 0 };
  }

  let pushSent = 0;
  for (const row of (insertedRows || []) as Array<{ user_id: string; title: string; body: string; href: string; event_key: string }>) {
    const member = members.find((candidate) => candidate.user_id === row.user_id);
    if (!member) continue;
    const merged = mergeNotificationPrefs(member.role, prefsByUser.get(row.user_id));
    if (!merged.push_enabled) continue;
    pushSent += await sendPushToUser(service, row.user_id, {
      title: row.title,
      body: row.body,
      url: row.href,
      tag: row.event_key
    });
  }

  return { created: insertedRows?.length ?? 0, pushSent };
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = warsawTodayIso();
  const tomorrow = addDaysIso(today, 1);
  const next7 = addDaysIso(today, 7);
  const yesterday = addDaysIso(today, -1);
  const staleBefore = addDaysIso(today, -7);
  const todayLabel = new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    dateStyle: "long"
  }).format(new Date(`${today}T12:00:00`));

  const sendEmpty = process.env.REMINDER_DIGEST_SEND_EMPTY === "1" || process.env.REMINDER_DIGEST_SEND_EMPTY === "true";
  const supabase = createSupabaseServiceClient();

  // ── 1. Przypomnienia ──────────────────────────────────────────────────────
  const { data: reminderRows, error: rErr } = await supabase
    .from("reminders")
    .select("id, remind_at, title, note, case_id, organization_id, completed_at, cases!inner(client_name,status)")
    .is("completed_at", null)
    .lte("remind_at", today);

  if (rErr) {
    console.error("[digest] reminders", rErr);
    return NextResponse.json({ error: rErr.message }, { status: 500 });
  }

  const reminders: ReminderDigestRow[] = (reminderRows || [])
    .map((row: Record<string, unknown>) => {
      const cases = row.cases as { client_name: string; status: string } | { client_name: string; status: string }[] | null;
      const c = Array.isArray(cases) ? cases[0] : cases;
      if (!c) return null;
      return {
        id: row.id as string,
        remind_at: String(row.remind_at),
        title: String(row.title),
        note: (row.note as string | null) ?? null,
        case_id: String(row.case_id),
        organization_id: String(row.organization_id),
        client_name: c.client_name,
        status: c.status
      };
    })
    .filter(Boolean) as ReminderDigestRow[];

  // ── 2. Przeterminowany "kolejny kontakt" ──────────────────────────────────
  const { data: caseRows, error: cErr } = await supabase
    .from("cases")
    .select("id, organization_id, client_name, status, next_contact_date")
    .not("next_contact_date", "is", null);

  if (cErr) {
    console.error("[digest] cases", cErr);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  const overdueContacts: OverdueContactRow[] = (caseRows || [])
    .filter((c) => {
      const nd = c.next_contact_date as string | null;
      if (!nd || TERMINAL.has(c.status as string)) return false;
      return nd <= today;
    })
    .map((c) => ({
      id: c.id as string,
      organization_id: c.organization_id as string,
      client_name: c.client_name as string,
      status: c.status as string,
      next_contact_date: c.next_contact_date as string
    }));

  // ── 3. Etapy harmonogramu po terminie ────────────────────────────────────
  const { data: scheduleRows, error: sErr } = await supabase
    .from("case_schedule_items")
    .select("id, title, due_date, case_id, organization_id, cases!inner(client_name,status)")
    .eq("completed", false)
    .not("due_date", "is", null)
    .lte("due_date", today);

  if (sErr) {
    console.error("[digest] schedule", sErr);
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  const overdueSchedule: ScheduleDigestRow[] = (scheduleRows || [])
    .map((row: Record<string, unknown>) => {
      const cases = row.cases as { client_name: string; status: string } | { client_name: string; status: string }[] | null;
      const c = Array.isArray(cases) ? cases[0] : cases;
      if (!c || TERMINAL.has(c.status)) return null;
      return {
        id: row.id as string,
        case_id: String(row.case_id),
        organization_id: String(row.organization_id),
        title: String(row.title),
        due_date: String(row.due_date),
        client_name: c.client_name,
        status: c.status
      };
    })
    .filter(Boolean) as ScheduleDigestRow[];

  // ── 4. Płatności po terminie ─────────────────────────────────────────────
  const { data: paymentRows, error: pErr } = await supabase
    .from("payments")
    .select("id, title, due_date, amount_due, amount_paid, case_id, organization_id, cases!inner(client_name,status)")
    .is("paid_at", null)
    .not("due_date", "is", null)
    .lte("due_date", today);

  if (pErr) {
    console.error("[digest] payments", pErr);
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const overduePayments: PaymentDigestRow[] = (paymentRows || [])
    .map((row: Record<string, unknown>) => {
      const cases = row.cases as { client_name: string; status: string } | { client_name: string; status: string }[] | null;
      const c = Array.isArray(cases) ? cases[0] : cases;
      if (!c || TERMINAL.has(c.status)) return null;
      const due = Number(row.amount_due);
      const paid = Number(row.amount_paid);
      if (due <= 0 || paid >= due) return null;
      return {
        id: row.id as string,
        case_id: String(row.case_id),
        organization_id: String(row.organization_id),
        title: String(row.title),
        due_date: String(row.due_date),
        amount_due: due,
        amount_paid: paid,
        client_name: c.client_name,
        status: c.status
      };
    })
    .filter(Boolean) as PaymentDigestRow[];

  const { data: upcomingPaymentRows, error: upErr } = await supabase
    .from("payments")
    .select("id, title, due_date, amount_due, amount_paid, case_id, organization_id, cases!inner(client_name,status)")
    .is("paid_at", null)
    .not("due_date", "is", null)
    .gte("due_date", tomorrow)
    .lte("due_date", next7);

  if (upErr) {
    console.error("[digest] upcoming payments", upErr);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const upcomingPayments: PaymentDigestRow[] = (upcomingPaymentRows || [])
    .map((row: Record<string, unknown>) => {
      const c = casesRelation(row);
      if (!c || TERMINAL.has(c.status || "")) return null;
      const due = n(row.amount_due);
      const paid = n(row.amount_paid);
      if (due <= 0 || paid >= due) return null;
      return {
        id: row.id as string,
        case_id: String(row.case_id),
        organization_id: String(row.organization_id),
        title: String(row.title),
        due_date: String(row.due_date),
        amount_due: due,
        amount_paid: paid,
        client_name: c.client_name,
        status: c.status || ""
      };
    })
    .filter(Boolean) as PaymentDigestRow[];

  // ── 5. Zadania w sprawach po terminie ────────────────────────────────────
  const { data: taskRows, error: tErr } = await supabase
    .from("case_tasks")
    .select("id, title, due_date, case_id, organization_id, cases!inner(client_name,status)")
    .not("case_id", "is", null)
    .not("due_date", "is", null)
    .lte("due_date", today)
    .in("status", ["do zrobienia", "w toku"]);

  if (tErr) {
    console.error("[digest] tasks", tErr);
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  // Zbierz przypisanych per zadanie z junction table
  const rawTasks = (taskRows || []) as Record<string, unknown>[];
  const taskIds = rawTasks.map((r) => r.id as string);

  let taskAssigneeMap = new Map<string, string[]>(); // task_id -> user_ids
  if (taskIds.length > 0) {
    const { data: taRows } = await supabase
      .from("case_task_assignees")
      .select("task_id, user_id")
      .in("task_id", taskIds);
    for (const ta of (taRows || []) as { task_id: string; user_id: string }[]) {
      const arr = taskAssigneeMap.get(ta.task_id) ?? [];
      arr.push(ta.user_id);
      taskAssigneeMap.set(ta.task_id, arr);
    }
  }

  // Pobierz maile przypisanych
  const allAssigneeIdsSet = new Set<string>();
  taskAssigneeMap.forEach((ids) => ids.forEach((id) => allAssigneeIdsSet.add(id)));
  const allAssigneeIds = Array.from(allAssigneeIdsSet);
  const assigneeEmailMap = allAssigneeIds.length > 0
    ? await fetchUserEmailsById(supabase, allAssigneeIds)
    : new Map<string, string>();

  const overdueTasks: TaskDigestRow[] = rawTasks
    .map((row) => {
      const cases = row.cases as { client_name: string; status: string } | { client_name: string; status: string }[] | null;
      const c = Array.isArray(cases) ? cases[0] : cases;
      if (!c || TERMINAL.has(c.status)) return null;
      const aid = row.id as string;
      const assigneeEmails = (taskAssigneeMap.get(aid) ?? [])
        .map((uid) => assigneeEmailMap.get(uid))
        .filter(Boolean) as string[];
      return {
        id: aid,
        case_id: String(row.case_id),
        organization_id: String(row.organization_id),
        title: String(row.title),
        due_date: String(row.due_date),
        client_name: c.client_name,
        case_status: c.status,
        assignee_emails: assigneeEmails
      };
    })
    .filter(Boolean) as TaskDigestRow[];

  // ── 6. Flota i polisy — dokumenty w ciągu 30 dni lub po terminie ──────────
  const { data: vehicleRows, error: vErr } = await supabase
    .from("vehicles")
    .select("id, organization_id, name, registration_number, insurance_oc_expires, insurance_ac_expires, inspection_expires");

  if (vErr) {
    console.error("[digest] vehicles", vErr);
    return NextResponse.json({ error: vErr.message }, { status: 500 });
  }

  const fleetAlerts: FleetDigestRow[] = [];
  for (const v of vehicleRows || []) {
    const docs: { label: string; expires: string | null }[] = [
      { label: "Ubezpieczenie OC", expires: v.insurance_oc_expires as string | null },
      { label: "Ubezpieczenie AC", expires: v.insurance_ac_expires as string | null },
      { label: fleetDocLabel("inspection" as FleetDocKind), expires: v.inspection_expires as string | null }
    ];
    for (const doc of docs) {
      const left = daysUntil(doc.expires, today);
      if (left === null || left > 30) continue;
      fleetAlerts.push({
        id: v.id as string,
        organization_id: v.organization_id as string,
        name: v.name as string,
        registration_number: (v.registration_number as string | null) ?? null,
        doc_label: doc.label,
        expires: String(doc.expires).slice(0, 10),
        days_left: left
      });
    }
  }

  // Polisy firmowe (koniec ochrony / termin płatności) — w tej samej sekcji.
  const { data: policyRows, error: polErr } = await supabase
    .from("company_policies")
    .select("id, organization_id, policy_type, insurer, coverage_end, payment_due");

  if (polErr) {
    console.error("[digest] company_policies", polErr);
  } else {
    for (const p of policyRows || []) {
      const docs: { label: string; expires: string | null }[] = [
        { label: "Koniec ochrony", expires: p.coverage_end as string | null },
        { label: "Termin płatności", expires: p.payment_due as string | null }
      ];
      for (const doc of docs) {
        const left = daysUntil(doc.expires, today);
        if (left === null || left > 30) continue;
        fleetAlerts.push({
          id: p.id as string,
          organization_id: p.organization_id as string,
          name: `Polisa: ${p.policy_type as string}${p.insurer ? ` (${p.insurer as string})` : ""}`,
          registration_number: null,
          doc_label: doc.label,
          expires: String(doc.expires).slice(0, 10),
          days_left: left
        });
      }
    }
  }

  // ── 7. Magazyn — niski stan ───────────────────────────────────────────────
  const { data: warehouseRows, error: wErr } = await supabase
    .from("warehouse_items")
    .select("id, organization_id, label, unit, quantity, min_quantity, location");

  if (wErr) {
    console.error("[digest] warehouse", wErr);
    return NextResponse.json({ error: wErr.message }, { status: 500 });
  }

  const lowStockItems: WarehouseDigestRow[] = (warehouseRows || [])
    .filter((row) => isLowStock(Number(row.quantity), Number(row.min_quantity)))
    .map((row) => ({
      id: row.id as string,
      organization_id: row.organization_id as string,
      label: row.label as string,
      unit: row.unit as string,
      quantity: Number(row.quantity),
      min_quantity: Number(row.min_quantity),
      location: row.location as string
    }));

  // ── 8. Nowe moduły zarządcze: rentowność, koszty, ludzie, rozliczenia ─────
  const supplierInvoiceRows = await optionalSelect<Record<string, unknown>>(
    supabase
      .from("supplier_invoices")
      .select("id, organization_id, case_id, supplier_name, invoice_number, due_date, category, gross_total, paid_amount, status, cases(client_name)")
      .not("due_date", "is", null),
    "supplier_invoices"
  );

  const invoiceToDigest = (row: Record<string, unknown>): SupplierInvoiceDigestRow | null => {
    const gross = n(row.gross_total);
    const paid = n(row.paid_amount);
    if (gross <= 0 || paid >= gross) return null;
    const c = casesRelation(row);
    return {
      id: row.id as string,
      organization_id: String(row.organization_id),
      case_id: (row.case_id as string | null) ?? null,
      supplier_name: String(row.supplier_name || "Dostawca"),
      invoice_number: (row.invoice_number as string | null) ?? null,
      due_date: String(row.due_date),
      category: String(row.category || "koszt"),
      gross_total: gross,
      paid_amount: paid,
      client_name: c?.client_name ?? null
    };
  };

  const overdueCostInvoices = supplierInvoiceRows
    .filter((row) => String(row.due_date) <= today)
    .map(invoiceToDigest)
    .filter(Boolean)
    .sort((a, b) => (b!.gross_total - b!.paid_amount) - (a!.gross_total - a!.paid_amount))
    .slice(0, 30) as SupplierInvoiceDigestRow[];

  const upcomingCostInvoices = supplierInvoiceRows
    .filter((row) => String(row.due_date) >= tomorrow && String(row.due_date) <= next7)
    .map(invoiceToDigest)
    .filter(Boolean)
    .sort((a, b) => String(a!.due_date).localeCompare(String(b!.due_date)))
    .slice(0, 30) as SupplierInvoiceDigestRow[];

  const employeeRows = await optionalSelect<EmployeeProfile>(
    supabase.from("employee_profiles").select("*").eq("active", true),
    "employee_profiles"
  );
  const employeeCompensationRows = await optionalSelect<EmployeeCompensation>(
    supabase.from("employee_compensation").select("*"),
    "employee_compensation"
  );
  const compensationByEmployee = new Map(employeeCompensationRows.map((row) => [row.employee_id, row]));
  const payrollEmployeeRows = employeeRows.map((employee) => ({
    ...employee,
    hourly_rate: compensationByEmployee.get(employee.id)?.hourly_rate ?? null,
    day_rate: compensationByEmployee.get(employee.id)?.day_rate ?? null,
    monthly_salary: compensationByEmployee.get(employee.id)?.monthly_salary ?? null
  })) as EmployeePayrollProfile[];
  const employeeDocumentRows = await optionalSelect<EmployeeDocument>(
    supabase.from("employee_documents").select("*").eq("status", "active").eq("requires_renewal", true),
    "employee_documents"
  );

  const employeeCompliance: EmployeeComplianceDigestRow[] = [];
  const compliancePushAlerts: CompliancePushAlert[] = [];
  for (const e of employeeRows) {
    const storedDocs = employeeDocumentRows
      .filter((document) => document.employee_id === e.id)
      .map((document) => ({ id: document.id, kind: document.document_type, label: document.title, expires: document.valid_until }));
    const storedKinds = new Set(storedDocs.map((document) => document.kind));
    const docs = [
      ...storedDocs,
      ...(!storedKinds.has("bhp") ? [{ id: `${e.id}-bhp`, kind: "bhp", label: "BHP", expires: e.bhp_valid_until }] : []),
      ...(!storedKinds.has("medical") ? [{ id: `${e.id}-medical`, kind: "medical", label: "Badania lekarskie", expires: e.medical_valid_until }] : [])
    ];
    for (const doc of docs) {
      const left = doc.expires ? daysUntil(doc.expires, today) : null;
      if (left !== null && left > 30) continue;
      employeeCompliance.push({
        id: doc.id,
        organization_id: e.organization_id,
        full_name: e.full_name,
        role_title: e.role_title,
        doc_label: doc.label,
        expires: doc.expires,
        days_left: left
      });
      if (doc.expires && left !== null) {
        const milestone = complianceMilestone(left);
        if (milestone) {
          compliancePushAlerts.push({
            employee: e,
            documentId: doc.id,
            documentKind: doc.kind,
            documentLabel: doc.label,
            expires: doc.expires,
            daysLeft: left,
            milestone
          });
        }
      }
    }
  }
  employeeCompliance.sort((a, b) => (a.days_left ?? -999) - (b.days_left ?? -999));

  const [
    profitabilityCases,
    profitabilityPayments,
    profitabilitySalesInvoices,
    workHours,
    employeeEntries,
    pieceworkEntries,
    employeeMonthlySettlements,
    profitabilitySupplierInvoices,
    caseSubcontractors,
    subcontractorEntries,
    directCosts
  ] = await Promise.all([
    optionalSelect<CaseRow>(supabase.from("case_records").select("*"), "profitability cases"),
    optionalSelect<Payment>(supabase.from("payments").select("*"), "profitability payments"),
    optionalSelect<Invoice>(supabase.from("invoices").select("*"), "profitability sales invoices"),
    optionalSelect<WorkHour>(supabase.from("work_hours").select("*"), "work_hours"),
    optionalSelect<EmployeeSettlementEntry>(supabase.from("employee_settlement_entries").select("*"), "employee_settlement_entries"),
    optionalSelect<EmployeePieceworkEntry>(supabase.from("employee_piecework_entries").select("*"), "employee_piecework_entries"),
    optionalSelect<EmployeeMonthlySettlement>(supabase.from("employee_monthly_settlements").select("*"), "employee_monthly_settlements"),
    optionalSelect<SupplierInvoice>(supabase.from("supplier_invoices").select("*"), "profitability supplier_invoices"),
    optionalSelect<CaseSubcontractor>(supabase.from("case_subcontractors").select("*"), "case_subcontractors"),
    optionalSelect<SubcontractorSettlementEntry>(supabase.from("subcontractor_settlement_entries").select("*"), "subcontractor_settlement_entries"),
    optionalSelect<CaseDirectCost>(supabase.from("case_direct_costs").select("*"), "case_direct_costs")
  ]);

  const orgIdsForProfit = Array.from(new Set(profitabilityCases.map((c) => c.organization_id)));
  const profitabilityAlerts: ProfitabilityDigestRow[] = [];
  for (const orgId of orgIdsForProfit) {
    const summary = buildProfitabilitySummary({
      cases: profitabilityCases.filter((c) => c.organization_id === orgId),
      payments: profitabilityPayments.filter((p) => p.organization_id === orgId),
      salesInvoices: profitabilitySalesInvoices.filter((invoice) => invoice.organization_id === orgId),
      workHours: workHours.filter((h) => h.organization_id === orgId),
      employees: payrollEmployeeRows.filter((e) => e.organization_id === orgId),
      employeeEntries: employeeEntries.filter((e) => e.organization_id === orgId),
      pieceworkEntries: pieceworkEntries.filter((e) => e.organization_id === orgId),
      employeeMonthlySettlements: employeeMonthlySettlements.filter((e) => e.organization_id === orgId),
      supplierInvoices: profitabilitySupplierInvoices.filter((i) => i.organization_id === orgId),
      caseSubcontractors: caseSubcontractors.filter((s) => s.organization_id === orgId),
      subcontractorEntries: subcontractorEntries.filter((e) => e.organization_id === orgId),
      directCosts: directCosts.filter((c) => c.organization_id === orgId)
    });
    summary.alerts
      .filter((a) => a.severity === "critical" || a.severity === "warning")
      .slice(0, 12)
      .forEach((a) => {
        profitabilityAlerts.push({
          id: a.id,
          organization_id: orgId,
          case_id: a.caseId ?? null,
          severity: a.severity,
          title: a.title,
          description: a.description,
          amount: a.amount ?? null
        });
      });
  }

  const employeeById = new Map(employeeRows.map((e) => [e.id, e]));
  const caseNameById = new Map(profitabilityCases.map((c) => [c.id, c.client_name]));
  const subcontractorRows = await optionalSelect<{ id: string; organization_id: string; name: string }>(
    supabase.from("subcontractors").select("id, organization_id, name"),
    "subcontractors"
  );
  const subById = new Map(subcontractorRows.map((s) => [s.id, s]));
  const settlements: SettlementDigestRow[] = [
    ...employeeEntries
      .filter((e) => e.entry_date >= yesterday && e.entry_date <= today && n(e.amount) >= 1000)
      .map((e) => ({
        id: e.id,
        organization_id: e.organization_id,
        case_id: e.case_id,
        person_label: employeeById.get(e.employee_id)?.full_name || "Pracownik",
        entry_type: e.entry_type,
        amount: n(e.amount),
        entry_date: e.entry_date,
        title: e.title,
        client_name: e.case_id ? caseNameById.get(e.case_id) ?? null : null,
        data_scope: "payroll" as const
      })),
    ...subcontractorEntries
      .filter((e) => e.entry_date >= yesterday && e.entry_date <= today && n(e.amount) >= 1000)
      .map((e) => ({
        id: e.id,
        organization_id: e.organization_id,
        case_id: e.case_id,
        person_label: e.subcontractor_id ? subById.get(e.subcontractor_id)?.name || "Podwykonawca" : "Podwykonawca",
        entry_type: e.entry_type,
        amount: n(e.amount),
        entry_date: e.entry_date,
        title: e.title,
        client_name: e.case_id ? caseNameById.get(e.case_id) ?? null : null,
        data_scope: "operational" as const
      }))
  ].sort((a, b) => b.amount - a.amount).slice(0, 30);

  const attachmentRows = await optionalSelect<{ case_id: string; created_at: string }>(
    supabase.from("attachments").select("case_id, created_at"),
    "attachments"
  );
  const scheduleActivityRows = await optionalSelect<{ case_id: string; created_at: string }>(
    supabase.from("case_schedule_items").select("case_id, created_at"),
    "case schedule activity"
  );
  const lastByCase = new Map<string, string>();
  for (const c of profitabilityCases) lastByCase.set(c.id, c.updated_at || c.created_at);
  for (const row of [...attachmentRows, ...scheduleActivityRows]) {
    const prev = lastByCase.get(row.case_id);
    if (!prev || row.created_at > prev) lastByCase.set(row.case_id, row.created_at);
  }
  const staleCases: StaleCaseDigestRow[] = profitabilityCases
    .filter((c) => !TERMINAL.has(c.status) && (lastByCase.get(c.id) || c.created_at).slice(0, 10) <= staleBefore)
    .map((c) => {
      const last = lastByCase.get(c.id) || c.created_at;
      const days = Math.max(0, Math.floor((new Date(`${today}T12:00:00`).getTime() - new Date(last).getTime()) / 86400000));
      return {
        id: c.id,
        organization_id: c.organization_id,
        client_name: c.client_name,
        status: c.status,
        location: c.location,
        last_activity_at: last,
        days_without_update: days
      };
    })
    .sort((a, b) => b.days_without_update - a.days_without_update)
    .slice(0, 30);

  const baseUrl = appBaseUrl();
  const complianceNotifications = await dispatchCompliancePushAlerts(supabase, compliancePushAlerts);

  // ── Prefs / odbiorcy ─────────────────────────────────────────────────────
  const { data: prefRows, error: prefErr } = await supabase
    .from("digest_email_prefs")
    .select("*")
    .eq("digest_enabled", true);

  if (prefErr) {
    console.error("[digest] prefs", prefErr);
    return NextResponse.json({ error: prefErr.message }, { status: 500 });
  }

  const prefs = (prefRows || []) as DigestEmailPref[];

  const counts = {
    reminders: reminders.length,
    overdueContact: overdueContacts.length,
    overdueSchedule: overdueSchedule.length,
    overduePayments: overduePayments.length,
    upcomingPayments: upcomingPayments.length,
    overdueTasks: overdueTasks.length,
    fleetAlerts: fleetAlerts.length,
    lowStock: lowStockItems.length,
    overdueCostInvoices: overdueCostInvoices.length,
    upcomingCostInvoices: upcomingCostInvoices.length,
    employeeCompliance: employeeCompliance.length,
    profitabilityAlerts: profitabilityAlerts.length,
    settlements: settlements.length,
    staleCases: staleCases.length
  };

  if (prefs.length > 0) {
    const userIds = Array.from(new Set(prefs.map((p) => p.user_id)));
    const emailByUserId = await fetchUserEmailsById(supabase, userIds);

    const sent: { to: string; messageId: string | undefined }[] = [];
    const skipped: string[] = [];

    for (const pref of prefs) {
      const email = emailByUserId.get(pref.user_id);
      if (!email) { skipped.push(pref.user_id); continue; }

      const org = pref.organization_id;
      const roles = await fetchMemberRoles(supabase, org, [pref.user_id]);
      const memberRole = roles.get(pref.user_id) ?? "member";
      const merged = mergeNotificationPrefs(memberRole, pref);
      const canSeeManagementDigest = MANAGEMENT.has(memberRole);
      const caseScope = await fetchAccessibleCaseIds(supabase, org, pref.user_id, memberRole);

      const orgReminders = reminders.filter((x) => x.organization_id === org);
      const orgContacts = overdueContacts.filter((x) => x.organization_id === org);
      const orgSchedule = overdueSchedule.filter((x) => x.organization_id === org);
      const orgPayments = overduePayments.filter((x) => x.organization_id === org);
      const orgUpcomingPayments = upcomingPayments.filter((x) => x.organization_id === org);
      const orgTasks = overdueTasks.filter((x) => x.organization_id === org);
      const orgFleet = fleetAlerts.filter((x) => x.organization_id === org);
      const orgStock = lowStockItems.filter((x) => x.organization_id === org);
      const orgOverdueCostInvoices = overdueCostInvoices.filter((x) => x.organization_id === org);
      const orgUpcomingCostInvoices = upcomingCostInvoices.filter((x) => x.organization_id === org);
      const orgEmployeeCompliance = employeeCompliance.filter((x) => x.organization_id === org);
      const orgProfitabilityAlerts = profitabilityAlerts.filter((x) => x.organization_id === org);
      const orgSettlements = settlements.filter((x) => x.organization_id === org && (memberRole !== "office" || x.data_scope !== "payroll"));
      const orgStaleCases = staleCases.filter((x) => x.organization_id === org);

      try {
        const result = await sendDigestToRecipient(email, {
          todayLabel,
          baseUrl,
          reminders: scopeReminders(orgReminders, caseScope),
          overdueContacts: scopeOverdueContacts(orgContacts, caseScope),
          overdueSchedule: scopeSchedule(orgSchedule, caseScope),
          overduePayments: scopePayments(orgPayments, caseScope),
          overdueTasks: scopeTasks(orgTasks, email, caseScope),
          fleetAlerts: orgFleet,
          lowStockItems: orgStock,
          upcomingPayments: scopePayments(orgUpcomingPayments, caseScope),
          overdueCostInvoices: canSeeManagementDigest ? scopeSupplierInvoices(orgOverdueCostInvoices, caseScope) : [],
          upcomingCostInvoices: canSeeManagementDigest ? scopeSupplierInvoices(orgUpcomingCostInvoices, caseScope) : [],
          employeeCompliance: canSeeManagementDigest ? orgEmployeeCompliance : [],
          profitabilityAlerts: canSeeManagementDigest ? scopeProfitabilityAlerts(orgProfitabilityAlerts, caseScope) : [],
          settlements: canSeeManagementDigest ? scopeSettlements(orgSettlements, caseScope) : [],
          staleCases: scopeStaleCases(orgStaleCases, caseScope),
          includeReminders: merged.include_reminders,
          includeOverdueContact: merged.include_overdue_contact,
          includeSchedule: merged.include_schedule,
          includePayments: merged.include_payments,
          includeTasks: merged.include_tasks,
          includeFleet: merged.include_fleet,
          includeWarehouse: merged.include_warehouse,
          includeProfitabilityAlerts: canSeeManagementDigest && merged.include_profitability_alerts,
          includeCostInvoices: canSeeManagementDigest && merged.include_cost_invoices,
          includeEmployeeCompliance: canSeeManagementDigest && merged.include_employee_compliance,
          includeSettlements: canSeeManagementDigest && merged.include_settlements,
          includeStaleCases: merged.include_stale_cases,
          sendEmpty
        });
        if (result) sent.push(result);
      } catch (e) {
        console.error("[digest] send to", email, e);
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "per_user_prefs",
      today,
      counts,
      complianceNotifications,
      emailsSent: sent.length,
      recipients: sent.map((s) => s.to),
      skippedUserIds: skipped
    });
  }

  // ── Legacy fallback ───────────────────────────────────────────────────────
  try {
    const { to, messageId } = await sendReminderDigestEmailLegacy({
      todayLabel,
      baseUrl,
      reminders,
      overdueContacts,
      overdueSchedule,
      overduePayments,
      overdueTasks,
      fleetAlerts,
      lowStockItems,
      upcomingPayments,
      overdueCostInvoices,
      upcomingCostInvoices,
      employeeCompliance,
      profitabilityAlerts,
      settlements,
      staleCases
    });
    return NextResponse.json({ ok: true, mode: "env_REMINDER_DIGEST_TO", today, counts, complianceNotifications, to, messageId: messageId ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "nothing_due") {
      return NextResponse.json({ ok: true, sent: false, reason: "nothing_due", today, counts, complianceNotifications });
    }
    if (msg.includes("REMINDER_DIGEST_TO")) {
      return NextResponse.json({
        ok: true, sent: false, reason: "no_recipients",
        hint: "Włącz poranny digest dla użytkowników w Ustawienia → Zespół lub skonfiguruj zapasowy adres w ustawieniach serwera.",
        today, counts, complianceNotifications
      });
    }
    console.error("[digest] legacy send", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
