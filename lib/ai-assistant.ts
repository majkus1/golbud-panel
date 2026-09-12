import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFinancialControlReport } from "@/lib/financial-control-report";
import { buildProfitabilitySummary, type ProfitabilitySummary } from "@/lib/profitability-report";
import type {
  AiConversation,
  AiMessage,
  AiMessageAttachment,
  AggregatedLaborCost,
  Attachment,
  CaseDirectCost,
  CaseProfitabilityPlan,
  CaseRow,
  CaseSubcontractor,
  CaseTask,
  CompanyPolicy,
  Crew,
  Equipment,
  EquipmentAssignment,
  EmployeeDocument,
  EmployeeMonthlySettlement,
  EmployeePieceworkEntry,
  EmployeeProfile,
  EmployeeSettlementEntry,
  FinancialControlItem,
  Invoice,
  MemberRole,
  Payment,
  SubcontractorSettlementEntry,
  SupplierInvoice,
  Vehicle,
  WarehouseItem,
  WorkHour
} from "@/lib/types";
import { daysUntilDate, EMPLOYEE_DOCUMENT_TYPE_LABELS } from "@/lib/hr";
import { warsawTodayIso } from "@/lib/warsaw-today";

export type AssistantScope = "global" | "case";
export type AssistantReportFormat = "pdf" | "xlsx";
export type AssistantReportType = "case_summary" | "financial_control" | "profitability" | "hr" | "monthly_owner";

export type AssistantAccess = {
  organizationId: string;
  role: MemberRole;
  canSeeFinances: boolean;
  canManageOrg: boolean;
  canViewPayroll: boolean;
  /** Czy rola w ogóle może korzystać z Asystenta AI (globalnie i/lub przy sprawie). */
  canUseAssistant: boolean;
};

export type AssistantContext = {
  scope: AssistantScope;
  organizationId: string;
  caseId: string | null;
  role: MemberRole;
  canSeeFinances: boolean;
  contextText: string;
  contextTitle: string;
  profitability?: ProfitabilitySummary;
};

export type AssistantChatResult = {
  conversation: AiConversation;
  userMessage: AiMessage;
  assistantMessage: AiMessage;
};

export type AssistantHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantGenerationMeta = {
  provider: "openai" | "local";
  model?: string;
  context_scope: AssistantScope;
  canSeeFinances: boolean;
};

export type AssistantExchangeMeta = {
  user?: Record<string, unknown>;
  assistant?: Record<string, unknown>;
};

export class OpenAiAssistantError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "OpenAiAssistantError";
    this.status = status;
  }
}

type Supabase = SupabaseClient;

const MANAGEMENT_ROLES = new Set<MemberRole>(["owner", "office", "manager"]);
// Dostęp do Asystenta AI: wszystkie role oprócz podwykonawcy i zwykłego pracownika.
// Widoczność finansów/HR/floty w treści kontekstu dalej zależy od canSeeFinances/canManageOrg,
// a widoczność konkretnych zleceń/płatności/zadań dodatkowo zawężają polityki RLS (np. handlowiec
// i brygadzista widzą tylko swoje sprawy — dokładnie tak samo jak w reszcie aplikacji).
const ASSISTANT_ALLOWED_ROLES = new Set<MemberRole>(["owner", "office", "manager", "sales", "brygadzista"]);
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const MAX_CONTEXT_CHARS = 35000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_PROMPT_CHARS = 5000;
const MAX_HISTORY_MSG_CHARS = 2000;
const MAX_ATTACHMENT_CONTEXT_CHARS = 12000;

function openAiApiKey(): string {
  return (
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_KEY ||
    process.env.OPENAI_SECRET_KEY ||
    ""
  ).trim();
}

export function assistantRuntimeStatus() {
  const apiKey = openAiApiKey();
  const localFallbackEnabled = process.env.AI_ASSISTANT_ALLOW_LOCAL_FALLBACK === "true";
  return {
    openaiConfigured: !!apiKey,
    model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    localFallbackEnabled
  };
}

function money(value: unknown): string {
  const n = Number(value || 0);
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(Number.isFinite(n) ? n : 0);
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "brak";
  return new Intl.DateTimeFormat("pl-PL").format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function trimText(value: string | null | undefined, max = 450): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function lines(title: string, rows: string[]): string {
  return [`## ${title}`, ...(rows.length ? rows : ["brak danych"])].join("\n");
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function departmentLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    zarzad: "Zarząd",
    biuro: "Biuro",
    handlowcy: "Handlowcy",
    kierownicy: "Kierownicy",
    brygada: "Brygada / pracownicy",
    podwykonawcy: "Podwykonawcy",
    bhp: "BHP",
    inne: "Inne"
  };
  return value ? labels[value] || value : "brak działu";
}

function deadlineStatus(value: string | null | undefined, todayIso: string): string {
  const days = daysUntilDate(value, todayIso);
  if (!value || days == null) return "brak terminu";
  if (days < 0) return `${dateLabel(value)} (${Math.abs(days)} dni po terminie)`;
  if (days === 0) return `${dateLabel(value)} (wygasa dzisiaj)`;
  if (days === 1) return `${dateLabel(value)} (wygasa jutro)`;
  if (days <= 30) return `${dateLabel(value)} (za ${days} dni)`;
  return `${dateLabel(value)} (za ${days} dni)`;
}

export async function resolveAssistantAccess(
  supabase: Supabase,
  userId: string,
  organizationId: string | null | undefined
): Promise<AssistantAccess | null> {
  let query = supabase.from("organization_members").select("organization_id, role").eq("user_id", userId);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data } = await query.limit(1).maybeSingle();
  if (!data?.organization_id || !data?.role) return null;
  const role = data.role as MemberRole;
  return {
    organizationId: data.organization_id as string,
    role,
    canManageOrg: MANAGEMENT_ROLES.has(role),
    canSeeFinances: MANAGEMENT_ROLES.has(role),
    canViewPayroll: role === "owner" || role === "manager",
    canUseAssistant: ASSISTANT_ALLOWED_ROLES.has(role)
  };
}

export async function canAccessAssistantCase(
  supabase: Supabase,
  access: AssistantAccess,
  userId: string,
  caseId: string
): Promise<boolean> {
  void userId;
  if (!access.canUseAssistant) return false;
  if (access.canManageOrg) return true;
  // Handlowiec/brygadzista: dopuszczamy asystenta tylko przy sprawach, do których
  // i tak mają dostęp w aplikacji (własne/przypisane) — ta sama reguła co RLS na `cases`
  // (public.cases_select: can_see_all_cases OR created_by = auth.uid() OR is_case_assignee).
  const { data } = await supabase
    .from("cases")
    .select("id")
    .eq("id", caseId)
    .eq("organization_id", access.organizationId)
    .maybeSingle();
  return !!data;
}

