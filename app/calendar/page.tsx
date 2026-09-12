"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { canManageOrg, canSeeFinances, useOrg } from "@/components/org-context";
import { formatDate } from "@/lib/format";
import { documentExpiryLabel, EMPLOYEE_DOCUMENT_TYPE_LABELS } from "@/lib/hr";
import { supabase } from "@/lib/supabase";
import { warsawTodayIso } from "@/lib/warsaw-today";
import type { CaseRow, CaseScheduleItem, CaseSubcontractor, CaseTask, CompanyPolicy, EmployeeDocument, EmployeeDocumentType, EmployeeProfile, Invoice, Payment, Reminder, SupplierInvoice, TaskPriority, Vehicle } from "@/lib/types";

type CalendarFilter = "all" | "tasks" | "hr" | "business";
type CalendarHrItem = Pick<EmployeeDocument, "id" | "employee_id" | "document_type" | "title" | "valid_until" | "requires_renewal"> & {
  source: "document" | "profile";
};
type CalendarBusinessItem = {
  id: string;
  date: string;
  title: string;
  subtitle: string;
  href: string;
  tone: "moss" | "amber" | "red" | "sky" | "stone";
  kind: "case_contact" | "case_end" | "schedule" | "reminder" | "payment_due" | "sales_invoice_due" | "supplier_due" | "subcontractor" | "vehicle" | "policy";
};

const WEEKDAYS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];
const MONTHS = [
  "Styczeń",
  "Luty",
  "Marzec",
  "Kwiecień",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpień",
  "Wrzesień",
  "Październik",
  "Listopad",
  "Grudzień"
];

