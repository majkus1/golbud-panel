"use client";

import { useCallback, useEffect, useState } from "react";
import { canSeeFinances } from "@/components/org-context";
import { dropTrashedCaseRows, loadTrashedCaseIds } from "@/lib/active-cases";
import { buildGrid, isoOf, type MonthCursor } from "@/lib/calendar";
import { supabase } from "@/lib/supabase";
import type {
  CaseRow,
  CaseScheduleItem,
  CaseSubcontractor,
  CaseTask,
  CompanyPolicy,
  EmployeeDocument,
  EmployeeDocumentType,
  EmployeeProfile,
  Invoice,
  MemberRole,
  Payment,
  Reminder,
  SupplierInvoice,
  Vehicle
} from "@/lib/types";

export type CalendarHrItem = Pick<EmployeeDocument, "id" | "employee_id" | "document_type" | "title" | "valid_until" | "requires_renewal"> & {
  source: "document" | "profile";
};

export type CalendarBusinessItem = {
  id: string;
  date: string;
  title: string;
  subtitle: string;
  href: string;
  tone: "moss" | "amber" | "red" | "sky" | "stone";
  kind: "case_contact" | "case_end" | "schedule" | "reminder" | "payment_due" | "sales_invoice_due" | "supplier_due" | "subcontractor" | "vehicle" | "policy";
};

export type CalendarCaseOption = Pick<CaseRow, "id" | "client_name" | "location">;

export type CalendarData = {
  /** Zadania i wpisy z datą w widocznym zakresie (bez spraw z kosza). */
  tasks: CaseTask[];
  hrItems: CalendarHrItem[];
  businessItems: CalendarBusinessItem[];
  employeeLabels: Record<string, string>;
  /** „Klient — miejscowość” dla spraw widocznych dla użytkownika. */
  caseLabels: Record<string, string>;
  /** Aktywne sprawy do wyboru przy wpisie. */
  caseOptions: CalendarCaseOption[];
  loading: boolean;
  reload: () => Promise<void>;
};

/**
 * Terminy do kalendarza firmy: zadania i wpisy, terminy kadrowe oraz terminy ze spraw,
 * finansów, floty i polis. Widoczność jak dotąd na stronie Kalendarza:
 *  - kadry: wszyscy poza podwykonawcą, zawężenie robią funkcje RPC `employee_hr_*_visible`
 *    (SECURITY DEFINER), żeby nie ujawniać danych płacowych;
 *  - płatności, faktury, podwykonawcy, samochody i polisy — tylko role z dostępem do finansów;
 *  - resztę zawęża RLS (brygadzista widzi swoje sprawy i zadania).
 */