async function loadProfitabilityContext(supabase: Supabase, organizationId: string): Promise<ProfitabilitySummary> {
  const [
    { data: cases },
    { data: payments },
    { data: salesInvoices },
    { data: aggregatedLaborCosts },
    { data: supplierInvoices },
    { data: profitabilityPlans },
    { data: caseSubcontractors },
    { data: subcontractorEntries },
    { data: directCosts }
  ] = await Promise.all([
    supabase.from("case_records").select("*").eq("organization_id", organizationId),
    supabase.from("payments").select("*").eq("organization_id", organizationId),
    supabase.from("invoices").select("*").eq("organization_id", organizationId),
    supabase.rpc("payroll_labor_costs_aggregated", { target_org: organizationId }),
    supabase.from("supplier_invoices").select("*").eq("organization_id", organizationId),
    supabase.from("case_profitability_plans").select("*").eq("organization_id", organizationId),
    supabase.from("case_subcontractors").select("*").eq("organization_id", organizationId),
    supabase.from("subcontractor_settlement_entries").select("*").eq("organization_id", organizationId),
    supabase.from("case_direct_costs").select("*").eq("organization_id", organizationId)
  ]);

  return buildProfitabilitySummary({
    cases: (cases || []) as CaseRow[],
    payments: (payments || []) as Payment[],
    salesInvoices: (salesInvoices || []) as Invoice[],
    workHours: [],
    employees: [],
    employeeEntries: [],
    pieceworkEntries: [],
    employeeMonthlySettlements: [],
    supplierInvoices: (supplierInvoices || []) as SupplierInvoice[],
    profitabilityPlans: (profitabilityPlans || []) as CaseProfitabilityPlan[],
    caseSubcontractors: (caseSubcontractors || []) as CaseSubcontractor[],
    subcontractorEntries: (subcontractorEntries || []) as SubcontractorSettlementEntry[],
    directCosts: (directCosts || []) as CaseDirectCost[],
    aggregatedLaborCosts: (aggregatedLaborCosts || []) as AggregatedLaborCost[]
  });
}

async function loadFinancialControlContext(supabase: Supabase, organizationId: string, includeEmployeeSettlements: boolean) {
  const [{ data: cases }, { data: payments }, { data: items }, { data: crews }] = await Promise.all([
    supabase.from("case_records").select("*").eq("organization_id", organizationId),
    supabase.from("payments").select("*").eq("organization_id", organizationId),
    supabase.from("financial_control_items").select("*").eq("organization_id", organizationId).eq("active", true),
    supabase.from("crews").select("*").eq("organization_id", organizationId)
  ]);

  return buildFinancialControlReport({
    asOfDate: new Date().toISOString().slice(0, 10),
    cases: (cases || []) as CaseRow[],
    payments: (payments || []) as Payment[],
    items: (items || []) as FinancialControlItem[],
    crews: (crews || []) as never[],
    includeEmployeeSettlements
  });
}