const PRIORITY_DOT: Record<TaskPriority, string> = {
  niski: "bg-sky-400",
  normalny: "bg-stone-400",
  wysoki: "bg-amber-400",
  pilne: "bg-red-500"
};

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 42 dni siatki: od poniedziałku tygodnia z 1. dniem miesiąca. */
function buildGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // poniedziałek = 0
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export default function CalendarPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <CalendarInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function CalendarInner() {
  const { organizationId, role } = useOrg();
  // Kadry: właściciel/biuro/kierownik widzą wszystkich; brygadzista widzi tylko
  // swoją brygadę i bezpośrednich podwładnych; zwykły pracownik i handlowiec —
  // wyłącznie własne terminy; podwykonawca (rola zewnętrzna) nie widzi nic.
  // Zawężenie realizują funkcje RPC `employee_hr_*_visible` (SECURITY DEFINER),
  // a nie zwykłe zapytanie do tabeli — tak, żeby nie ujawniać danych płacowych.
  const canSeeHr = role !== "podwykonawca";
  const canSeeBusinessSensitive = canSeeFinances(role);
  const todayIso = warsawTodayIso();
  const today = new Date(`${todayIso}T00:00:00`);

  const [cursor, setCursor] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));
  const [selected, setSelected] = useState<string>(todayIso);
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [hrItems, setHrItems] = useState<CalendarHrItem[]>([]);
  const [businessItems, setBusinessItems] = useState<CalendarBusinessItem[]>([]);
  const [employeeLabels, setEmployeeLabels] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [caseLabels, setCaseLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const grid = useMemo(() => buildGrid(cursor.year, cursor.month), [cursor]);
  const rangeStart = grid[0];
  const rangeEnd = grid[grid.length - 1];

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const [taskRes, documentRes, employeeRes, caseRes, scheduleRes, reminderRes, paymentRes, salesInvoiceRes, supplierRes, subcontractorRes, vehicleRes, policyRes] = await Promise.all([
      supabase.from("case_tasks").select("*").eq("organization_id", organizationId).not("due_date", "is", null).gte("due_date", isoOf(rangeStart)).lte("due_date", isoOf(rangeEnd)).order("due_date", { ascending: true }),
      // RPC (SECURITY DEFINER) zamiast bezpośredniego select — zwraca tylko wiersze
      // widoczne dla danej roli (własne / brygada / wszyscy) i tylko bezpieczne kolumny.
      canSeeHr
        ? supabase.rpc("employee_hr_documents_visible", { target_org: organizationId })
        : Promise.resolve({ data: [] }),
      canSeeHr
        ? supabase.rpc("employee_hr_profiles_visible", { target_org: organizationId })
        : Promise.resolve({ data: [] }),
      supabase.from("cases").select("id,client_name,location,next_contact_date,realization_end_date,status").eq("organization_id", organizationId),
      supabase.from("case_schedule_items").select("*").eq("organization_id", organizationId).eq("completed", false).not("due_date", "is", null).gte("due_date", isoOf(rangeStart)).lte("due_date", isoOf(rangeEnd)).order("due_date"),
      supabase.from("reminders").select("*").eq("organization_id", organizationId).is("completed_at", null).gte("remind_at", `${isoOf(rangeStart)}T00:00:00`).lte("remind_at", `${isoOf(rangeEnd)}T23:59:59`).order("remind_at"),
      canSeeBusinessSensitive ? supabase.from("payments").select("*").eq("organization_id", organizationId).not("due_date", "is", null).gte("due_date", isoOf(rangeStart)).lte("due_date", isoOf(rangeEnd)).order("due_date", { ascending: true }) : Promise.resolve({ data: [] }),
      canSeeBusinessSensitive ? supabase.from("invoices").select("*").eq("organization_id", organizationId).not("due_date", "is", null).neq("status", "anulowana").gte("due_date", isoOf(rangeStart)).lte("due_date", isoOf(rangeEnd)).order("due_date", { ascending: true }) : Promise.resolve({ data: [] }),
      canSeeBusinessSensitive ? supabase.from("supplier_invoices").select("*").eq("organization_id", organizationId).not("due_date", "is", null).gte("due_date", isoOf(rangeStart)).lte("due_date", isoOf(rangeEnd)).order("due_date", { ascending: true }) : Promise.resolve({ data: [] }),
      canSeeBusinessSensitive ? supabase.from("case_subcontractors").select("*").eq("organization_id", organizationId) : Promise.resolve({ data: [] }),
      canSeeBusinessSensitive ? supabase.from("vehicles").select("*").eq("organization_id", organizationId) : Promise.resolve({ data: [] }),
      canSeeBusinessSensitive ? supabase.from("company_policies").select("*").eq("organization_id", organizationId) : Promise.resolve({ data: [] })
    ]);
    const loaded = (taskRes.data || []) as CaseTask[];
    // RPC nie filtruje po dacie (zbiór jest już mały — własne/brygadowe terminy),
    // więc zakres miesiąca stosujemy tutaj, tak jak dla terminów z profilu poniżej.
    const loadedDocuments = ((documentRes.data || []) as EmployeeDocument[]).filter(
      (document) => !!document.valid_until && document.valid_until >= isoOf(rangeStart) && document.valid_until <= isoOf(rangeEnd)
    );
    const loadedEmployees = (employeeRes.data || []) as Pick<EmployeeProfile, "id" | "full_name" | "bhp_valid_until" | "medical_valid_until">[];
    setTasks(loaded);
    const employeeMap: Record<string, string> = {};
    for (const employee of loadedEmployees) employeeMap[employee.id] = employee.full_name;
    setEmployeeLabels(employeeMap);
    const hasStoredDocument = new Set(loadedDocuments.map((document) => `${document.employee_id}:${document.document_type}`));
    const profileItems: CalendarHrItem[] = [];
    for (const employee of loadedEmployees) {
      const addProfileItem = (documentType: EmployeeDocumentType, validUntil: string | null, title: string) => {
        if (!validUntil || hasStoredDocument.has(`${employee.id}:${documentType}`)) return;
        if (validUntil < isoOf(rangeStart) || validUntil > isoOf(rangeEnd)) return;
        profileItems.push({
          id: `${employee.id}-${documentType}-${validUntil}`,
          employee_id: employee.id,
          document_type: documentType,
          title,
          valid_until: validUntil,
          requires_renewal: true,
          source: "profile"
        });
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
    for (const c of (caseRes.data || []) as Pick<CaseRow, "id" | "client_name" | "location" | "next_contact_date" | "realization_end_date" | "status">[]) {
      const label = `${c.client_name}${c.location ? ` — ${c.location}` : ""}`;
      if (c.next_contact_date && c.next_contact_date >= isoOf(rangeStart) && c.next_contact_date <= isoOf(rangeEnd)) {
        business.push({ id: `${c.id}-contact`, date: c.next_contact_date, title: `Kontakt: ${c.client_name}`, subtitle: `${c.status} · ${c.location || "brak lokalizacji"}`, href: `/cases/${c.id}`, tone: "sky", kind: "case_contact" });
      }
      if (c.realization_end_date && c.realization_end_date >= isoOf(rangeStart) && c.realization_end_date <= isoOf(rangeEnd)) {
        business.push({ id: `${c.id}-end`, date: c.realization_end_date, title: `Koniec: ${c.client_name}`, subtitle: label, href: `/cases/${c.id}`, tone: c.realization_end_date < todayIso ? "red" : "moss", kind: "case_end" });
      }
    }
    const caseNameById = new Map(((caseRes.data || []) as Pick<CaseRow, "id" | "client_name" | "location">[]).map((c) => [c.id, `${c.client_name}${c.location ? ` — ${c.location}` : ""}`]));
    for (const item of (scheduleRes.data || []) as CaseScheduleItem[]) {
      if (!item.due_date) continue;
      business.push({ id: `${item.id}-schedule`, date: item.due_date, title: `Etap: ${item.title}`, subtitle: caseNameById.get(item.case_id) || item.description || "Harmonogram zlecenia", href: `/cases/${item.case_id}`, tone: item.due_date < todayIso ? "red" : "moss", kind: "schedule" });
    }
    for (const reminder of (reminderRes.data || []) as Reminder[]) {
      const date = reminder.remind_at.slice(0, 10);
      business.push({ id: `${reminder.id}-reminder`, date, title: `Przypomnienie: ${reminder.title}`, subtitle: caseNameById.get(reminder.case_id) || reminder.note || "Zlecenie", href: `/cases/${reminder.case_id}`, tone: date < todayIso ? "red" : "sky", kind: "reminder" });
    }
    for (const p of (paymentRes.data || []) as Payment[]) {
      const left = Number(p.amount_due || 0) - Number(p.amount_paid || 0);
      if (!p.due_date || left <= 0) continue;
      business.push({ id: `${p.id}-payment`, date: p.due_date, title: `Płatność: ${p.title}`, subtitle: caseNameById.get(p.case_id) || "Zlecenie", href: `/cases/${p.case_id}`, tone: p.due_date < todayIso ? "red" : "amber", kind: "payment_due" });
    }
    for (const invoice of (salesInvoiceRes.data || []) as Invoice[]) {
      const left = Number(invoice.gross_total || 0) - Number(invoice.paid_amount || 0);
      if (!invoice.due_date || left <= 0 || invoice.status === "szkic") continue;
      business.push({ id: `${invoice.id}-sales-invoice`, date: invoice.due_date, title: `Faktura sprzedażowa: ${invoice.number}`, subtitle: `${caseNameById.get(invoice.case_id) || invoice.buyer_name} · pozostało ${left.toLocaleString("pl-PL")} zł`, href: `/cases/${invoice.case_id}`, tone: invoice.due_date < todayIso ? "red" : "amber", kind: "sales_invoice_due" });
    }
    for (const invoice of (supplierRes.data || []) as SupplierInvoice[]) {
      const left = Number(invoice.gross_total || 0) - Number(invoice.paid_amount || 0);
      if (!invoice.due_date || left <= 0) continue;
      business.push({ id: `${invoice.id}-supplier`, date: invoice.due_date, title: `Faktura kosztowa: ${invoice.supplier_name}`, subtitle: `${invoice.category}${invoice.invoice_number ? ` · ${invoice.invoice_number}` : ""}`, href: "/reports/profitability", tone: invoice.due_date < todayIso ? "red" : "amber", kind: "supplier_due" });
    }
    for (const subcontractor of (subcontractorRes.data || []) as CaseSubcontractor[]) {
      const dates = [
        { key: "start", date: subcontractor.start_date, title: "Start prac podwykonawcy" },
        { key: "end", date: subcontractor.end_date, title: "Koniec prac podwykonawcy" }
      ];
      for (const item of dates) {
        if (!item.date || item.date < isoOf(rangeStart) || item.date > isoOf(rangeEnd)) continue;
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
        if (!item.date || item.date < isoOf(rangeStart) || item.date > isoOf(rangeEnd)) continue;
        business.push({ id: `${vehicle.id}-${item.key}`, date: item.date, title: item.title, subtitle: vehicle.registration_number || vehicle.make_model || "Samochód", href: `/vehicles/${vehicle.id}`, tone: item.date < todayIso ? "red" : "amber", kind: "vehicle" });
      }
    }
    for (const policy of (policyRes.data || []) as CompanyPolicy[]) {
      const dates = [
        { key: "coverage", date: policy.coverage_end, title: `Polisa wygasa: ${policy.policy_type}` },
        { key: "payment", date: policy.payment_due, title: `Płatność polisy: ${policy.policy_type}` }
      ];
      for (const item of dates) {
        if (!item.date || item.date < isoOf(rangeStart) || item.date > isoOf(rangeEnd)) continue;
        business.push({ id: `${policy.id}-${item.key}`, date: item.date, title: item.title, subtitle: policy.insurer || policy.policy_number || "Polisa firmowa", href: "/policies", tone: item.date < todayIso ? "red" : "amber", kind: "policy" });
      }
    }
    setBusinessItems(business.sort((a, b) => a.date.localeCompare(b.date)));

    const caseIds = Array.from(new Set(loaded.map((t) => t.case_id).filter(Boolean))) as string[];
    if (caseIds.length > 0) {
      const { data: cs } = await supabase
        .from("cases")
        .select("id,client_name,location")
        .in("id", caseIds);
      const map: Record<string, string> = {};
      for (const c of (cs || []) as CaseRow[]) {
        map[c.id] = `${c.client_name}${c.location ? ` — ${c.location}` : ""}`;
      }
      setCaseLabels(map);
    } else {
      setCaseLabels({});
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, cursor, canSeeHr, canSeeBusinessSensitive, todayIso]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const map: Record<string, CaseTask[]> = {};
    for (const t of tasks) {
      if (!t.due_date) continue;
      (map[t.due_date] ??= []).push(t);
    }
    return map;
  }, [tasks]);

  const hrByDay = useMemo(() => {
    const map: Record<string, CalendarHrItem[]> = {};
    for (const document of hrItems) {
      if (!document.valid_until) continue;
      (map[document.valid_until] ??= []).push(document);
    }
    return map;
  }, [hrItems]);
  const businessByDay = useMemo(() => {
    const map: Record<string, CalendarBusinessItem[]> = {};
    for (const item of businessItems) {
      (map[item.date] ??= []).push(item);
    }
    return map;
  }, [businessItems]);

  const isOverdue = (t: CaseTask) => !!t.due_date && t.due_date < todayIso && t.status !== "zrobione" && t.status !== "anulowane";

  const goMonth = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const goToday = () => {
    setCursor({ year: today.getFullYear(), month: today.getMonth() });
    setSelected(todayIso);
  };

  const selectedTasks = byDay[selected] || [];
  const selectedHr = hrByDay[selected] || [];
  const selectedBusiness = businessByDay[selected] || [];

  if (!organizationId) return null;

  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid gap-3 sm:flex sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Kalendarz</p>
          <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">Kalendarz firmy</h1>
          <p className="mt-1 text-sm text-steel">Zadania oraz terminy BHP, badań, szkoleń i uprawnień. Kliknij dzień, aby zobaczyć szczegóły.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => goMonth(-1)} aria-label="Poprzedni miesiąc" className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-stone-50">
            ←
          </button>
          <span className="min-w-[150px] text-center text-sm font-bold text-ink">
            {MONTHS[cursor.month]} {cursor.year}
          </span>
          <button type="button" onClick={() => goMonth(1)} aria-label="Następny miesiąc" className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-stone-50">
            →
          </button>
          <button type="button" onClick={goToday} className="rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-moss">
            Dziś
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1 sm:w-fit sm:grid-cols-4">
        {([['all','Wszystko'],['tasks','Zadania'],['business','Terminy'],['hr','Kadry']] as [CalendarFilter,string][]).map(([id,label]) => (
          <button key={id} type="button" disabled={id === "hr" && !canSeeHr} onClick={() => setFilter(id)} className={`rounded-md px-3 py-2 text-xs font-semibold sm:text-sm ${filter === id ? "bg-white text-ink shadow-sm" : "text-steel hover:text-ink disabled:opacity-40"}`}>{label}</button>
        ))}
      </div>

      <section className="rounded-xl2 border border-stone-200/80 bg-white p-3 shadow-card sm:p-4">
        <div className="grid grid-cols-7 gap-1 text-center text-[0.7rem] font-semibold uppercase tracking-wide text-steel sm:text-xs">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1">{d}</div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {grid.map((d) => {
            const iso = isoOf(d);
            const inMonth = d.getMonth() === cursor.month;
            const dayTasks = byDay[iso] || [];
            const dayHr = hrByDay[iso] || [];
            const dayBusiness = businessByDay[iso] || [];
            const visibleTasks = filter === "hr" || filter === "business" ? [] : dayTasks;
            const visibleHr = filter === "tasks" || filter === "business" ? [] : dayHr;
            const visibleBusiness = filter === "tasks" || filter === "hr" ? [] : dayBusiness;
            const eventCount = visibleTasks.length + visibleHr.length + visibleBusiness.length;
            const isToday = iso === todayIso;
            const isSelected = iso === selected;
            const hasOverdue = dayTasks.some(isOverdue);
            const hasHrOverdue = dayHr.some((document) => !!document.valid_until && document.valid_until < todayIso);
            const hasBusinessOverdue = dayBusiness.some((item) => item.date < todayIso && (item.tone === "red" || item.tone === "amber"));
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setSelected(iso)}
                aria-label={`${formatDate(iso)} — ${eventCount} terminów`}
                aria-current={isToday ? "date" : undefined}
                className={`flex min-h-[58px] flex-col rounded-lg border p-1 text-left transition sm:min-h-[92px] sm:p-1.5 ${
                  isSelected ? "border-moss ring-2 ring-moss/40" : "border-stone-200 hover:border-moss/50"
                } ${inMonth ? "bg-white" : "bg-stone-50/70"}`}
              >
                <span className={`flex items-center justify-between text-xs font-semibold ${inMonth ? "text-ink" : "text-stone-400"}`}>
                  <span className={isToday ? "flex size-5 items-center justify-center rounded-full bg-ink text-[0.7rem] text-white" : ""}>{d.getDate()}</span>
                  {eventCount > 0 && (
                    <span className={`text-[0.65rem] font-bold ${hasOverdue || hasHrOverdue || hasBusinessOverdue ? "text-red-600" : "text-moss"}`}>{eventCount}</span>
                  )}
                </span>
                {/* Desktop: chipsy zadań */}
                <span className="mt-1 hidden flex-col gap-0.5 sm:flex">
                  {visibleTasks.slice(0, 2).map((t) => (
                    <span
                      key={t.id}
                      className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[0.65rem] ${
                        isOverdue(t) ? "bg-red-50 text-red-700" : "bg-stone-100 text-ink"
                      } ${t.status === "zrobione" ? "line-through opacity-60" : ""}`}
                    >
                      <span className={`size-1.5 shrink-0 rounded-full ${PRIORITY_DOT[t.priority]}`} aria-hidden />
                      <span className="truncate">{t.title}</span>
                    </span>
                  ))}
                  {visibleHr.slice(0, Math.max(0, 3 - visibleTasks.length)).map((document) => (
                    <span key={document.id} className="flex items-center gap-1 truncate rounded bg-amber-50 px-1 py-0.5 text-[0.65rem] text-amber-800"><span className="size-1.5 shrink-0 rounded-full bg-amber-500" /><span className="truncate">{employeeLabels[document.employee_id] || "Pracownik"}: {document.title}</span></span>
                  ))}
                  {visibleBusiness.slice(0, Math.max(0, 3 - visibleTasks.length - visibleHr.length)).map((item) => (
                    <span key={item.id} className="flex items-center gap-1 truncate rounded bg-sky-50 px-1 py-0.5 text-[0.65rem] text-sky-800"><span className="size-1.5 shrink-0 rounded-full bg-sky-500" /><span className="truncate">{item.title}</span></span>
                  ))}
                  {eventCount > 3 && <span className="px-1 text-[0.6rem] text-steel">+{eventCount - 3} więcej</span>}
                </span>
                {/* Mobile: kropki */}
                {eventCount > 0 && (
                  <span className="mt-auto flex gap-0.5 sm:hidden" aria-hidden>
                    {visibleTasks.slice(0, 3).map((t) => (
                      <span key={t.id} className={`size-1.5 rounded-full ${isOverdue(t) ? "bg-red-500" : PRIORITY_DOT[t.priority]}`} />
                    ))}
                    {visibleHr.slice(0, Math.max(0, 4 - visibleTasks.length)).map((document) => <span key={document.id} className="size-1.5 rounded-full bg-amber-500" />)}
                    {visibleBusiness.slice(0, Math.max(0, 4 - visibleTasks.length - visibleHr.length)).map((item) => <span key={item.id} className="size-1.5 rounded-full bg-sky-500" />)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-base font-bold text-ink sm:text-lg">Terminy: {formatDate(selected)}</h2>
        {loading ? (
          <p className="mt-3 text-sm text-steel">Wczytywanie…</p>
        ) : (filter === "hr" ? selectedHr.length === 0 : filter === "tasks" ? selectedTasks.length === 0 : filter === "business" ? selectedBusiness.length === 0 : selectedTasks.length + selectedHr.length + selectedBusiness.length === 0) ? (
          <p className="mt-3 rounded-xl2 border border-dashed border-stone-300 p-5 text-center text-sm text-steel">Brak terminów na ten dzień.</p>
        ) : (
          <ul className="mt-3 grid gap-2.5 text-sm">
            {filter !== "hr" && selectedTasks.map((t) => {
              const overdue = isOverdue(t);
              const href = t.case_id ? `/cases/${t.case_id}` : "/tasks";
              const caseLabel = t.case_id ? caseLabels[t.case_id] || "Karta zlecenia" : "Zadania";
              return (
                <li key={t.id}>
                  <Link
                    href={href}
                    className={`relative flex flex-wrap items-center justify-between gap-2 rounded-xl2 border p-3.5 pl-4 shadow-card transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                      t.status === "zrobione"
                        ? "border-emerald-200 bg-emerald-50/40 hover:border-emerald-300"
                        : overdue
                          ? "border-red-200 bg-red-50/50 hover:border-red-300"
                          : "border-stone-200 bg-white hover:border-moss/40"
                    }`}
                  >
                    <span className={`absolute inset-y-0 left-0 w-1.5 rounded-l-xl2 ${PRIORITY_DOT[t.priority]}`} aria-hidden />
                    <div className="min-w-0">
                      <p className={`font-semibold text-ink ${t.status === "zrobione" ? "line-through opacity-70" : ""}`}>{t.title}</p>
                      <p className="mt-0.5 text-xs text-steel">
                        priorytet: {t.priority} · status: {t.status}
                        {overdue ? " · po terminie" : ""}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-lg border border-stone-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-moss">
                      {caseLabel} →
                    </span>
                  </Link>
                </li>
              );
            })}
            {filter !== "tasks" && selectedHr.map((document) => {
              const body = (
                <>
                  <span className="absolute inset-y-0 left-0 w-1.5 rounded-l-xl2 bg-amber-500" aria-hidden />
                  <div className="min-w-0"><p className="font-semibold text-ink">{document.title}</p><p className="mt-0.5 text-xs text-steel">{employeeLabels[document.employee_id] || "Pracownik"} · {EMPLOYEE_DOCUMENT_TYPE_LABELS[document.document_type]} · {documentExpiryLabel(document, todayIso)}</p></div>
                </>
              );
              // Karta HR (`/hr`) jest dostępna tylko dla ról zarządczych — dla brygadzisty/
              // pracownika pokazujemy sam termin, bez linku do modułu, do którego nie mają dostępu.
              return (
                <li key={document.id}>
                  {canManageOrg(role) ? (
                    <Link href={`/hr?employee=${document.employee_id}`} className="relative flex flex-wrap items-center justify-between gap-2 rounded-xl2 border border-amber-200 bg-amber-50/50 p-3.5 pl-4 shadow-card transition hover:border-amber-300 hover:shadow-md">
                      {body}
                      <span className="shrink-0 rounded-lg border border-amber-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-amber-800">Karta HR →</span>
                    </Link>
                  ) : (
                    <div className="relative flex flex-wrap items-center justify-between gap-2 rounded-xl2 border border-amber-200 bg-amber-50/50 p-3.5 pl-4 shadow-card">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
            {filter !== "tasks" && filter !== "hr" && selectedBusiness.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className={`relative flex flex-wrap items-center justify-between gap-2 rounded-xl2 border p-3.5 pl-4 shadow-card transition hover:shadow-md ${item.tone === "red" ? "border-red-200 bg-red-50/50 hover:border-red-300" : item.tone === "amber" ? "border-amber-200 bg-amber-50/50 hover:border-amber-300" : "border-sky-200 bg-sky-50/50 hover:border-sky-300"}`}>
                  <span className={`absolute inset-y-0 left-0 w-1.5 rounded-l-xl2 ${item.tone === "red" ? "bg-red-500" : item.tone === "amber" ? "bg-amber-500" : "bg-sky-500"}`} aria-hidden />
                  <div className="min-w-0"><p className="font-semibold text-ink">{item.title}</p><p className="mt-0.5 text-xs text-steel">{item.subtitle}</p></div>
                  <span className="shrink-0 rounded-lg border border-stone-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-moss">Otwórz →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
