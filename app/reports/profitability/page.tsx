"use client";

import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { DateInput } from "@/components/date-input";
import { InfoTip } from "@/components/info-tip";
import { canSeeFinances, canViewPayroll, useOrg } from "@/components/org-context";
import { showToast } from "@/components/toast";
import { downloadAuthenticatedPdf } from "@/lib/download-authenticated-pdf";
import { postAuthenticatedForm, postAuthenticatedJson } from "@/lib/authed-fetch";
import { notify } from "@/lib/notify-client";
import { downloadXlsx } from "@/lib/xlsx-export";
import { buildProfitabilitySummary, type CaseProfitabilityRow, type ProfitabilityAlertSeverity } from "@/lib/profitability-report";
import type { ImportSource, SupplierInvoiceImportPreviewRow } from "@/lib/supplier-invoice-import";
import { currency, formatDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { warsawTodayIso } from "@/lib/warsaw-today";
import type {
  CaseDirectCost,
  CaseDirectCostType,
  CaseProfitabilityPlan,
  CaseRow,
  CaseSubcontractor,
  AggregatedLaborCost,
  Invoice,
  Payment,
  Subcontractor,
  SubcontractorSettlementEntry,
  SubcontractorSettlementEntryType,
  SupplierInvoice,
  SupplierInvoiceCategory,
  SupplierInvoiceStatus,
} from "@/lib/types";

const INVOICE_CATEGORIES: { id: SupplierInvoiceCategory; label: string }[] = [
  { id: "materialy", label: "Materiały" },
  { id: "robocizna", label: "Robocizna / usługi" },
  { id: "sprzet", label: "Sprzęt" },
  { id: "transport", label: "Transport" },
  { id: "podwykonawca", label: "Podwykonawca" },
  { id: "inne", label: "Inne" }
];

const SUB_ENTRY_TYPES: { id: SubcontractorSettlementEntryType; label: string }[] = [
  { id: "zaliczka", label: "Zaliczka" },
  { id: "wyplata", label: "Wypłata" },
  { id: "rozliczenie_koncowe", label: "Rozliczenie końcowe" },
  { id: "dopłata", label: "Dopłata" },
  { id: "potracenie", label: "Potrącenie" },
  { id: "korekta", label: "Korekta" }
];

const DIRECT_COST_TYPES: { id: CaseDirectCostType; label: string }[] = [
  { id: "materialy", label: "Materiały" },
  { id: "robocizna", label: "Robocizna" },
  { id: "podwykonawcy", label: "Podwykonawcy" },
  { id: "transport", label: "Transport" },
  { id: "sprzet", label: "Sprzęt" },
  { id: "inne", label: "Inne" }
];

const PROFITABILITY_HELP = {
  revenuePlanned: "Łączna wartość umowna lub planowana. System bierze plan przychodu, a gdy go brak: harmonogram płatności albo szacowaną wartość zlecenia.",
  revenueInvoiced: "Suma brutto wystawionych faktur sprzedażowych, bez szkiców i faktur anulowanych.",
  revenueDue: "Kwota, która stała się należnością: z wystawionych faktur, a przy ich braku z harmonogramu płatności. Sama wycena nie jest należnością.",
  revenuePaid: "Suma wpłat zapisanych na fakturach sprzedażowych, a przy ich braku w harmonogramie płatności.",
  totalCost: "Faktury kosztowe, robocizna, rozliczenia pracowników i podwykonawców oraz koszty bezpośrednie. Jawnie powiązane dokumenty nie są liczone podwójnie.",
  profit: "Wartość umowna lub planowana minus wszystkie zarejestrowane koszty. To wynik operacyjny zleceń, nie księgowy wynik netto firmy.",
  forecastProfit: "Przewidywany wynik końcowy: wartość umowna minus prognozowany koszt końcowy wyliczony z budżetu, postępu i kosztów wykonanych.",
  marginPct: "Wynik na wartości umownej podzielony przez wartość umowną, pomnożony przez 100%.",
  forecastMarginPct: "Prognozowany zysk podzielony przez wartość umowną, pomnożony przez 100%.",
  unpaidRevenue: "Należności powstałe minus zapisane wpłaty. Obejmuje kwoty zarówno przed terminem, jak i po terminie.",
  overdueRevenue: "Niezapłacona część faktur lub harmonogramu, których termin płatności już minął.",
  costUnpaid: "Nieopłacona część faktur kosztowych. Nie jest to pełna suma wszystkich przyszłych wypłat pracowniczych i zobowiązań firmy.",
  lossMakers: "Liczba zleceń, w których zarejestrowane koszty są wyższe od wartości umownej lub planowanej.",
  monthly: "Trend operacyjny według dat faktur, pracy, kosztów, rozliczeń i wpłat. Nie jest księgowym rachunkiem przepływów pieniężnych.",
  costStructure: "Udział każdej kategorii w łącznych kosztach zarejestrowanych w analizowanych zleceniach.",
  plannedCost: "Suma zaplanowanych kosztów materiałów, pracy, podwykonawców, sprzętu, transportu, innych kosztów i bufora.",
  variance: "Koszt wykonany minus koszt planowany. Wartość dodatnia oznacza przekroczenie budżetu.",
  forecast: "Wartość umowna minus prognozowany koszt końcowy. Dokładność rośnie wraz z uzupełnieniem budżetu, postępu i rzeczywistych kosztów.",
  confidence: "Ocena jakości prognozy na podstawie dostępności planu, postępu prac i kosztów rzeczywistych.",
  progress: "Ręcznie aktualizowany procent wykonania budowy, używany do prognozy kosztu końcowego."
} as const;

function parseAmount(value: string): number {
  const n = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function statusFromAmounts(gross: number, paid: number): SupplierInvoiceStatus {
  if (paid >= gross && gross > 0) return "oplacona";
  if (paid > 0) return "czesciowo";
  return "nieoplacona";
}

function shouldAlertAmount(amount: number): boolean {
  return amount >= 2000;
}

export default function ProfitabilityPage() {
  return (
    <AuthGate>
      {(session) => (
        <AppShell>
          <ProfitabilityInner userId={session.user.id} />
        </AppShell>
      )}
    </AuthGate>
  );
}

function ProfitabilityInner({ userId }: { userId: string }) {
  const { organizationId, role } = useOrg();
  const canUse = canSeeFinances(role);
  const showPayroll = canViewPayroll(role);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [aggregatedLaborCosts, setAggregatedLaborCosts] = useState<AggregatedLaborCost[]>([]);
  const [supplierInvoices, setSupplierInvoices] = useState<SupplierInvoice[]>([]);
  const [salesInvoices, setSalesInvoices] = useState<Invoice[]>([]);
  const [profitabilityPlans, setProfitabilityPlans] = useState<CaseProfitabilityPlan[]>([]);
  const [caseSubcontractors, setCaseSubcontractors] = useState<CaseSubcontractor[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [subEntries, setSubEntries] = useState<SubcontractorSettlementEntry[]>([]);
  const [directCosts, setDirectCosts] = useState<CaseDirectCost[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [sendingSupplierId, setSendingSupplierId] = useState<string | null>(null);

  const [invoiceForm, setInvoiceForm] = useState({
    case_id: "",
    supplier_name: "",
    invoice_number: "",
    invoice_date: warsawTodayIso(),
    due_date: "",
    category: "materialy" as SupplierInvoiceCategory,
    net_total: "",
    gross_total: "",
    paid_amount: "",
    notes: "",
    subcontractor_id: "",
    linked_settlement_entry_id: ""
  });
  const [subEntryForm, setSubEntryForm] = useState({
    subcontractor_id: "",
    case_id: "",
    entry_type: "zaliczka" as SubcontractorSettlementEntryType,
    amount: "",
    entry_date: warsawTodayIso(),
    title: "",
    notes: ""
  });
  const [directCostForm, setDirectCostForm] = useState({
    case_id: "",
    cost_type: "inne" as CaseDirectCostType,
    title: "",
    amount: "",
    cost_date: warsawTodayIso(),
    notes: ""
  });
  const [planForm, setPlanForm] = useState({
    case_id: "",
    planned_revenue: "",
    planned_material_cost: "",
    planned_labor_cost: "",
    planned_subcontractor_cost: "",
    planned_equipment_cost: "",
    planned_transport_cost: "",
    planned_other_cost: "",
    contingency_pct: "8",
    progress_pct: "0",
    notes: ""
  });
  const [importRows, setImportRows] = useState<SupplierInvoiceImportPreviewRow[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importMeta, setImportMeta] = useState<{ source: ImportSource; fileName: string } | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !canUse) return;
    setLoading(true);
    setLoadError("");
    const [caseRes, paymentRes, salesInvoiceRes, laborRes, invoiceRes, planRes, caseSubRes, subRes, subEntryRes, costRes] = await Promise.all([
      supabase.from("case_records").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      supabase.from("payments").select("*").eq("organization_id", organizationId),
      supabase.from("invoices").select("*").eq("organization_id", organizationId),
      supabase.rpc("payroll_labor_costs_aggregated", { target_org: organizationId }),
      supabase.from("supplier_invoices").select("*").eq("organization_id", organizationId).order("invoice_date", { ascending: false }),
      supabase.from("case_profitability_plans").select("*").eq("organization_id", organizationId),
      supabase.from("case_subcontractors").select("*").eq("organization_id", organizationId),
      supabase.from("subcontractors").select("*").eq("organization_id", organizationId).order("name"),
      supabase.from("subcontractor_settlement_entries").select("*").eq("organization_id", organizationId).order("entry_date", { ascending: false }),
      supabase.from("case_direct_costs").select("*").eq("organization_id", organizationId).order("cost_date", { ascending: false })
    ]);

    if (laborRes.error || invoiceRes.error) {
      const err = laborRes.error || invoiceRes.error;
      const missing = err?.message.includes("payroll_labor_costs_aggregated") || err?.message.includes("supplier_invoices") || err?.code === "42P01";
      setLoadError(missing ? "Brakuje tabel finansów. Uruchom migrację 0035_org_profitability_settlements.sql." : err?.message || "");
    }

    setCases((caseRes.data || []) as CaseRow[]);
    setPayments((paymentRes.data || []) as Payment[]);
    setSalesInvoices((salesInvoiceRes.data || []) as Invoice[]);
    setAggregatedLaborCosts((laborRes.data || []) as AggregatedLaborCost[]);
    setSupplierInvoices((invoiceRes.data || []) as SupplierInvoice[]);
    setProfitabilityPlans((planRes.data || []) as CaseProfitabilityPlan[]);
    setCaseSubcontractors((caseSubRes.data || []) as CaseSubcontractor[]);
    setSubcontractors((subRes.data || []) as Subcontractor[]);
    setSubEntries((subEntryRes.data || []) as SubcontractorSettlementEntry[]);
    setDirectCosts((costRes.data || []) as CaseDirectCost[]);
    setLoading(false);
  }, [organizationId, canUse]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(
    () =>
      buildProfitabilitySummary({
        cases,
        payments,
        salesInvoices,
        workHours: [],
        employees: [],
        employeeEntries: [],
        pieceworkEntries: [],
        employeeMonthlySettlements: [],
        supplierInvoices,
        profitabilityPlans,
        caseSubcontractors,
        subcontractorEntries: subEntries,
        directCosts,
        aggregatedLaborCosts
      }),
    [cases, payments, salesInvoices, supplierInvoices, profitabilityPlans, caseSubcontractors, subEntries, directCosts, aggregatedLaborCosts]
  );

  const caseOptions = cases.map((c) => ({ id: c.id, label: `${c.client_name}${c.location ? ` - ${c.location}` : ""}` }));
  const subById = new Map(subcontractors.map((s) => [s.id, s]));
  const settlementLinkOptions = subEntries.filter(
    (entry) =>
      entry.case_id === (invoiceForm.case_id || null) &&
      entry.subcontractor_id === (invoiceForm.subcontractor_id || null) &&
      !supplierInvoices.some((invoice) => invoice.linked_settlement_entry_id === entry.id)
  );

  const saveInvoice = async () => {
    if (!organizationId || !invoiceForm.supplier_name.trim()) {
      showToast("Podaj hurtownię / dostawcę.", "error");
      return;
    }
    const gross = parseAmount(invoiceForm.gross_total);
    const paid = parseAmount(invoiceForm.paid_amount);
    const { error } = await supabase.from("supplier_invoices").insert({
      organization_id: organizationId,
      case_id: invoiceForm.case_id || null,
      supplier_name: invoiceForm.supplier_name.trim(),
      invoice_number: invoiceForm.invoice_number.trim() || null,
      invoice_date: invoiceForm.invoice_date,
      due_date: invoiceForm.due_date || null,
      category: invoiceForm.category,
      net_total: invoiceForm.net_total.trim() ? parseAmount(invoiceForm.net_total) : null,
      gross_total: gross,
      paid_amount: paid,
      status: statusFromAmounts(gross, paid),
      notes: invoiceForm.notes.trim() || null,
      subcontractor_id: invoiceForm.category === "podwykonawca" ? invoiceForm.subcontractor_id || null : null,
      linked_settlement_entry_id: invoiceForm.category === "podwykonawca" ? invoiceForm.linked_settlement_entry_id || null : null,
      created_by: userId
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Faktura kosztowa dodana");
    if (shouldAlertAmount(gross) || paid < gross) {
      void notify({
        type: "financial_alert",
        organizationId,
        title: paid < gross ? "Nowa nieopłacona faktura kosztowa" : "Nowa duża faktura kosztowa",
        body: `${invoiceForm.supplier_name.trim()}: ${currency.format(gross)}${invoiceForm.case_id ? " przypisane do budowy" : " bez przypisania do budowy"}`,
        href: invoiceForm.case_id ? `/cases/${invoiceForm.case_id}` : "/reports/profitability"
      });
    }
    setInvoiceForm((f) => ({ ...f, supplier_name: "", invoice_number: "", net_total: "", gross_total: "", paid_amount: "", notes: "", subcontractor_id: "", linked_settlement_entry_id: "" }));
    await load();
  };

  const previewInvoiceImport = async (file: File | null) => {
    if (!organizationId || !file) return;
    setImportBusy(true);
    const form = new FormData();
    form.append("organizationId", organizationId);
    form.append("file", file);
    const result = await postAuthenticatedForm<{ source: ImportSource; fileName: string; rows: SupplierInvoiceImportPreviewRow[] }>("/api/reports/profitability/import", form);
    setImportBusy(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    setImportRows(result.data.rows);
    setImportMeta({ source: result.data.source, fileName: result.data.fileName });
    showToast(`Odczytano pozycje: ${result.data.rows.length}`);
  };

  const updateImportRow = (rowId: string, patch: Partial<SupplierInvoiceImportPreviewRow>) => {
    setImportRows((rows) => rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  };

  const commitInvoiceImport = async () => {
    if (!organizationId || !importMeta || importRows.length === 0) return;
    const rows = importRows.filter((row) => !row.duplicate && row.gross_total > 0);
    if (rows.length === 0) {
      showToast("Brak nowych faktur do zapisania.", "error");
      return;
    }
    setImportBusy(true);
    const result = await postAuthenticatedJson<{ inserted: number; duplicateCount: number }>("/api/reports/profitability/import", {
      organizationId,
      source: importMeta.source,
      fileName: importMeta.fileName,
      rows
    });
    setImportBusy(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    showToast(`Zaimportowano faktury: ${result.data.inserted}`);
    setImportRows([]);
    setImportMeta(null);
    await load();
  };

  const sendSupplierInvoice = async (invoice: SupplierInvoice) => {
    if (!invoice.case_id) {
      showToast("Najpierw przypisz fakturę do zlecenia, aby wysłać ją z pełnym kontekstem do księgowej.", "error");
      return;
    }
    setSendingSupplierId(invoice.id);
    const result = await postAuthenticatedJson(`/api/cases/${invoice.case_id}/supplier-invoices/${invoice.id}/send`, {});
    setSendingSupplierId(null);
    if (!result.ok) showToast(result.error || "Nie udało się wysłać faktury.", "error");
    else {
      showToast("Wysłano fakturę kosztową do księgowej");
      await load();
    }
  };

  const saveSubEntry = async () => {
    if (!organizationId || !subEntryForm.subcontractor_id || !subEntryForm.amount.trim()) {
      showToast("Wybierz podwykonawcę i kwotę.", "error");
      return;
    }
    const { error } = await supabase.from("subcontractor_settlement_entries").insert({
      organization_id: organizationId,
      subcontractor_id: subEntryForm.subcontractor_id,
      case_id: subEntryForm.case_id || null,
      entry_type: subEntryForm.entry_type,
      amount: parseAmount(subEntryForm.amount),
      entry_date: subEntryForm.entry_date,
      title: subEntryForm.title.trim() || subEntryForm.entry_type,
      notes: subEntryForm.notes.trim() || null,
      created_by: userId
    });
    if (error) showToast(error.message, "error");
    else {
      showToast("Rozliczenie podwykonawcy dodane");
      const amount = parseAmount(subEntryForm.amount);
      if (shouldAlertAmount(amount) && organizationId) {
        const sub = subcontractors.find((s) => s.id === subEntryForm.subcontractor_id);
        void notify({
          type: "financial_alert",
          organizationId,
          title: "Duże rozliczenie podwykonawcy",
          body: `${sub?.name || "Podwykonawca"}: ${currency.format(amount)} · ${subEntryForm.entry_type}`,
          href: subEntryForm.case_id ? `/cases/${subEntryForm.case_id}` : "/reports/profitability"
        });
      }
      setSubEntryForm((f) => ({ ...f, amount: "", title: "", notes: "" }));
      await load();
    }
  };

  const saveDirectCost = async () => {
    if (!organizationId || !directCostForm.case_id || !directCostForm.title.trim() || !directCostForm.amount.trim()) {
      showToast("Wybierz sprawę, nazwę kosztu i kwotę.", "error");
      return;
    }
    const { error } = await supabase.from("case_direct_costs").insert({
      organization_id: organizationId,
      case_id: directCostForm.case_id,
      cost_type: directCostForm.cost_type,
      title: directCostForm.title.trim(),
      amount: parseAmount(directCostForm.amount),
      cost_date: directCostForm.cost_date,
      notes: directCostForm.notes.trim() || null,
      created_by: userId
    });
    if (error) showToast(error.message, "error");
    else {
      showToast("Koszt budowy dodany");
      const amount = parseAmount(directCostForm.amount);
      if (shouldAlertAmount(amount)) {
        void notify({
          type: "financial_alert",
          organizationId,
          title: "Nowy duży koszt budowy",
          body: `${directCostForm.title.trim()}: ${currency.format(amount)} · ${directCostForm.cost_type}`,
          href: `/cases/${directCostForm.case_id}`,
          entityId: directCostForm.case_id
        });
      }
      setDirectCostForm((f) => ({ ...f, title: "", amount: "", notes: "" }));
      await load();
    }
  };

  const loadPlanToForm = (caseId: string) => {
    const plan = profitabilityPlans.find((p) => p.case_id === caseId);
    const selectedCase = cases.find((c) => c.id === caseId);
    setPlanForm({
      case_id: caseId,
      planned_revenue: String(plan?.planned_revenue ?? selectedCase?.estimated_value ?? ""),
      planned_material_cost: String(plan?.planned_material_cost ?? ""),
      planned_labor_cost: String(plan?.planned_labor_cost ?? ""),
      planned_subcontractor_cost: String(plan?.planned_subcontractor_cost ?? ""),
      planned_equipment_cost: String(plan?.planned_equipment_cost ?? ""),
      planned_transport_cost: String(plan?.planned_transport_cost ?? ""),
      planned_other_cost: String(plan?.planned_other_cost ?? ""),
      contingency_pct: String(plan?.contingency_pct ?? 8),
      progress_pct: String(plan?.progress_pct ?? 0),
      notes: plan?.notes || ""
    });
  };

  const saveProfitabilityPlan = async () => {
    if (!organizationId || !planForm.case_id) {
      showToast("Wybierz budowę do planu rentowności.", "error");
      return;
    }
    const payload = {
      organization_id: organizationId,
      case_id: planForm.case_id,
      planned_revenue: parseAmount(planForm.planned_revenue),
      planned_material_cost: parseAmount(planForm.planned_material_cost),
      planned_labor_cost: parseAmount(planForm.planned_labor_cost),
      planned_subcontractor_cost: parseAmount(planForm.planned_subcontractor_cost),
      planned_equipment_cost: parseAmount(planForm.planned_equipment_cost),
      planned_transport_cost: parseAmount(planForm.planned_transport_cost),
      planned_other_cost: parseAmount(planForm.planned_other_cost),
      contingency_pct: Math.min(100, Math.max(0, parseAmount(planForm.contingency_pct))),
      progress_pct: Math.min(100, Math.max(0, parseAmount(planForm.progress_pct))),
      notes: planForm.notes.trim() || null,
      created_by: userId
    };
    const { error } = await supabase
      .from("case_profitability_plans")
      .upsert(payload, { onConflict: "organization_id,case_id" });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Plan rentowności zapisany");
    await load();
  };

  const exportXlsx = async () => {
    await downloadXlsx(`golbud-rentownosc-budow-${warsawTodayIso()}.xlsx`, [
      {
        name: "Rentowność",
        title: "Rentowność budów",
        subtitle: "Przychód, koszty, zysk i marża według spraw",
        totalsLabel: "RAZEM",
        columns: [
          { header: "Klient", type: "text" },
          { header: "Lokalizacja", type: "text" },
          { header: "Status", type: "text" },
          { header: "Przychód planowany", type: "currency", total: true },
          { header: "Wpłacone", type: "currency", total: true },
          { header: "Materiały", type: "currency", total: true },
          { header: "Robocizna", type: "currency", total: true },
          { header: "Podwykonawcy", type: "currency", total: true },
          { header: "Sprzęt", type: "currency", total: true },
          { header: "Transport", type: "currency", total: true },
          { header: "Inne", type: "currency", total: true },
          { header: "Koszt łącznie", type: "currency", total: true },
          { header: "Budżet kosztów", type: "currency", total: true },
          { header: "Odchylenie kosztów", type: "currency", total: true },
          { header: "Zysk", type: "currency", total: true },
          { header: "Prognoza zysku", type: "currency", total: true },
          { header: "Marża %", type: "number" },
          { header: "Prognozowana marża %", type: "number" },
          { header: "Do odzyskania", type: "currency", total: true }
        ],
        rows: summary.rows.map((r) => [
          r.clientName,
          r.location,
          r.status,
          r.revenuePlanned,
          r.revenuePaid,
          r.materialCost,
          r.laborCost,
          r.subcontractorCost,
          r.equipmentCost,
          r.transportCost,
          r.otherCost,
          r.totalCost,
          r.plannedCost,
          r.costVariance,
          r.profit,
          r.forecastProfit,
          Number(r.marginPct.toFixed(1)),
          Number(r.forecastMarginPct.toFixed(1)),
          r.unpaidRevenue
        ])
      },
      {
        name: "Faktury kosztowe",
        title: "Faktury hurtowni i koszty zewnętrzne",
        totalsLabel: "RAZEM",
        columns: [
          { header: "Dostawca", type: "text" },
          { header: "Numer", type: "text" },
          { header: "Data", type: "date" },
          { header: "Kategoria", type: "text" },
          { header: "Brutto", type: "currency", total: true },
          { header: "Zapłacono", type: "currency", total: true },
          { header: "Status", type: "text" },
          { header: "Uwagi", type: "text" }
        ],
        rows: supplierInvoices.map((i) => [
          i.supplier_name,
          i.invoice_number || "",
          i.invoice_date,
          i.category,
          Number(i.gross_total || 0),
          Number(i.paid_amount || 0),
          i.status,
          i.notes || ""
        ])
      }
    ]);
    showToast("Eksport rentowności pobrany");
  };

  const downloadPdf = async () => {
    if (!organizationId) return;
    setPdfBusy(true);
    const ok = await downloadAuthenticatedPdf(
      `/api/reports/profitability/pdf?organizationId=${encodeURIComponent(organizationId)}`,
      `golbud-raport-zarzadczy-rentownosc-${warsawTodayIso()}.pdf`
    );
    setPdfBusy(false);
    if (ok) showToast("Raport zarządczy PDF pobrany");
  };

  if (!organizationId) return null;
  if (!canUse) {
    return (
      <div className="rounded-lg bg-white p-6 shadow-panel">
        <h1 className="text-xl font-bold text-ink">Rentowność budów</h1>
        <p className="mt-2 text-sm text-steel">Ten widok zawiera koszty i zysk firmy, dlatego jest dostępny tylko dla ról zarządczych.</p>
      </div>
    );
  }

  const kpis = [
    { label: "Wartość umowna / plan", value: currency.format(summary.revenuePlanned), help: PROFITABILITY_HELP.revenuePlanned },
    { label: "Wystawione faktury", value: currency.format(summary.revenueInvoiced), help: PROFITABILITY_HELP.revenueInvoiced },
    { label: "Należności powstałe", value: currency.format(summary.revenueDue), help: PROFITABILITY_HELP.revenueDue },
    { label: "Wpłacone od klientów", value: currency.format(summary.revenuePaid), help: PROFITABILITY_HELP.revenuePaid },
    { label: "Koszty łącznie", value: currency.format(summary.totalCost), help: PROFITABILITY_HELP.totalCost },
    // Bez kosztów „wynik” to cały przychód, a „marża” to 100 % — takie liczby wprowadzają w błąd,
    // więc zamiast nich pokazujemy wprost, że danych brakuje.
    { label: "Wynik na wartości umownej", value: summary.costDataIncomplete ? "brak danych" : currency.format(summary.profit), help: PROFITABILITY_HELP.profit },
    { label: "Prognoza zysku", value: summary.costDataIncomplete ? "brak danych" : currency.format(summary.forecastProfit), help: PROFITABILITY_HELP.forecastProfit },
    { label: "Marża", value: summary.costDataIncomplete ? "brak danych" : `${summary.marginPct.toFixed(1)}%`, help: PROFITABILITY_HELP.marginPct },
    { label: "Marża prognozowana", value: summary.costDataIncomplete ? "brak danych" : `${summary.forecastMarginPct.toFixed(1)}%`, help: PROFITABILITY_HELP.forecastMarginPct },
    { label: "Otwarte należności", value: currency.format(summary.unpaidRevenue), help: PROFITABILITY_HELP.unpaidRevenue },
    { label: "Po terminie", value: currency.format(summary.overdueRevenue), help: PROFITABILITY_HELP.overdueRevenue },
    { label: "Niezapłacone koszty", value: currency.format(summary.costUnpaid), help: PROFITABILITY_HELP.costUnpaid },
    { label: "Budowy na minusie", value: String(summary.lossMakers.length), help: PROFITABILITY_HELP.lossMakers }
  ];

  return (
    <div className="grid min-w-0 gap-5">
      <div className="min-w-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <Link href="/reports" className="text-sm font-semibold text-moss hover:underline">← Raporty</Link>
            <p className="mt-3 text-sm font-semibold uppercase tracking-[0.18em] text-steel">Finanse budów</p>
            <h1 className="mt-2 break-words text-2xl font-bold text-ink sm:text-3xl">Rentowność budów i rozliczenia</h1>
            <p className="mt-1 max-w-3xl break-words text-sm leading-6 text-steel">
              Koszty materiałów, robocizny, podwykonawców i zysk przy każdej sprawie. To panel właściciela do pilnowania realnego zarobku firmy.
            </p>
          </div>
          <div className="grid gap-2 min-[420px]:grid-cols-2 lg:flex lg:flex-row">
            <button
              type="button"
              onClick={() => void downloadPdf()}
              disabled={loading || pdfBusy}
              className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:opacity-60"
            >
              {pdfBusy ? "Generowanie..." : "Raport PDF"}
            </button>
            <button
              type="button"
              onClick={() => void exportXlsx()}
              disabled={loading}
              className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-60"
            >
              Eksport Excel
            </button>
          </div>
        </div>
      </div>

      {loadError && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p>}

      {!loading && summary.costDataIncomplete && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Niepełne dane kosztowe</p>
          <p className="mt-0.5 leading-5">
            W wybranym okresie są przychody, ale nie ma żadnych kosztów — wynik i marża nie mają jeszcze sensu.
            Uzupełnij faktury kosztowe, robociznę i podwykonawców, a raport pokaże realną rentowność.
          </p>
        </div>
      )}

      <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="min-w-0 rounded-lg bg-white p-4 shadow-panel">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <p className="min-w-0 break-words text-xs leading-5 text-steel">{k.label}</p>
              <InfoTip text={k.help} />
            </div>
            <p className="mt-1 break-words text-xl font-bold text-ink">{k.value}</p>
          </div>
        ))}
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-ink">Alerty zarządcze</h2>
              <p className="break-words text-xs leading-5 text-steel">Najważniejsze miejsca, gdzie firma traci, za mało zarabia albo ma zamrożoną gotówkę.</p>
            </div>
            <p className="text-xs font-semibold text-steel">{summary.alerts.length} sygnałów</p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {summary.alerts.slice(0, 6).map((alert) => (
              <AlertCard key={alert.id} severity={alert.severity} title={alert.title} description={alert.description} caseId={alert.caseId} />
            ))}
            {!loading && summary.alerts.length === 0 && (
              <p className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-steel">Brak alertów. Po dodaniu przychodów i kosztów system pokaże ryzyka oraz najlepsze budowy.</p>
            )}
          </div>
        </div>

        <div className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
          <h2 className="text-lg font-bold text-ink">Gdzie ucieka kasa</h2>
          <p className="mt-1 break-words text-xs leading-5 text-steel">Krótka lista do decyzji: windykacja, korekta kosztów albo kontrola wyceny.</p>
          <div className="mt-4 grid gap-3">
            <MiniList title="Budowy na minusie" rows={summary.lossMakers} mode="profit" empty="Brak budów ze stratą." />
            <MiniList title="Największe zaległości klientów" rows={summary.unpaidRows} mode="unpaid" empty="Brak zaległości w harmonogramach." />
            <MiniList title="Materiały ponad normę" rows={summary.highMaterialRows} mode="materials" empty="Brak dużych odchyleń materiałowych." />
          </div>
        </div>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-2">
        <TrendChart rows={summary.monthly} />
        <CostStructureChart items={summary.costStructure} />
      </section>

      <section className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-4">
          <Panel title="Plan budżetu i postęp" hint="Plan kosztów, bufor i procent wykonania budowy do prognozy końcowego zysku.">
            <select className="input text-sm" value={planForm.case_id} onChange={(e) => loadPlanToForm(e.target.value)}>
              <option value="">wybierz budowę</option>
              {caseOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input text-sm" placeholder="Przychód planowany" inputMode="decimal" value={planForm.planned_revenue} onChange={(e) => setPlanForm((f) => ({ ...f, planned_revenue: e.target.value }))} />
              <input className="input text-sm" placeholder="Materiały plan" inputMode="decimal" value={planForm.planned_material_cost} onChange={(e) => setPlanForm((f) => ({ ...f, planned_material_cost: e.target.value }))} />
              <input className="input text-sm" placeholder="Robocizna plan" inputMode="decimal" value={planForm.planned_labor_cost} onChange={(e) => setPlanForm((f) => ({ ...f, planned_labor_cost: e.target.value }))} />
              <input className="input text-sm" placeholder="Podwykonawcy plan" inputMode="decimal" value={planForm.planned_subcontractor_cost} onChange={(e) => setPlanForm((f) => ({ ...f, planned_subcontractor_cost: e.target.value }))} />
              <input className="input text-sm" placeholder="Sprzęt plan" inputMode="decimal" value={planForm.planned_equipment_cost} onChange={(e) => setPlanForm((f) => ({ ...f, planned_equipment_cost: e.target.value }))} />
              <input className="input text-sm" placeholder="Transport plan" inputMode="decimal" value={planForm.planned_transport_cost} onChange={(e) => setPlanForm((f) => ({ ...f, planned_transport_cost: e.target.value }))} />
              <input className="input text-sm" placeholder="Inne koszty plan" inputMode="decimal" value={planForm.planned_other_cost} onChange={(e) => setPlanForm((f) => ({ ...f, planned_other_cost: e.target.value }))} />
              <input className="input text-sm" placeholder="Bufor %" inputMode="decimal" value={planForm.contingency_pct} onChange={(e) => setPlanForm((f) => ({ ...f, contingency_pct: e.target.value }))} />
            </div>
            <label className="grid gap-2 text-xs font-semibold text-steel">
              Postęp budowy: {parseAmount(planForm.progress_pct).toFixed(0)}%
              <input type="range" min="0" max="100" value={planForm.progress_pct} onChange={(e) => setPlanForm((f) => ({ ...f, progress_pct: e.target.value }))} />
            </label>
            <textarea className="input min-h-[64px] text-sm" placeholder="Notatka do planu" value={planForm.notes} onChange={(e) => setPlanForm((f) => ({ ...f, notes: e.target.value }))} />
            <button type="button" onClick={() => void saveProfitabilityPlan()} className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink">Zapisz plan</button>
          </Panel>

          <Panel title="Faktura hurtowni / kosztowa" hint="Materiały, sprzęt, transport i usługi przypisane do sprawy.">
            <SelectCase value={invoiceForm.case_id} cases={caseOptions} onChange={(v) => setInvoiceForm((f) => ({ ...f, case_id: v }))} />
            <input className="input text-sm" placeholder="Hurtownia / dostawca" value={invoiceForm.supplier_name} onChange={(e) => setInvoiceForm((f) => ({ ...f, supplier_name: e.target.value }))} />
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input text-sm" placeholder="Numer faktury" value={invoiceForm.invoice_number} onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_number: e.target.value }))} />
              <select className="input text-sm" value={invoiceForm.category} onChange={(e) => setInvoiceForm((f) => ({ ...f, category: e.target.value as SupplierInvoiceCategory }))}>
                {INVOICE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            {invoiceForm.category === "podwykonawca" ? (
              <div className="grid gap-2">
                <select className="input text-sm" value={invoiceForm.subcontractor_id} onChange={(e) => setInvoiceForm((f) => ({ ...f, subcontractor_id: e.target.value, linked_settlement_entry_id: "" }))}>
                  <option value="">wybierz podwykonawcę</option>
                  {subcontractors.map((subcontractor) => <option key={subcontractor.id} value={subcontractor.id}>{subcontractor.name}</option>)}
                </select>
                <label className="grid gap-1 text-xs font-semibold text-steel">
                  Czy faktura dokumentuje istniejące rozliczenie?
                  <select className="input text-sm font-normal" value={invoiceForm.linked_settlement_entry_id} onChange={(e) => setInvoiceForm((f) => ({ ...f, linked_settlement_entry_id: e.target.value }))}>
                    <option value="">Nie, to osobny koszt</option>
                    {settlementLinkOptions.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        Tak: {formatDate(entry.entry_date)} · {entry.entry_type} · {currency.format(Number(entry.amount))}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs leading-5 text-steel">Powiązane rozliczenie nie zostanie doliczone drugi raz. Bez jawnego powiązania system zachowa oba koszty.</p>
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <DateInput className="text-sm" value={invoiceForm.invoice_date} onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_date: e.target.value }))} />
              <DateInput className="text-sm" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm((f) => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="input text-sm" placeholder="Netto" inputMode="decimal" value={invoiceForm.net_total} onChange={(e) => setInvoiceForm((f) => ({ ...f, net_total: e.target.value }))} />
              <input className="input text-sm" placeholder="Brutto" inputMode="decimal" value={invoiceForm.gross_total} onChange={(e) => setInvoiceForm((f) => ({ ...f, gross_total: e.target.value }))} />
              <input className="input text-sm" placeholder="Zapłacono" inputMode="decimal" value={invoiceForm.paid_amount} onChange={(e) => setInvoiceForm((f) => ({ ...f, paid_amount: e.target.value }))} />
            </div>
            <textarea className="input min-h-[64px] text-sm" placeholder="Uwagi" value={invoiceForm.notes} onChange={(e) => setInvoiceForm((f) => ({ ...f, notes: e.target.value }))} />
            <button type="button" onClick={() => void saveInvoice()} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss">Dodaj fakturę</button>
          </Panel>

          <Panel title="Import CSV / XLSX / OCR" hint="Masowy import faktur z podglądem, wykrywaniem duplikatów i automatyczną kategorią kosztu.">
            <input
              className="input text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
              type="file"
              accept=".csv,.txt,.xlsx,.xls,.pdf,image/*"
              onChange={(e) => void previewInvoiceImport(e.target.files?.[0] || null)}
            />
            {importMeta && (
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-steel">
                <p className="font-semibold text-ink">{importMeta.fileName}</p>
                <p>Nowe: {importRows.filter((row) => !row.duplicate).length} · duplikaty: {importRows.filter((row) => row.duplicate).length}</p>
              </div>
            )}
            <button type="button" onClick={() => void commitInvoiceImport()} disabled={importBusy || importRows.filter((row) => !row.duplicate).length === 0} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50 disabled:opacity-50">
              {importBusy ? "Przetwarzanie..." : "Zapisz nowe faktury"}
            </button>
          </Panel>

          {showPayroll ? <Panel title="Rozliczenia pracowników" hint="Miesięczne karty, godziny, stawki, zaliczki, zatwierdzanie i eksport dla księgowości.">
            <p className="text-sm text-steel">Rozliczenia pracowników są prowadzone w osobnym module. Ich koszty nadal zasilają rentowność budów.</p>
            <Link href="/settlements/employees" className="rounded-lg bg-moss px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-ink">Otwórz rozliczenia pracowników</Link>
          </Panel> : null}

          <Panel title="Rozliczenie podwykonawcy" hint="Zaliczki i wypłaty ekip zewnętrznych.">
            <select className="input text-sm" value={subEntryForm.subcontractor_id} onChange={(e) => setSubEntryForm((f) => ({ ...f, subcontractor_id: e.target.value }))}>
              <option value="">wybierz podwykonawcę</option>
              {subcontractors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <SelectCase value={subEntryForm.case_id} cases={caseOptions} onChange={(v) => setSubEntryForm((f) => ({ ...f, case_id: v }))} />
            <div className="grid gap-2 sm:grid-cols-3">
              <select className="input text-sm" value={subEntryForm.entry_type} onChange={(e) => setSubEntryForm((f) => ({ ...f, entry_type: e.target.value as SubcontractorSettlementEntryType }))}>
                {SUB_ENTRY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <input className="input text-sm" placeholder="Kwota" inputMode="decimal" value={subEntryForm.amount} onChange={(e) => setSubEntryForm((f) => ({ ...f, amount: e.target.value }))} />
              <DateInput className="text-sm" value={subEntryForm.entry_date} onChange={(e) => setSubEntryForm((f) => ({ ...f, entry_date: e.target.value }))} />
            </div>
            <button type="button" onClick={() => void saveSubEntry()} className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink">Dodaj rozliczenie</button>
          </Panel>

          <Panel title="Koszt bezpośredni budowy" hint="Szybkie koszty bez faktury: paliwo, transport, wynajem, drobne zakupy.">
            <SelectCase value={directCostForm.case_id} cases={caseOptions} onChange={(v) => setDirectCostForm((f) => ({ ...f, case_id: v }))} />
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="input text-sm" value={directCostForm.cost_type} onChange={(e) => setDirectCostForm((f) => ({ ...f, cost_type: e.target.value as CaseDirectCostType }))}>
                {DIRECT_COST_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <DateInput className="text-sm" value={directCostForm.cost_date} onChange={(e) => setDirectCostForm((f) => ({ ...f, cost_date: e.target.value }))} />
            </div>
            <input className="input text-sm" placeholder="Nazwa kosztu" value={directCostForm.title} onChange={(e) => setDirectCostForm((f) => ({ ...f, title: e.target.value }))} />
            <input className="input text-sm" placeholder="Kwota" inputMode="decimal" value={directCostForm.amount} onChange={(e) => setDirectCostForm((f) => ({ ...f, amount: e.target.value }))} />
            <button type="button" onClick={() => void saveDirectCost()} className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink">Dodaj koszt</button>
          </Panel>
        </div>

        <div className="grid min-w-0 gap-4">
          {importRows.length > 0 && (
            <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-ink">Podgląd importu faktur</h2>
                  <p className="break-words text-xs leading-5 text-steel">Sprawdź budowę, kategorię i duplikaty przed zapisem kosztów.</p>
                </div>
                <button type="button" onClick={() => { setImportRows([]); setImportMeta(null); }} className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50">Wyczyść</button>
              </div>
              <div className="mt-4 max-w-full overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[980px] text-xs">
                  <thead className="uppercase text-steel">
                    <tr>
                      <th className="py-2 pr-3 text-left">Dostawca</th>
                      <th className="py-2 pr-3 text-left">Budowa</th>
                      <th className="py-2 pr-3 text-left">Kategoria</th>
                      <th className="py-2 pr-3 text-right">Brutto</th>
                      <th className="py-2 pr-3 text-left">Data</th>
                      <th className="py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {importRows.map((row) => (
                      <tr key={row.rowId} className={row.duplicate ? "bg-amber-50/60" : ""}>
                        <td className="py-2 pr-3">
                          <p className="font-semibold text-ink">{row.supplier_name}</p>
                          <p className="text-steel">{row.invoice_number || "bez numeru"}</p>
                        </td>
                        <td className="py-2 pr-3">
                          <select className="input h-9 text-xs" value={row.case_id || ""} onChange={(e) => updateImportRow(row.rowId, { case_id: e.target.value || null, case_label: caseOptions.find((c) => c.id === e.target.value)?.label || null })}>
                            <option value="">bez sprawy</option>
                            {caseOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </select>
                        </td>
                        <td className="py-2 pr-3">
                          <select className="input h-9 text-xs" value={row.category} onChange={(e) => updateImportRow(row.rowId, { category: e.target.value as SupplierInvoiceCategory, category_reason: "Ręcznie zmieniono w podglądzie", category_confidence: 1 })}>
                            {INVOICE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </select>
                          <p className="mt-1 text-[11px] text-steel">{row.category_reason} · {(row.category_confidence * 100).toFixed(0)}%</p>
                        </td>
                        <td className="py-2 pr-3 text-right font-bold text-ink">{currency.format(row.gross_total)}</td>
                        <td className="py-2 pr-3 text-steel">{formatDate(row.invoice_date)}</td>
                        <td className="py-2">
                          {row.duplicate ? <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">{row.duplicate_reason}</span> : <span className="rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">nowa</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 break-words text-lg font-bold text-ink">Rentowność według budów</h2>
              <InfoTip text="Porównanie wartości umownej, budżetu, kosztów wykonanych i prognozowanego wyniku osobno dla każdego zlecenia." />
            </div>
            <p className="mt-1 break-words text-xs leading-5 text-steel">Plan, wykonanie, odchylenie i prognoza końcowego wyniku.</p>
            {loading ? (
              <p className="mt-4 text-sm text-steel">Wczytywanie...</p>
            ) : (
              <div className="mt-4 max-w-full overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[1180px] text-sm">
                  <thead className="text-xs uppercase text-steel">
                    <tr>
                      <th className="py-2 pr-3 text-left">Budowa</th>
                      <th className="py-2 pr-3 text-right"><TableHelp label="Umowa / plan" text={PROFITABILITY_HELP.revenuePlanned} /></th>
                      <th className="py-2 pr-3 text-right"><TableHelp label="Plan koszt" text={PROFITABILITY_HELP.plannedCost} /></th>
                      <th className="py-2 pr-3 text-right">Koszt</th>
                      <th className="py-2 pr-3 text-right"><TableHelp label="Odchyl." text={PROFITABILITY_HELP.variance} /></th>
                      <th className="py-2 pr-3 text-right">Zysk</th>
                      <th className="py-2 pr-3 text-right"><TableHelp label="Prognoza" text={PROFITABILITY_HELP.forecast} /></th>
                      <th className="py-2 pr-3 text-right"><TableHelp label="Postęp" text={PROFITABILITY_HELP.progress} /></th>
                      <th className="py-2 pr-3 text-left"><TableHelp label="Pewność" text={PROFITABILITY_HELP.confidence} align="left" /></th>
                      <th className="py-2 text-right"><TableHelp label="Marża prog." text={PROFITABILITY_HELP.forecastMarginPct} /></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {[...summary.rows].sort((a, b) => b.revenuePlanned - a.revenuePlanned).map((row) => (
                      <tr key={row.caseId}>
                        <td className="py-2 pr-3">
                          <Link href={`/cases/${row.caseId}`} className="font-semibold text-ink hover:text-moss">{row.clientName}</Link>
                          <p className="text-xs text-steel">{row.location || row.status}</p>
                        </td>
                        <td className="py-2 pr-3 text-right">{currency.format(row.revenuePlanned)}</td>
                        <td className="py-2 pr-3 text-right">{row.plannedCost > 0 ? currency.format(row.plannedCost) : "brak"}</td>
                        <td className="py-2 pr-3 text-right font-semibold">{currency.format(row.totalCost)}</td>
                        <td className={`py-2 pr-3 text-right font-semibold ${row.costVariance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{row.plannedCost > 0 ? currency.format(row.costVariance) : "-"}</td>
                        <td className={`py-2 pr-3 text-right font-bold ${row.profit < 0 ? "text-rose-700" : "text-emerald-700"}`}>{currency.format(row.profit)}</td>
                        <td className={`py-2 pr-3 text-right font-bold ${row.forecastProfit < 0 ? "text-rose-700" : "text-emerald-700"}`}>{currency.format(row.forecastProfit)}</td>
                        <td className="py-2 pr-3 text-right">{row.progressPct.toFixed(0)}%</td>
                        <td className="py-2 pr-3">
                          <span title={row.forecastConfidenceReason} className={`rounded-full px-2 py-1 text-xs font-semibold ${row.forecastConfidence === "high" ? "bg-emerald-100 text-emerald-800" : row.forecastConfidence === "medium" ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-steel"}`}>
                            {row.forecastConfidence === "high" ? "wysoka" : row.forecastConfidence === "medium" ? "średnia" : "niska"}
                          </span>
                        </td>
                        <td className="py-2 text-right font-semibold">{row.forecastMarginPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                    {summary.rows.length === 0 && (
                      <tr><td colSpan={10} className="py-8 text-center text-steel">Brak spraw do analizy.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="grid min-w-0 gap-4 2xl:grid-cols-2">
            <RecentBox title="Ostatnie faktury kosztowe">
              {supplierInvoices.slice(0, 8).map((i) => (
                <li key={i.id} className="flex min-w-0 flex-col gap-2 border-b border-stone-100 py-2 last:border-0 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-ink">{i.supplier_name}</p>
                    <p className="text-xs text-steel">{i.invoice_number || "bez numeru"} · {formatDate(i.invoice_date)}{i.sent_at ? ` · wysłano ${formatDate(i.sent_at)}` : ""}</p>
                    {i.linked_settlement_entry_id ? <p className="mt-1 text-xs font-semibold text-emerald-700">Powiązana z rozliczeniem · bez podwójnego kosztu</p> : null}
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                    <p className="font-bold text-ink">{currency.format(Number(i.gross_total || 0))}</p>
                    <button type="button" disabled={!i.case_id || sendingSupplierId === i.id} onClick={() => void sendSupplierInvoice(i)} className="rounded-md border border-stone-300 px-2 py-1 text-xs font-semibold text-ink hover:bg-stone-50 disabled:opacity-40">{sendingSupplierId === i.id ? "Wysyłka..." : "Do księgowej"}</button>
                  </div>
                </li>
              ))}
            </RecentBox>
            <RecentBox title="Ostatnie rozliczenia podwykonawców">
              {subEntries.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 border-b border-stone-100 py-2 last:border-0">
                  <div>
                    <p className="font-semibold text-ink">{subById.get(e.subcontractor_id || "")?.name || e.title || "Podwykonawca"}</p>
                    <p className="text-xs text-steel">{e.entry_type} · {formatDate(e.entry_date)}</p>
                  </div>
                  <p className="font-bold text-ink">{currency.format(Number(e.amount || 0))}</p>
                </li>
              ))}
            </RecentBox>
          </section>
        </div>
      </section>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="min-w-0">
        <h2 className="break-words text-base font-bold text-ink">{title}</h2>
        <p className="mt-1 break-words text-xs leading-5 text-steel">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function TableHelp({ label, text, align = "right" }: { label: string; text: string; align?: "left" | "right" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${align === "right" ? "justify-end" : "justify-start"}`}>
      <span>{label}</span>
      <InfoTip text={text} />
    </span>
  );
}

function SelectCase({ value, cases, onChange }: { value: string; cases: { id: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <select className="input text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">bez przypisania do sprawy</option>
      {cases.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}

function RecentBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <h2 className="break-words text-base font-bold text-ink">{title}</h2>
      <ul className="mt-3 min-w-0 text-sm">{children}</ul>
    </section>
  );
}

function AlertCard({
  severity,
  title,
  description,
  caseId
}: {
  severity: ProfitabilityAlertSeverity;
  title: string;
  description: string;
  caseId?: string;
}) {
  const colors: Record<ProfitabilityAlertSeverity, string> = {
    critical: "border-rose-200 bg-rose-50 text-rose-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    info: "border-sky-200 bg-sky-50 text-sky-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900"
  };
  const dot: Record<ProfitabilityAlertSeverity, string> = {
    critical: "bg-rose-600",
    warning: "bg-amber-500",
    info: "bg-sky-500",
    success: "bg-emerald-600"
  };
  const body = (
    <div className={`min-h-[112px] min-w-0 rounded-lg border p-4 ${colors[severity]}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dot[severity]}`} />
        <div className="min-w-0">
          <p className="break-words text-sm font-bold">{title}</p>
          <p className="mt-1 break-words text-xs leading-5">{description}</p>
        </div>
      </div>
    </div>
  );
  return caseId ? (
    <Link href={`/cases/${caseId}`} className="block transition hover:-translate-y-0.5 hover:shadow-panel">
      {body}
    </Link>
  ) : (
    body
  );
}

function MiniList({
  title,
  rows,
  mode,
  empty
}: {
  title: string;
  rows: CaseProfitabilityRow[];
  mode: "profit" | "unpaid" | "materials";
  empty: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-stone-200 p-3">
      <p className="break-words text-xs font-bold uppercase tracking-[0.16em] text-steel">{title}</p>
      <ul className="mt-2 grid gap-2">
        {rows.slice(0, 3).map((row) => {
          const value =
            mode === "profit"
              ? row.profit
              : mode === "unpaid"
                ? row.unpaidRevenue
                : row.revenuePlanned > 0
                  ? (row.materialCost / row.revenuePlanned) * 100
                  : 0;
          return (
            <li key={`${title}-${row.caseId}`} className="flex min-w-0 items-center justify-between gap-3 text-sm">
              <Link href={`/cases/${row.caseId}`} className="min-w-0 font-semibold text-ink hover:text-moss">
                <span className="block truncate">{row.clientName}</span>
                <span className="block truncate text-xs font-normal text-steel">{row.location || row.status}</span>
              </Link>
              <span className={`shrink-0 font-bold ${mode === "profit" && value < 0 ? "text-rose-700" : "text-ink"}`}>
                {mode === "materials" ? `${value.toFixed(0)}%` : currency.format(value)}
              </span>
            </li>
          );
        })}
        {rows.length === 0 && <li className="text-xs text-steel">{empty}</li>}
      </ul>
    </div>
  );
}

function TrendChart({ rows }: { rows: { month: string; label: string; revenue: number; cost: number; profit: number; marginPct: number }[] }) {
  const maxValue = Math.max(1, ...rows.map((r) => Math.max(r.revenue, r.cost, Math.abs(r.profit))));
  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 break-words text-lg font-bold text-ink">Trend miesięczny</h2>
        <InfoTip text={PROFITABILITY_HELP.monthly} />
      </div>
      <p className="mt-1 break-words text-xs leading-5 text-steel">Faktury sprzedażowe i koszty według dat dokumentów, pracy oraz rozliczeń.</p>
      <div className="mt-4 grid gap-4">
        {rows.slice(-8).map((row) => (
          <div key={row.month} className="grid gap-2">
            <div className="flex min-w-0 flex-col gap-1 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
              <p className="text-sm font-semibold text-ink">{row.label}</p>
              <p className={`break-words text-sm font-bold ${row.profit < 0 ? "text-rose-700" : "text-emerald-700"}`}>{currency.format(row.profit)} · {row.marginPct.toFixed(1)}%</p>
            </div>
            <div className="grid h-[54px] grid-cols-3 items-end gap-2 rounded-lg bg-stone-50 p-2">
              <Bar label="Przychód" value={row.revenue} max={maxValue} className="bg-moss" />
              <Bar label="Koszt" value={row.cost} max={maxValue} className="bg-amber-500" />
              <Bar label="Wynik" value={Math.abs(row.profit)} max={maxValue} className={row.profit < 0 ? "bg-rose-600" : "bg-emerald-600"} />
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-steel">Brak danych do wykresu.</p>}
      </div>
    </section>
  );
}

function CostStructureChart({ items }: { items: { key: string; label: string; value: number; percent: number }[] }) {
  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 break-words text-lg font-bold text-ink">Struktura kosztów</h2>
        <InfoTip text={PROFITABILITY_HELP.costStructure} />
      </div>
      <p className="mt-1 break-words text-xs leading-5 text-steel">Pokazuje, która kategoria najbardziej obciąża marżę firmy.</p>
      <div className="mt-4 grid gap-3">
        {items.map((item) => (
          <div key={item.key}>
            <div className="flex min-w-0 flex-col gap-1 text-sm min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
              <p className="font-semibold text-ink">{item.label}</p>
              <p className="break-words font-bold text-ink">{currency.format(item.value)} · {item.percent.toFixed(1)}%</p>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100">
              <div className="h-full rounded-full bg-moss" style={{ width: `${Math.min(100, item.percent)}%` }} />
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-steel">Brak kosztów do analizy.</p>}
      </div>
    </section>
  );
}

function Bar({ label, value, max, className }: { label: string; value: number; max: number; className: string }) {
  const height = Math.max(8, Math.round((value / max) * 34));
  return (
    <div className="flex h-full min-w-0 flex-col items-center justify-end gap-1">
      <div className={`w-full rounded-t ${className}`} style={{ height }} />
      <p className="truncate text-[10px] font-semibold text-steel">{label}</p>
    </div>
  );
}