export async function buildAssistantContext(
  supabase: Supabase,
  access: AssistantAccess,
  options: { scope: AssistantScope; caseId?: string | null }
): Promise<AssistantContext> {
  const scope = options.scope;
  const caseId = options.caseId || null;

  if (scope === "case" && caseId) {
    const [
      { data: caseRow },
      { data: payments },
      { data: tasks },
      { data: attachments },
      { data: invoices },
      { data: supplierInvoices },
      { data: directCosts },
      { data: notes },
      profitability
    ] = await Promise.all([
      supabase.from("case_records").select("*").eq("id", caseId).maybeSingle(),
      supabase.from("payments").select("*").eq("case_id", caseId).order("sort_order"),
      supabase.from("case_tasks").select("*").eq("case_id", caseId).order("created_at", { ascending: false }).limit(30),
      supabase.from("attachments").select("*").eq("case_id", caseId).order("created_at", { ascending: false }).limit(30),
      access.canSeeFinances ? supabase.from("invoices").select("*").eq("case_id", caseId).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
      access.canSeeFinances ? supabase.from("supplier_invoices").select("*").eq("case_id", caseId).order("invoice_date", { ascending: false }) : Promise.resolve({ data: [] }),
      access.canSeeFinances ? supabase.from("case_direct_costs").select("*").eq("case_id", caseId).order("cost_date", { ascending: false }) : Promise.resolve({ data: [] }),
      supabase.from("case_notes").select("*").eq("case_id", caseId).order("created_at", { ascending: false }).limit(10),
      access.canSeeFinances ? loadProfitabilityContext(supabase, access.organizationId) : Promise.resolve(undefined)
    ]);

    const c = caseRow as CaseRow | null;
    const caseProfit = profitability?.rows.find((r) => r.caseId === caseId);
    const paymentRows = ((payments || []) as Payment[]).map(
      (p) => `- ${p.title}: należność ${money(p.amount_due)}, wpłacono ${money(p.amount_paid)}, termin ${dateLabel(p.due_date)}`
    );
    const taskRows = ((tasks || []) as CaseTask[]).map(
      (t) => `- ${t.title}: ${t.status}, priorytet ${t.priority}, termin ${dateLabel(t.due_date)}`
    );
    const fileRows = ((attachments || []) as Attachment[]).map(
      (a) => `- ${a.file_name} (${a.category}), dodano ${dateLabel(a.created_at)}${a.description ? `, opis: ${trimText(a.description, 120)}` : ""}`
    );
    const supplierRows = ((supplierInvoices || []) as SupplierInvoice[]).map(
      (i) => `- ${i.supplier_name}${i.invoice_number ? ` / ${i.invoice_number}` : ""}: ${money(i.gross_total)}, ${i.category}, status ${i.status}`
    );
    const directCostRows = ((directCosts || []) as CaseDirectCost[]).map((d) => `- ${d.title}: ${money(d.amount)}, ${d.cost_type}`);
    const noteRows = ((notes || []) as { content?: string; created_at?: string }[]).map((n) => `- ${dateLabel(n.created_at)}: ${trimText(n.content, 180)}`);

    const contextText = [
      lines("Sprawa", [
        c
          ? [
              `Klient: ${c.client_name}`,
              `Status: ${c.status}`,
              `Lokalizacja: ${c.location || "brak"}`,
              `Telefon: ${c.phone || "brak"}`,
              `Email: ${c.email || "brak"}`,
              `Źródło: ${c.source}`,
              `Kolejny kontakt: ${dateLabel(c.next_contact_date)}`,
              `Planowany koniec: ${dateLabel(c.realization_end_date)}`,
              access.canSeeFinances ? `Szacowana wartość: ${money(c.estimated_value)}` : "Szacowana wartość: ukryta dla tej roli",
              `Zakres: ${trimText(c.work_description, 900)}`
            ].join("\n")
          : "Nie znaleziono sprawy."
      ]),
      lines("Płatności", access.canSeeFinances ? paymentRows : ["ukryte dla tej roli"]),
      lines("Rentowność sprawy", access.canSeeFinances && caseProfit ? [
        `Przychód zapłacony: ${money(caseProfit.revenuePaid)}`,
        `Koszt: ${money(caseProfit.totalCost)}`,
        `Wynik: ${money(caseProfit.profit)}`,
        `Marża: ${caseProfit.marginPct.toFixed(1)}%`,
        `Prognoza wyniku: ${money(caseProfit.forecastProfit)}`,
        `Należności niezapłacone: ${money(caseProfit.unpaidRevenue)}`
      ] : ["brak danych albo ukryte dla tej roli"]),
      lines("Faktury kosztowe", access.canSeeFinances ? supplierRows : ["ukryte dla tej roli"]),
      lines("Koszty bezpośrednie", access.canSeeFinances ? directCostRows : ["ukryte dla tej roli"]),
      lines("Zadania", taskRows),
      lines("Pliki i załączniki", fileRows),
      lines("Ostatnie notatki", noteRows)
    ].join("\n\n");

    return {
      scope,
      organizationId: access.organizationId,
      caseId,
      role: access.role,
      canSeeFinances: access.canSeeFinances,
      contextText,
      contextTitle: c ? `Sprawa: ${c.client_name}` : "Sprawa",
      profitability
    };
  }

  const [
    { data: cases },
    { data: tasks },
    { data: employees },
    { data: employeeDocuments },
    { data: crews },
    { data: vehicles },
    { data: policies },
    { data: warehouseItems },
    { data: equipment },
    { data: equipmentAssignments },
    profitability,
    financial
  ] = await Promise.all([
    supabase.from("case_records").select("*").eq("organization_id", access.organizationId).order("created_at", { ascending: false }).limit(80),
    supabase.from("case_tasks").select("*").eq("organization_id", access.organizationId).order("created_at", { ascending: false }).limit(80),
    access.canManageOrg ? supabase.from("employee_profiles").select("*").eq("organization_id", access.organizationId).eq("active", true).limit(80) : Promise.resolve({ data: [] }),
    access.canManageOrg ? supabase.from("employee_documents").select("*").eq("organization_id", access.organizationId).eq("status", "active").eq("requires_renewal", true).limit(160) : Promise.resolve({ data: [] }),
    access.canManageOrg ? supabase.from("crews").select("*").eq("organization_id", access.organizationId) : Promise.resolve({ data: [] }),
    access.canManageOrg ? supabase.from("vehicles").select("*").eq("organization_id", access.organizationId).limit(80) : Promise.resolve({ data: [] }),
    access.canManageOrg ? supabase.from("company_policies").select("*").eq("organization_id", access.organizationId).limit(80) : Promise.resolve({ data: [] }),
    access.canManageOrg ? supabase.from("warehouse_items").select("*").eq("organization_id", access.organizationId).limit(120) : Promise.resolve({ data: [] }),
    access.canManageOrg ? supabase.from("equipment").select("*").eq("organization_id", access.organizationId).limit(120) : Promise.resolve({ data: [] }),
    access.canManageOrg ? supabase.from("equipment_assignments").select("*").eq("organization_id", access.organizationId).eq("returned", false).limit(160) : Promise.resolve({ data: [] }),
    access.canSeeFinances ? loadProfitabilityContext(supabase, access.organizationId) : Promise.resolve(undefined),
    access.canSeeFinances ? loadFinancialControlContext(supabase, access.organizationId, access.canViewPayroll) : Promise.resolve(undefined)
  ]);

  const todayIso = warsawTodayIso();
  const employeeList = ((employees || []) as EmployeeProfile[]);
  const employeeById = new Map(employeeList.map((employee) => [employee.id, employee]));
  const crewById = new Map(((crews || []) as Crew[]).map((crew) => [crew.id, crew.name]));
  const caseRows = ((cases || []) as CaseRow[]).slice(0, 25).map(
    (c) => `- ${c.client_name} / ${c.location || "brak"}: ${c.status}, koniec ${dateLabel(c.realization_end_date)}, kontakt ${dateLabel(c.next_contact_date)}${access.canSeeFinances ? `, wartość ${money(c.estimated_value)}` : ""}`
  );
  const taskRows = ((tasks || []) as CaseTask[]).slice(0, 25).map(
    (t) => `- ${t.title}: ${t.status}, priorytet ${t.priority}, termin ${dateLabel(t.due_date)}`
  );
  const caseList = ((cases || []) as CaseRow[]);
  const caseById = new Map(caseList.map((c) => [c.id, c]));
  const statusRows = Array.from(caseList.reduce((map, c) => map.set(c.status, (map.get(c.status) || 0) + 1), new Map<string, number>()))
    .map(([status, count]) => `- ${status}: ${count}`);
  const employeeRows = employeeList.slice(0, 50).map(
    (e) => `- ${e.full_name}: ${e.role_title}, dział ${departmentLabel(e.department)}, brygada ${crewById.get(e.crew_id || "") || "bez brygady"}, przełożony ${employeeById.get(e.manager_employee_id || "")?.full_name || "brak"}, dostęp do systemu ${e.has_system_access ? "tak" : "nie"}, BHP ${deadlineStatus(e.bhp_valid_until, todayIso)}, badania lekarskie ${deadlineStatus(e.medical_valid_until, todayIso)}`
  );
  const storedHrDeadlines = ((employeeDocuments || []) as EmployeeDocument[])
    .filter((document) => document.valid_until)
    .map((document) => ({
      employeeName: employeeById.get(document.employee_id)?.full_name || "Pracownik",
      label: EMPLOYEE_DOCUMENT_TYPE_LABELS[document.document_type] || document.title,
      date: document.valid_until as string,
      status: deadlineStatus(document.valid_until, todayIso),
      source: "dokument HR"
    }));
  const storedKeys = new Set(storedHrDeadlines.map((item) => `${item.employeeName}:${item.label}`));
  const profileHrDeadlines = employeeList.flatMap((employee) => [
    {
      employeeName: employee.full_name,
      label: "Szkolenie BHP",
      date: employee.bhp_valid_until,
      status: deadlineStatus(employee.bhp_valid_until, todayIso),
      source: "karta pracownika"
    },
    {
      employeeName: employee.full_name,
      label: "Badania lekarskie",
      date: employee.medical_valid_until,
      status: deadlineStatus(employee.medical_valid_until, todayIso),
      source: "karta pracownika"
    }
  ]).filter((item) => item.date && !storedKeys.has(`${item.employeeName}:${item.label}`)) as Array<{ employeeName: string; label: string; date: string; status: string; source: string }>;
  const hrDeadlineRows = [...storedHrDeadlines, ...profileHrDeadlines]
    .map((item) => ({ ...item, days: daysUntilDate(item.date, todayIso) ?? 99999 }))
    .filter((item) => item.days <= 60)
    .sort((a, b) => a.days - b.days)
    .slice(0, 60)
    .map((item) => `- ${item.employeeName}: ${item.label}, ${item.status}, źródło: ${item.source}`);

  const roots = employeeList.filter((employee) => !employee.manager_employee_id || !employeeById.has(employee.manager_employee_id));
  const hierarchyRows: string[] = [];
  const appendHierarchy = (employee: EmployeeProfile, depth: number) => {
    const prefix = `${"  ".repeat(depth)}-`;
    hierarchyRows.push(`${prefix} ${employee.full_name}: ${employee.role_title}, ${departmentLabel(employee.department)}, brygada ${crewById.get(employee.crew_id || "") || "bez brygady"}, dostęp ${employee.has_system_access ? "tak" : "nie"}`);
    employeeList.filter((item) => item.manager_employee_id === employee.id).forEach((child) => appendHierarchy(child, depth + 1));
  };
  roots.forEach((root) => appendHierarchy(root, 0));
  const vehicleRows = ((vehicles || []) as Vehicle[]).slice(0, 40).map(
    (vehicle) => `- ${vehicle.name}${vehicle.registration_number ? ` (${vehicle.registration_number})` : ""}: przegląd ${deadlineStatus(vehicle.inspection_expires, todayIso)}, OC ${deadlineStatus(vehicle.insurance_oc_expires || vehicle.insurance_expires, todayIso)}, AC ${deadlineStatus(vehicle.insurance_ac_expires, todayIso)}`
  );
  const policyRows = ((policies || []) as CompanyPolicy[]).slice(0, 40).map(
    (policy) => `- ${policy.policy_type}${policy.policy_number ? ` nr ${policy.policy_number}` : ""}: ochrona do ${deadlineStatus(policy.coverage_end, todayIso)}, płatność ${deadlineStatus(policy.payment_due, todayIso)}${policy.amount ? `, kwota ${money(policy.amount)}` : ""}`
  );
  const warehouseRows = ((warehouseItems || []) as WarehouseItem[])
    .filter((item) => Number(item.quantity) <= Number(item.min_quantity))
    .slice(0, 40)
    .map((item) => `- ${item.label}: stan ${item.quantity} ${item.unit}, minimum ${item.min_quantity} ${item.unit}, lokalizacja ${item.location}`);
  const activeEquipmentAssignments = ((equipmentAssignments || []) as EquipmentAssignment[]);
  const assignedEquipmentById = activeEquipmentAssignments.reduce((map, item) => map.set(item.equipment_id, (map.get(item.equipment_id) || 0) + Number(item.quantity || 0)), new Map<string, number>());
  const equipmentRows = ((equipment || []) as Equipment[]).slice(0, 50).map((item) => {
    const assigned = assignedEquipmentById.get(item.id) || 0;
    const free = Number(item.total_quantity || 0) - assigned;
    return `- ${item.name}: ${item.category}, razem ${item.total_quantity} ${item.unit}, na budowach ${assigned} ${item.unit}, wolne ${free} ${item.unit}`;
  });
  const equipmentAssignmentRows = activeEquipmentAssignments.slice(0, 40).map((item) => {
    const c = item.case_id ? caseById.get(item.case_id) : null;
    return `- ${item.quantity} szt. od ${dateLabel(item.assigned_date)}: ${item.site_label || c?.client_name || "bez sprawy"}${item.note ? `, uwagi: ${trimText(item.note, 100)}` : ""}`;
  });

  const contextText = [
    lines("Data raportu i interpretacja terminów", [
      `Dzisiejsza data w systemie: ${todayIso} (${dateLabel(todayIso)}).`,
      "Pytania o badania traktuj szeroko: badania lekarskie, BHP, szkolenia, uprawnienia i inne odnawialne dokumenty HR.",
      "Jeżeli w terminach HR jest data dla BHP, nie odpowiadaj, że brak danych tylko dlatego, że użytkownik napisał „badania”."
    ]),
    lines("Zlecenia", caseRows),
    lines("Statusy i lejki zlecen", statusRows),
    lines("Zadania", taskRows),
    lines("Rentowność firmy", access.canSeeFinances && profitability ? [
      `Wartość umowna / planowana: ${money(profitability.revenuePlanned)}`,
      `Faktury wystawione: ${money(profitability.revenueInvoiced)}`,
      `Należności powstałe: ${money(profitability.revenueDue)}`,
      `Przychód zapłacony: ${money(profitability.revenuePaid)}`,
      `Koszt łączny: ${money(profitability.totalCost)}`,
      `Wynik: ${money(profitability.profit)}`,
      `Marża: ${profitability.marginPct.toFixed(1)}%`,
      `Należności niezapłacone: ${money(profitability.unpaidRevenue)}`,
      `Należności po terminie: ${money(profitability.overdueRevenue)}`,
      `Koszty niezapłacone: ${money(profitability.costUnpaid)}`,
      `Budowy stratne: ${profitability.lossMakers.length}`,
      `Alerty: ${profitability.alerts.map((a) => `${a.title} (${a.severity})`).join("; ") || "brak"}`
    ] : ["ukryte dla tej roli"]),
    lines("Rejestr należności", access.canSeeFinances && financial ? [
      `Należności potwierdzone: ${money(financial.confirmedTotal)}`,
      `Gotówka/poza przelewem: ${money(financial.cashTotal)}`,
      `Do odbioru po zakończeniu: ${money(financial.completionTotal)}`,
      `Spory: ${financial.disputeCount}`,
      `Budowy do kontroli: ${financial.scheduledCount}`
    ] : ["ukryte dla tej roli"]),
    lines("Kadry - pracownicy", access.canManageOrg ? employeeRows : ["ukryte dla tej roli"]),
    lines("Kadry - terminy BHP, badan i dokumentow", access.canManageOrg ? hrDeadlineRows : ["ukryte dla tej roli"]),
    lines("Struktura organizacyjna - schemat hierarchii", access.canManageOrg ? hierarchyRows : ["ukryte dla tej roli"]),
    lines("Flota i polisy - terminy", access.canManageOrg ? [...vehicleRows, ...policyRows] : ["ukryte dla tej roli"]),
    lines("Magazyn - pozycje ponizej minimum", access.canManageOrg ? warehouseRows : ["ukryte dla tej roli"]),
    lines("Sprzet - stan i aktywne przypisania", access.canManageOrg ? [...equipmentRows, ...equipmentAssignmentRows] : ["ukryte dla tej roli"])
  ].join("\n\n");

  return {
    scope,
    organizationId: access.organizationId,
    caseId: null,
    role: access.role,
    canSeeFinances: access.canSeeFinances,
    contextText,
    contextTitle: "Asystent AI firmy",
    profitability
  };
}