export function useCalendarData(organizationId: string | null, role: MemberRole | null, cursor: MonthCursor, todayIso: string): CalendarData {
  const canSeeHr = role !== "podwykonawca";
  const canSeeBusinessSensitive = canSeeFinances(role);

  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [hrItems, setHrItems] = useState<CalendarHrItem[]>([]);
  const [businessItems, setBusinessItems] = useState<CalendarBusinessItem[]>([]);
  const [employeeLabels, setEmployeeLabels] = useState<Record<string, string>>({});
  const [caseLabels, setCaseLabels] = useState<Record<string, string>>({});
  const [caseOptions, setCaseOptions] = useState<CalendarCaseOption[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const grid = buildGrid(cursor.year, cursor.month);
    const from = isoOf(grid[0]);
    const to = isoOf(grid[grid.length - 1]);
    const inRange = (date: string | null | undefined): date is string => !!date && date >= from && date <= to;

    const [taskRes, documentRes, employeeRes, caseRes, scheduleRes, reminderRes, paymentRes, salesInvoiceRes, supplierRes, subcontractorRes, vehicleRes, policyRes] = await Promise.all([
      supabase.from("case_tasks").select("*").eq("organization_id", organizationId).not("due_date", "is", null).gte("due_date", from).lte("due_date", to).order("due_date", { ascending: true }),
      canSeeHr ? supabase.rpc("employee_hr_documents_visible", { target_org: organizationId }) : Promise.resolve({ data: [] }),
      canSeeHr ? supabase.rpc("employee_hr_profiles_visible", { target_org: organizationId }) : Promise.resolve({ data: [] }),
      supabase.from("cases").select("id,client_name,location,next_contact_date,realization_end_date,status").eq("organization_id", organizationId).is("deleted_at", null).order("created_at", { ascending: false }),
      supabase.from("case_schedule_items").select("*").eq("organization_id", organizationId).eq("completed", false).not("due_date", "is", null).gte("due_date", from).lte("due_date", to).order("due_date"),
      supabase.from("reminders").select("*").eq("organization_id", organizationId).is("completed_at", null).gte("remind_at", `${from}T00:00:00`).lte("remind_at", `${to}T23:59:59`).order("remind_at"),
      canSeeBusinessSensitive ? supabase.from("payments").select("*").eq("organization_id", organizationId).not("due_date", "is", null).gte("due_date", from).lte("due_date", to).order("due_date", { ascending: true }) : Promise.resolve({ data: [] }),
      canSeeBusinessSensitive ? supabase.from("invoices").select("*").eq("organization_id", organizationId).not("due_date", "is", null).neq("status", "anulowana").gte("due_date", from).lte("due_date", to).order("due_date", { ascending: true }) : Promise.resolve({ data: [] }),
      canSeeBusinessSensitive ? supabase.from("supplier_invoices").select("*").eq("organization_id", organizationId).not("due_date", "is", null).gte("due_date", from).lte("due_date", to).order("due_date", { ascending: true }) : Promise.resolve({ data: [] }),
      canSeeBusinessSensitive ? supabase.from("case_subcontractors").select("*").eq("organization_id", organizationId) : Promise.resolve({ data: [] }),
      canSeeBusinessSensitive ? supabase.from("vehicles").select("*").eq("organization_id", organizationId) : Promise.resolve({ data: [] }),
      canSeeBusinessSensitive ? supabase.from("company_policies").select("*").eq("organization_id", organizationId) : Promise.resolve({ data: [] })
    ]);
    // Terminy ze spraw w koszu (zadania, płatności, faktury, etapy) nie trafiają do kalendarza.
    const trashed = await loadTrashedCaseIds(supabase, organizationId);
    const active = <T extends { case_id?: string | null }>(data: unknown): T[] => dropTrashedCaseRows((data || []) as T[], trashed);

    const visibleCases = (caseRes.data || []) as Pick<CaseRow, "id" | "client_name" | "location" | "next_contact_date" | "realization_end_date" | "status">[];
    const caseNameById = new Map(visibleCases.map((c) => [c.id, `${c.client_name}${c.location ? ` — ${c.location}` : ""}`]));
    setCaseLabels(Object.fromEntries(Array.from(caseNameById.entries())));
    setCaseOptions(visibleCases.map((c) => ({ id: c.id, client_name: c.client_name, location: c.location })));
    setTasks(active<CaseTask>(taskRes.data));

    // RPC nie filtruje po dacie (zbiór jest już mały — własne/brygadowe terminy),
    // więc zakres miesiąca stosujemy tutaj, tak jak dla terminów z profilu poniżej.
    const loadedDocuments = ((documentRes.data || []) as EmployeeDocument[]).filter((document) => inRange(document.valid_until));
    const loadedEmployees = (employeeRes.data || []) as Pick<EmployeeProfile, "id" | "full_name" | "bhp_valid_until" | "medical_valid_until">[];
    const employeeMap: Record<string, string> = {};
    for (const employee of loadedEmployees) employeeMap[employee.id] = employee.full_name;
    setEmployeeLabels(employeeMap);
    const hasStoredDocument = new Set(loadedDocuments.map((document) => `${document.employee_id}:${document.document_type}`));
    const profileItems: CalendarHrItem[] = [];
    for (const employee of loadedEmployees) {
      const addProfileItem = (documentType: EmployeeDocumentType, validUntil: string | null, title: string) => {
        if (!inRange(validUntil) || hasStoredDocument.has(`${employee.id}:${documentType}`)) return;
        profileItems.push({ id: `${employee.id}-${documentType}-${validUntil}`, employee_id: employee.id, document_type: documentType, title, valid_until: validUntil, requires_renewal: true, source: "profile" });
      };
      addProfileItem("bhp", employee.bhp_valid_until, "Szkolenie BHP");
      addProfileItem("medical", employee.medical_valid_until, "Badania lekarskie");
    }
    setHrItems([
      ...loadedDocuments.map((document) => ({
        id: document.id,
        employee_id: document.employee_id,
        document_type: document.document_type,
        title: document.title,
        valid_until: document.valid_until,
        requires_renewal: document.requires_renewal,
        source: "document" as const
      })),
      ...profileItems
    ]);

    const business: CalendarBusinessItem[] = [];
    for (const c of visibleCases) {
      const label = caseNameById.get(c.id) || c.client_name;
      if (inRange(c.next_contact_date)) {
        business.push({ id: `${c.id}-contact`, date: c.next_contact_date, title: `Kontakt: ${c.client_name}`, subtitle: `${c.status} · ${c.location || "brak lokalizacji"}`, href: `/cases/${c.id}`, tone: "sky", kind: "case_contact" });
      }
      if (inRange(c.realization_end_date)) {
        business.push({ id: `${c.id}-end`, date: c.realization_end_date, title: `Koniec: ${c.client_name}`, subtitle: label, href: `/cases/${c.id}`, tone: c.realization_end_date < todayIso ? "red" : "moss", kind: "case_end" });
      }
    }
    for (const item of active<CaseScheduleItem>(scheduleRes.data)) {
      if (!item.due_date) continue;
      business.push({ id: `${item.id}-schedule`, date: item.due_date, title: `Etap: ${item.title}`, subtitle: caseNameById.get(item.case_id) || item.description || "Harmonogram zlecenia", href: `/cases/${item.case_id}`, tone: item.due_date < todayIso ? "red" : "moss", kind: "schedule" });
    }
    for (const reminder of active<Reminder>(reminderRes.data)) {
      const date = reminder.remind_at.slice(0, 10);
      business.push({ id: `${reminder.id}-reminder`, date, title: `Przypomnienie: ${reminder.title}`, subtitle: caseNameById.get(reminder.case_id) || reminder.note || "Zlecenie", href: `/cases/${reminder.case_id}`, tone: date < todayIso ? "red" : "sky", kind: "reminder" });
    }
    for (const p of active<Payment>(paymentRes.data)) {
      const left = Number(p.amount_due || 0) - Number(p.amount_paid || 0);
      if (!p.due_date || left <= 0) continue;
      business.push({ id: `${p.id}-payment`, date: p.due_date, title: `Płatność: ${p.title}`, subtitle: caseNameById.get(p.case_id) || "Zlecenie", href: `/cases/${p.case_id}`, tone: p.due_date < todayIso ? "red" : "amber", kind: "payment_due" });
    }
    for (const invoice of active<Invoice>(salesInvoiceRes.data)) {
      const left = Number(invoice.gross_total || 0) - Number(invoice.paid_amount || 0);
      if (!invoice.due_date || left <= 0 || invoice.status === "szkic") continue;
      business.push({ id: `${invoice.id}-sales-invoice`, date: invoice.due_date, title: `Faktura sprzedażowa: ${invoice.number}`, subtitle: `${caseNameById.get(invoice.case_id) || invoice.buyer_name} · pozostało ${left.toLocaleString("pl-PL")} zł`, href: `/cases/${invoice.case_id}`, tone: invoice.due_date < todayIso ? "red" : "amber", kind: "sales_invoice_due" });
    }
    for (const invoice of active<SupplierInvoice>(supplierRes.data)) {
      const left = Number(invoice.gross_total || 0) - Number(invoice.paid_amount || 0);
      if (!invoice.due_date || left <= 0) continue;
      business.push({ id: `${invoice.id}-supplier`, date: invoice.due_date, title: `Faktura kosztowa: ${invoice.supplier_name}`, subtitle: `${invoice.category}${invoice.invoice_number ? ` · ${invoice.invoice_number}` : ""}`, href: "/reports/profitability", tone: invoice.due_date < todayIso ? "red" : "amber", kind: "supplier_due" });
    }
    for (const subcontractor of active<CaseSubcontractor>(subcontractorRes.data)) {
      const dates = [
        { key: "start", date: subcontractor.start_date, title: "Start prac podwykonawcy" },
        { key: "end", date: subcontractor.end_date, title: "Koniec prac podwykonawcy" }
      ];
      for (const item of dates) {
        if (!inRange(item.date)) continue;
        business.push({ id: `${subcontractor.id}-${item.key}`, date: item.date, title: item.title, subtitle: `${caseNameById.get(subcontractor.case_id) || "Zlecenie"} · ${subcontractor.scope || "zakres nieuzupełniony"}`, href: `/cases/${subcontractor.case_id}`, tone: item.date < todayIso ? "red" : "stone", kind: "subcontractor" });
      }
    }
    for (const vehicle of (vehicleRes.data || []) as Vehicle[]) {
      const dates = [
        { key: "inspection", date: vehicle.inspection_expires, title: `Przegląd: ${vehicle.name}` },
        { key: "oc", date: vehicle.insurance_oc_expires || vehicle.insurance_expires, title: `OC: ${vehicle.name}` },
        { key: "ac", date: vehicle.insurance_ac_expires, title: `AC: ${vehicle.name}` }
      ];
      for (const item of dates) {
        if (!inRange(item.date)) continue;
        business.push({ id: `${vehicle.id}-${item.key}`, date: item.date, title: item.title, subtitle: vehicle.registration_number || vehicle.make_model || "Samochód", href: `/vehicles/${vehicle.id}`, tone: item.date < todayIso ? "red" : "amber", kind: "vehicle" });
      }
    }
    for (const policy of (policyRes.data || []) as CompanyPolicy[]) {
      const dates = [
        { key: "coverage", date: policy.coverage_end, title: `Polisa wygasa: ${policy.policy_type}` },
        { key: "payment", date: policy.payment_due, title: `Płatność polisy: ${policy.policy_type}` }
      ];
      for (const item of dates) {
        if (!inRange(item.date)) continue;
        business.push({ id: `${policy.id}-${item.key}`, date: item.date, title: item.title, subtitle: policy.insurer || policy.policy_number || "Polisa firmowa", href: "/policies", tone: item.date < todayIso ? "red" : "amber", kind: "policy" });
      }
    }
    setBusinessItems(business.sort((a, b) => a.date.localeCompare(b.date)));
    setLoading(false);
  }, [organizationId, cursor, canSeeHr, canSeeBusinessSensitive, todayIso]);

  useEffect(() => {
    void load();
  }, [load]);

  return { tasks, hrItems, businessItems, employeeLabels, caseLabels, caseOptions, loading, reload: load };
}