export async function buildAssistantQueryContext(
  supabase: Supabase,
  access: AssistantAccess,
  prompt: string,
  caseId?: string | null
): Promise<{ text: string; tools: string[] }> {
  const lower = prompt.toLocaleLowerCase("pl-PL");
  const wantsFinance = /(rentown|koszt|marż|zysk|faktur|płat|należ|zaleg|przych)/.test(lower);
  const wantsHr = /(pracownik|hierarch|strukt|brygad|bhp|bada|medyc|urlop|kadry)/.test(lower);
  const wantsPayroll = /(wynagrod|pensj|stawka godzin|dniów|wypłat|zaliczk.*pracownik|premi|potrącen|karta płac|rozliczeni.*pracownik)/.test(lower);
  const wantsDates = /(termin|kalendar|jutro|dzis|tydzień|miesiąc|wygas|harmonogram|przypomn)/.test(lower);
  const wantsCases = !!caseId || /(zlecen|spraw|budow|klient|realiz|status)/.test(lower);
  const tools: string[] = [];
  const blocks: string[] = [];

  if (wantsPayroll && !access.canViewPayroll) {
    blocks.push("Dane o indywidualnych wynagrodzeniach, stawkach, wypłatach i zaliczkach pracowników są ukryte dla roli Biuro. Możesz podać wyłącznie zagregowany koszt robocizny z rentowności.");
    tools.push("payroll.denied");
  }
  const orgId = access.organizationId;

  if (wantsCases) {
    let query = supabase
      .from("case_records")
      .select("id,client_name,location,status,next_contact_date,realization_end_date,estimated_value,updated_at")
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(caseId ? 1 : 500);
    if (caseId) query = query.eq("id", caseId);
    const { data, error } = await query;
    if (error) throw new Error(`Narzędzie zleceń: ${error.message}`);
    const rows = (data || []) as Array<Record<string, unknown>>;
    const statusCounts = new Map<string, number>();
    rows.forEach((row) => statusCounts.set(String(row.status), (statusCounts.get(String(row.status)) || 0) + 1));
    blocks.push(lines("Narzędzie: zlecenia", [
      `Liczba pasujących zleceń: ${rows.length}`,
      `Statusy: ${Array.from(statusCounts).map(([status, count]) => `${status}: ${count}`).join(", ") || "brak"}`,
      ...rows.slice(0, 80).map((row) => `${row.id} | ${row.client_name} | ${row.location || "brak lokalizacji"} | ${row.status} | kontakt ${dateLabel(row.next_contact_date as string | null)} | koniec ${dateLabel(row.realization_end_date as string | null)}${access.canSeeFinances ? ` | wartość ${money(row.estimated_value)}` : ""}`)
    ]));
    tools.push("cases.search");
  }

  if (wantsFinance && access.canSeeFinances) {
    const summary = await loadProfitabilityContext(supabase, orgId);
    blocks.push(lines("Narzędzie: finanse i rentowność", [
      `Wartość umowna / plan: ${money(summary.revenuePlanned)}`,
      `Faktury sprzedażowe: ${money(summary.revenueInvoiced)}`,
      `Należności powstałe: ${money(summary.revenueDue)}`,
      `Wpłacono: ${money(summary.revenuePaid)}`,
      `Otwarte należności: ${money(summary.unpaidRevenue)}`,
      `Po terminie: ${money(summary.overdueRevenue)}`,
      `Koszty: ${money(summary.totalCost)}`,
      `Wynik na wartości umownej: ${money(summary.profit)}`,
      ...summary.rows
        .filter((row) => !caseId || row.caseId === caseId)
        .sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit))
        .slice(0, 80)
        .map((row) => `${row.caseId} | ${row.clientName} | plan ${money(row.revenuePlanned)} | faktury ${money(row.revenueInvoiced)} | wpłaty ${money(row.revenuePaid)} | koszt ${money(row.totalCost)} | wynik ${money(row.profit)} | prognoza ${money(row.forecastProfit)} | wiarygodność ${row.forecastConfidence}`)
    ]));
    tools.push("finance.profitability");
  }

  if (wantsHr && access.canManageOrg) {
    const [{ data: employees }, { data: documents }, { data: crews }] = await Promise.all([
      supabase.from("employee_profiles").select("id,full_name,role_title,department,manager_employee_id,crew_id,bhp_valid_until,medical_valid_until,active").eq("organization_id", orgId).limit(500),
      supabase.from("employee_documents").select("employee_id,document_type,title,valid_until,status,requires_renewal").eq("organization_id", orgId).limit(1000),
      supabase.from("crews").select("id,name").eq("organization_id", orgId).limit(200)
    ]);
    const crewNames = new Map(((crews || []) as Array<{ id: string; name: string }>).map((crew) => [crew.id, crew.name]));
    blocks.push(lines("Narzędzie: struktura i kadry", [
      ...((employees || []) as Array<Record<string, unknown>>).map((employee) =>
        `${employee.id} | ${employee.full_name} | ${employee.role_title} | dział ${employee.department} | brygada ${crewNames.get(String(employee.crew_id)) || "brak"} | przełożony ${employee.manager_employee_id || "brak"} | BHP ${dateLabel(employee.bhp_valid_until as string | null)} | badania ${dateLabel(employee.medical_valid_until as string | null)} | ${employee.active ? "aktywny" : "nieaktywny"}`
      ),
      `Dokumenty: ${((documents || []) as Array<Record<string, unknown>>).map((document) => `${document.employee_id}: ${document.title} (${document.document_type}) do ${dateLabel(document.valid_until as string | null)}, ${document.status}`).join("; ") || "brak"}`
    ]));
    tools.push("hr.organization");
  }

  if (wantsPayroll && access.canViewPayroll) {
    const [{ data: profiles }, { data: compensation }, { data: cards }] = await Promise.all([
      supabase.from("employee_profiles").select("id,full_name,employment_type").eq("organization_id", orgId).eq("active", true),
      supabase.from("employee_compensation").select("employee_id,hourly_rate,day_rate,monthly_salary").eq("organization_id", orgId),
      supabase.from("employee_monthly_settlements").select("employee_id,period_month,status,hours_total,base_amount,bonuses_total,advances_total,previous_payments_total,amount_due").eq("organization_id", orgId).order("period_month", { ascending: false }).limit(300)
    ]);
    const names = new Map(((profiles || []) as Array<{ id: string; full_name: string }>).map((row) => [row.id, row.full_name]));
    blocks.push(lines("Narzędzie: poufne rozliczenia pracowników", [
      ...((compensation || []) as Array<Record<string, unknown>>).map((row) => `${names.get(String(row.employee_id)) || row.employee_id}: godz. ${money(row.hourly_rate)}, dzień ${money(row.day_rate)}, miesiąc ${money(row.monthly_salary)}`),
      ...((cards || []) as Array<Record<string, unknown>>).map((row) => `${names.get(String(row.employee_id)) || row.employee_id}, ${row.period_month}: status ${row.status}, godziny ${row.hours_total}, podstawa ${money(row.base_amount)}, premie ${money(row.bonuses_total)}, zaliczki ${money(row.advances_total)}, wypłacono ${money(row.previous_payments_total)}, do wypłaty ${money(row.amount_due)}`)
    ]));
    tools.push("payroll.private");
  }

  if (wantsDates) {
    const caseFilter = caseId ? { column: "case_id", value: caseId } : null;
    const taskQuery = supabase.from("case_tasks").select("id,case_id,title,due_date,status,priority").eq("organization_id", orgId).not("due_date", "is", null).limit(1000);
    const reminderQuery = supabase.from("reminders").select("id,case_id,title,remind_at,completed_at").eq("organization_id", orgId).is("completed_at", null).limit(1000);
    const scheduleQuery = supabase.from("case_schedule_items").select("id,case_id,title,due_date,completed").eq("organization_id", orgId).eq("completed", false).not("due_date", "is", null).limit(1000);
    const [taskRes, reminderRes, scheduleRes] = await Promise.all([
      caseFilter ? taskQuery.eq(caseFilter.column, caseFilter.value) : taskQuery,
      caseFilter ? reminderQuery.eq(caseFilter.column, caseFilter.value) : reminderQuery,
      caseFilter ? scheduleQuery.eq(caseFilter.column, caseFilter.value) : scheduleQuery
    ]);
    blocks.push(lines("Narzędzie: terminy", [
      `Zadania: ${((taskRes.data || []) as Array<Record<string, unknown>>).map((row) => `${row.case_id || "ogólne"}: ${row.title}, ${dateLabel(row.due_date as string | null)}, ${row.status}, ${row.priority}`).join("; ") || "brak"}`,
      `Przypomnienia: ${((reminderRes.data || []) as Array<Record<string, unknown>>).map((row) => `${row.case_id}: ${row.title}, ${row.remind_at}`).join("; ") || "brak"}`,
      `Harmonogramy: ${((scheduleRes.data || []) as Array<Record<string, unknown>>).map((row) => `${row.case_id}: ${row.title}, ${dateLabel(row.due_date as string | null)}`).join("; ") || "brak"}`
    ]));
    tools.push("calendar.deadlines");
  }

  if (blocks.length === 0) {
    blocks.push("Brak potrzeby uruchomienia dodatkowego narzędzia dla tego pytania.");
  }
  return { text: trimText(blocks.join("\n\n"), MAX_CONTEXT_CHARS), tools };
}

function section(contextText: string, title: string): string {
  const marker = `## ${title}`;
  const start = contextText.indexOf(marker);
  if (start < 0) return "brak danych";
  const rest = contextText.slice(start + marker.length).trim();
  const next = rest.indexOf("\n## ");
  return (next >= 0 ? rest.slice(0, next) : rest).trim() || "brak danych";
}

function topLines(value: string, limit = 8): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, limit);
}

function trimContextText(text: string, max = MAX_CONTEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 80)}\n\n[... kontekst skrócony z powodu limitu długości ...]`;
}

function buildAssistantSystemPrompt(ctx: AssistantContext): string {
  return [
    "Jesteś ekspertem firmy budowlanej GolBud.",
    "Odpowiadasz po polsku, konkretnie i biznesowo.",
    "Analizujesz wyłącznie dane przekazane w kontekście z aplikacji.",
    "Nie wymyślaj faktów, liczb, klientów, terminów ani kwot spoza kontekstu.",
    "Jeśli brakuje danych, napisz wprost: „brak danych w systemie”.",
    "Przy pytaniach o terminy HR zawsze sprawdzaj sekcje: „Kadry - terminy BHP, badan i dokumentow”, „Kadry - pracownicy” oraz „Struktura organizacyjna - schemat hierarchii”.",
    "Jeśli użytkownik pyta o „badania”, uwzględnij także BHP, szkolenia, uprawnienia i odnawialne dokumenty HR, chyba że wyraźnie prosi tylko o badania lekarskie.",
    "Przy pytaniach o hierarchię, przełożonych, brygady lub drzewko organizacyjne korzystaj ze struktury organizacyjnej z kontekstu.",
    "Przy pytaniach o samochody, polisy, magazyn albo sprzęt korzystaj z sekcji operacyjnych: flota, polisy, magazyn i sprzęt.",
    "Przy pytaniach o aktywne zlecenia, leady lub lejek sprzedażowo-realizacyjny korzystaj z sekcji zleceń oraz statusów zleceń.",
    "Nie wykonujesz żadnych zmian w bazie danych ani w aplikacji — tylko czytasz, analizujesz i rekomendujesz.",
    "Nie generujesz SQL ani zapytań do bazy.",
    "Nie proś o hasła, tokeny ani dane uwierzytelniające.",
    // Asystent ma znać moduł, żeby umieć do niego odesłać, ale treść korespondencji
    // jest poza jego zasięgiem — nie trafia do kontekstu i nie wolno jej zmyślać.
    "Aplikacja ma moduł „Historia korespondencji” w karcie zlecenia: pobiera z poczty użytkownika " +
      "wiadomości wymienione z adresem e-mail klienta, grupuje je w wątki, pokazuje załączniki " +
      "i pozwala odpowiadać. Każdy widzi wyłącznie własną skrzynkę.",
    "NIE MASZ DOSTĘPU do treści wiadomości e-mail ani do skrzynek pocztowych. Nigdy nie cytuj, " +
      "nie streszczaj i nie zgaduj treści korespondencji. Jeśli użytkownik pyta o e-maile z klientem, " +
      "odpowiedz, że treści wiadomości nie są dla Ciebie dostępne, i odeślij go do zakładki " +
      "„Historia korespondencji” przy zleceniu.",
    "Dawaj konkretne rekomendacje biznesowe: priorytety, ryzyka, następne kroki.",
    ctx.scope === "case"
      ? "Pracujesz w kontekście pojedynczego zlecenia budowlanego."
      : "Pracujesz w kontekście całej firmy (zlecenia, finanse, HR, zadania).",
    ctx.canSeeFinances
      ? "Użytkownik ma dostęp do danych finansowych — możesz omawiać płatności, koszty i rentowność."
      : "Użytkownik nie ma dostępu do danych finansowych — nie ujawniaj ukrytych kwot ani szczegółów finansowych."
  ].join("\n");
}

type OpenAiInputMessage = {
  role: "system" | "user" | "assistant";
  content: Array<{ type: "input_text" | "output_text"; text: string }>;
};

export async function loadAssistantConversationHistory(
  supabase: Supabase,
  conversationId: string,
  limit = MAX_HISTORY_MESSAGES
): Promise<AssistantHistoryMessage[]> {
  const { data, error } = await supabase
    .from("ai_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return ((data || []) as { role: string; content: string }[])
    .reverse()
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: trimText(message.content, MAX_HISTORY_MSG_CHARS)
    }));
}

export async function loadAssistantAttachmentContext(
  supabase: Supabase,
  access: AssistantAccess,
  attachmentIds: string[] = []
): Promise<{ text: string; attachments: AiMessageAttachment[] }> {
  const ids = Array.from(new Set(attachmentIds.map((id) => id.trim()).filter(Boolean))).slice(0, 8);
  if (ids.length === 0) return { text: "", attachments: [] };

  const { data, error } = await supabase
    .from("ai_message_attachments")
    .select("*")
    .eq("organization_id", access.organizationId)
    .in("id", ids);
  if (error) throw new Error(error.message);

  const attachments = (data || []) as AiMessageAttachment[];
  const blocks = attachments.map((attachment, index) => {
    const extracted = attachment.extracted_text?.trim();
    const status =
      attachment.extraction_status === "failed"
        ? `Nie udało się odczytać treści: ${attachment.extraction_error || "brak szczegółów"}`
        : extracted || "Brak odczytanej treści, dostępne są tylko metadane pliku.";
    return [
      `### Plik ${index + 1}: ${attachment.file_name}`,
      `Typ: ${attachment.mime_type || "nieznany"}, rozmiar: ${attachment.file_size} B, status odczytu: ${attachment.extraction_status}`,
      status
    ].join("\n");
  });

  return {
    attachments,
    text: trimText(blocks.join("\n\n"), MAX_ATTACHMENT_CONTEXT_CHARS)
  };
}

async function callOpenAiAssistant(params: {
  ctx: AssistantContext;
  prompt: string;
  history?: AssistantHistoryMessage[];
  attachmentContextText?: string;
}): Promise<{ content: string; model: string }> {
  const apiKey = openAiApiKey();
  if (!apiKey) {
    throw new OpenAiAssistantError("Brak klucza OPENAI_API_KEY w konfiguracji serwera. Dodaj zmienną w Vercel i wykonaj ponowny deploy.");
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const trimmedPrompt = trimText(params.prompt, MAX_PROMPT_CHARS);
  const contextText = trimContextText(params.ctx.contextText);
  const systemPrompt = buildAssistantSystemPrompt(params.ctx);
  const history = (params.history || []).slice(-MAX_HISTORY_MESSAGES);
  const attachmentContext = params.attachmentContextText?.trim()
    ? trimText(params.attachmentContextText, MAX_ATTACHMENT_CONTEXT_CHARS)
    : "";

  const input: OpenAiInputMessage[] = [
    { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
    { role: "system", content: [{ type: "input_text", text: `Kontekst z aplikacji GolBud:\n\n${contextText}` }] }
  ];
  if (attachmentContext) {
    input.push({
      role: "system",
      content: [{ type: "input_text", text: `Kontekst załączników użytkownika:\n\n${attachmentContext}` }]
    });
  }
  input.push(
    ...history.map((message) => ({
      role: message.role,
      content: [{ type: message.role === "assistant" ? "output_text" as const : "input_text" as const, text: message.content }]
    })),
    { role: "user", content: [{ type: "input_text", text: trimmedPrompt }] }
  );

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, input })
    });
  } catch {
    throw new OpenAiAssistantError("Nie udało się połączyć z OpenAI. Sprawdź połączenie sieciowe i spróbuj ponownie.");
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errJson = (await response.json()) as { error?: { message?: string } };
      detail = errJson.error?.message || "";
    } catch {
      /* ignore parse errors */
    }
    throw new OpenAiAssistantError(
      detail
        ? `OpenAI zwróciło błąd: ${detail}`
        : `OpenAI zwróciło błąd HTTP ${response.status}. Spróbuj ponownie później.`,
      response.status
    );
  }

  const json = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const content = (
    json.output_text ||
    json.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("\n") ||
    ""
  ).trim();

  if (!content) {
    throw new OpenAiAssistantError("OpenAI zwróciło pustą odpowiedź. Spróbuj ponownie.");
  }

  return { content, model };
}

function recommendations(ctx: AssistantContext, prompt: string): string[] {
  const lower = prompt.toLocaleLowerCase("pl-PL");
  if (lower.includes("rentown") || lower.includes("koszt") || lower.includes("marż")) {
    return [
      "Sprawdź budowy z niską marżą i porównaj koszty materiałów z planem.",
      "Dla pozycji z dużymi kosztami nieopłaconymi ustal termin płatności i odpowiedzialną osobę.",
      "Przy budowach z ujemną prognozą zatrzymaj dodatkowe koszty bez akceptacji właściciela."
    ];
  }
  if (lower.includes("płat") || lower.includes("należ") || lower.includes("zaleg")) {
    return [
      "Najpierw skontaktuj się z klientami po terminie i ustaw konkretną datę płatności.",
      "Dla większych zaległości przygotuj wezwanie do zapłaty z harmonogramu płatności.",
      "Przejrzyj kwoty gotówkowe i warunkowe, bo często nie trafiają do standardowego procesu przelewu."
    ];
  }
  if (lower.includes("bhp") || lower.includes("bad") || lower.includes("hr") || lower.includes("pracownik")) {
    return [
      "Uzupełnij brakujące terminy BHP i medycyny pracy przy aktywnych osobach.",
      "Najpierw obsłuż dokumenty wygasłe lub wygasające w najbliższych 30 dniach.",
      "Przy nowych osobach dopnij kierownika, brygadę i typ rozliczenia, żeby raporty były kompletne."
    ];
  }
  if (ctx.scope === "case") {
    return [
      "Dopilnuj najbliższego terminu kontaktu lub zakończenia etapu.",
      "Sprawdź, czy zadania otwarte mają właściciela i termin.",
      ctx.canSeeFinances ? "Zweryfikuj saldo płatności i koszty przed kolejnym etapem prac." : "Zweryfikuj etap i zakres prac z osobą prowadzącą."
    ];
  }
  return [
    "Skup się na zaległych płatnościach, budowach z niską marżą i zadaniach po terminie.",
    "Ustal właściciela dla każdego ryzyka: płatność, koszt, termin albo dokument HR.",
    "Na koniec tygodnia wygeneruj PDF zarządczy i omów tylko pozycje odstające."
  ];
}

function generateLocalAssistantAnswer(ctx: AssistantContext, prompt: string, attachmentContextText?: string): string {
  const lower = prompt.toLocaleLowerCase("pl-PL");
  const picked: string[] = [];
  if (attachmentContextText?.trim()) picked.push(attachmentContextText.trim());
  if (ctx.scope === "case") picked.push(section(ctx.contextText, "Sprawa"));
  if (lower.includes("płat") || lower.includes("należ") || lower.includes("zaleg") || lower.includes("podsum")) picked.push(section(ctx.contextText, "Płatności"), section(ctx.contextText, "Rejestr należności"));
  if (lower.includes("rentown") || lower.includes("koszt") || lower.includes("marż") || lower.includes("zysk") || lower.includes("podsum")) picked.push(section(ctx.contextText, "Rentowność sprawy"), section(ctx.contextText, "Rentowność firmy"), section(ctx.contextText, "Faktury kosztowe"), section(ctx.contextText, "Koszty bezpośrednie"));
  if (lower.includes("zad") || lower.includes("piln") || lower.includes("ryzyk") || lower.includes("podsum")) picked.push(section(ctx.contextText, "Zadania"));
  if (lower.includes("plik") || lower.includes("dokument") || lower.includes("załącz")) picked.push(section(ctx.contextText, "Pliki i załączniki"));
  if (lower.includes("hr") || lower.includes("bhp") || lower.includes("bad") || lower.includes("pracownik")) picked.push(section(ctx.contextText, "Kadry"));
  if (picked.length === 0) picked.push(ctx.contextText);

  const unique = Array.from(new Set(picked.filter((part) => part && part !== "brak danych" && !part.includes("ukryte dla tej roli"))));
  const facts = topLines(unique.join("\n"), 12);
  const recs = recommendations(ctx, prompt);

  return [
    `## ${ctx.scope === "case" ? "Podsumowanie sprawy" : "Podsumowanie firmy"}`,
    facts.length ? facts.join("\n") : "W systemie nie ma wystarczających danych dla tego pytania.",
    "",
    "## Wnioski biznesowe",
    ...recs.map((r) => `- ${r}`),
    "",
    "## Uwaga",
    "To podsumowanie powstało lokalnie na podstawie danych w aplikacji. Nie zmieniam żadnych danych w systemie."
  ].join("\n");
}

export async function generateAssistantAnswer(
  ctx: AssistantContext,
  prompt: string,
  history: AssistantHistoryMessage[] = [],
  attachmentContextText?: string
): Promise<{ content: string; meta: AssistantGenerationMeta }> {
  const baseMeta: AssistantGenerationMeta = {
    provider: "local",
    context_scope: ctx.scope,
    canSeeFinances: ctx.canSeeFinances
  };
  const attachmentContext = attachmentContextText?.trim() || undefined;

  if (openAiApiKey()) {
    const { content, model } = await callOpenAiAssistant({ ctx, prompt, history, attachmentContextText: attachmentContext });
    return {
      content,
      meta: {
        provider: "openai",
        model,
        context_scope: ctx.scope,
        canSeeFinances: ctx.canSeeFinances
      }
    };
  }

  if (process.env.AI_ASSISTANT_ALLOW_LOCAL_FALLBACK === "true") {
    return {
      content: generateLocalAssistantAnswer(ctx, prompt, attachmentContext),
      meta: baseMeta
    };
  }

  throw new OpenAiAssistantError("Asystent AI wymaga OPENAI_API_KEY. Lokalny fallback jest wyłączony, żeby nie udawać działania OpenAI.");
}

const CONVERSATION_TITLE_MAX_LENGTH = 60;

/**
 * Tytuł nowej rozmowy = początek pierwszej wiadomości użytkownika (jak w większości
 * czatów AI), żeby rozmowy dały się rozróżnić na liście po lewej stronie panelu.
 * Używany tylko przy tworzeniu NOWEJ rozmowy — `getOrCreateConversation` ignoruje
 * `title`, jeśli znajdzie i zwróci już istniejącą rozmowę.
 */
export function deriveConversationTitle(rawMessage: string | null | undefined, fallback: string): string {
  const normalized = (rawMessage || "").replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  if (normalized.length <= CONVERSATION_TITLE_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, CONVERSATION_TITLE_MAX_LENGTH).trimEnd()}…`;
}

export async function getOrCreateConversation(
  supabase: Supabase,
  access: AssistantAccess,
  userId: string,
  input: { conversationId?: string | null; caseId?: string | null; title?: string | null; forceNew?: boolean }
): Promise<AiConversation> {
  // Historia rozmów jest prywatna per użytkownik — każde wyszukanie jest zawężone do
  // rozmów założonych przez tę samą osobę (created_by), niezależnie od tego, że RLS
  // egzekwuje to samo w bazie. Dzięki temu logika jest poprawna nawet bez polegania
  // wyłącznie na politykach RLS.
  if (input.conversationId) {
    const { data, error } = await supabase
      .from("ai_conversations")
      .select("*")
      .eq("id", input.conversationId)
      .eq("organization_id", access.organizationId)
      .eq("created_by", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as AiConversation;
  }

  if (input.caseId && !input.forceNew) {
    const { data } = await supabase
      .from("ai_conversations")
      .select("*")
      .eq("organization_id", access.organizationId)
      .eq("case_id", input.caseId)
      .eq("context_type", "case")
      .eq("created_by", userId)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as AiConversation;
  }

  const title = input.title?.trim() || (input.caseId ? "Asystent AI sprawy" : "Asystent AI firmy");
  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({
      organization_id: access.organizationId,
      case_id: input.caseId || null,
      context_type: input.caseId ? "case" : "global",
      title,
      created_by: userId
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AiConversation;
}

export async function saveAssistantExchange(
  supabase: Supabase,
  access: AssistantAccess,
  userId: string,
  conversation: AiConversation,
  prompt: string,
  answer: string,
  meta?: AssistantExchangeMeta
): Promise<AssistantChatResult> {
  const { data: userMessage, error: userError } = await supabase
    .from("ai_messages")
    .insert({
      organization_id: access.organizationId,
      conversation_id: conversation.id,
      case_id: conversation.case_id,
      role: "user",
      content: prompt,
      created_by: userId,
      meta: meta?.user ?? null
    })
    .select("*")
    .single();
  if (userError) throw new Error(userError.message);

  const { data: assistantMessage, error: assistantError } = await supabase
    .from("ai_messages")
    .insert({
      organization_id: access.organizationId,
      conversation_id: conversation.id,
      case_id: conversation.case_id,
      role: "assistant",
      content: answer,
      created_by: null,
      meta: meta?.assistant ?? null
    })
    .select("*")
    .single();
  if (assistantError) throw new Error(assistantError.message);

  const { data: updated } = await supabase.from("ai_conversations").select("*").eq("id", conversation.id).maybeSingle();
  return {
    conversation: (updated || conversation) as AiConversation,
    userMessage: userMessage as AiMessage,
    assistantMessage: assistantMessage as AiMessage
  };
}

export function caseSummaryPrompt(): string {
  return [
    "Wygeneruj krótkie, konkretne podsumowanie aktualnego stanu tego zlecenia.",
    "Format:",
    "1. Status i etap",
    "2. Najważniejsze liczby",
    "3. Ryzyka / rzeczy do dopilnowania",
    "4. Następne kroki",
    "Pisz jak notatkę dla właściciela firmy budowlanej. Maksymalnie 12 punktów."
  ].join("\n");
}

export function reportPrompt(type: AssistantReportType, customPrompt?: string): string {
  const base: Record<AssistantReportType, string> = {
    case_summary: "Przygotuj raport sprawy: status, zakres, terminy, płatności, koszty, ryzyka i następne kroki.",
    financial_control: "Przygotuj raport należności, zaległości, sporów, gotówki i budów do kontroli.",
    profitability: "Przygotuj raport rentowności: gdzie firma zarabia, gdzie traci i gdzie ucieka gotówka.",
    hr: "Przygotuj raport HR: BHP, medycyna pracy, ryzyka terminów i działania dla biura.",
    monthly_owner: `Przygotuj miesięczny raport właścicielski za ${monthKey()}: finanse, realizacje, ryzyka i priorytety.`
  };
  const request = customPrompt?.trim() || base[type];
  return [
    request,
    "",
    "Zwróć treść jako profesjonalny raport zarządczy dla właściciela firmy budowlanej GolBud.",
    "Nie używaj markdownowego pogrubienia **...**, podkreśleń _, tabel markdown ani separatorów ---.",
    "Nie powtarzaj tych samych zdań jako nagłówek i treść.",
    "Nie pokazuj nazw technicznych pól, typów raportu ani parametrów typu monthly_owner.",
    "Struktura obowiązkowa:",
    "1. Podsumowanie właścicielskie - 3 do 5 najważniejszych wniosków.",
    "2. Kluczowe liczby - kwoty, terminy, liczby spraw i statusy, tylko jeśli są w danych.",
    "3. Co wymaga reakcji - priorytety i ryzyka.",
    "4. Rekomendowane działania - konkretna lista z odpowiedzialnością biznesową.",
    "5. Dane źródłowe / ograniczenia - krótko, tylko jeśli brakuje danych.",
    "Pisz zwięźle, konkretnie, bez lania wody. Każda sekcja ma mieć maksymalnie 6 punktów."
  ].join("\n");
}
