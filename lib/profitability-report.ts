import type {
  CaseDirectCost,
  CaseProfitabilityPlan,
  CaseRow,
  CaseSubcontractor,
  AggregatedLaborCost,
  EmployeePayrollProfile,
  EmployeeMonthlySettlement,
  EmployeePieceworkEntry,
  EmployeeSettlementEntry,
  Invoice,
  Payment,
  SubcontractorSettlementEntry,
  SupplierInvoice,
  WorkHour
} from "@/lib/types";

export type CaseProfitabilityRow = {
  caseId: string;
  createdAt: string;
  clientName: string;
  location: string;
  status: string;
  revenuePlanned: number;
  revenueInvoiced: number;
  revenueDue: number;
  revenuePaid: number;
  materialCost: number;
  laborCost: number;
  subcontractorCost: number;
  equipmentCost: number;
  transportCost: number;
  otherCost: number;
  totalCost: number;
  profit: number;
  marginPct: number;
  unpaidRevenue: number;
  overdueRevenue: number;
  costPaid: number;
  costUnpaid: number;
  plannedCost: number;
  plannedProfit: number;
  plannedMarginPct: number;
  progressPct: number;
  forecastCost: number;
  forecastProfit: number;
  forecastMarginPct: number;
  forecastConfidence: "low" | "medium" | "high";
  forecastConfidenceReason: string;
  costVariance: number;
  profitVariance: number;
};

export type CostStructureItem = {
  key: string;
  label: string;
  value: number;
  percent: number;
};

export type MonthlyProfitability = {
  month: string;
  label: string;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
};

export type ProfitabilityAlertSeverity = "critical" | "warning" | "info" | "success";

export type ProfitabilityAlert = {
  id: string;
  severity: ProfitabilityAlertSeverity;
  title: string;
  description: string;
  caseId?: string;
  amount?: number;
};

export type ProfitabilitySummary = {
  rows: CaseProfitabilityRow[];
  revenuePlanned: number;
  revenueInvoiced: number;
  revenueDue: number;
  revenuePaid: number;
  materialCost: number;
  laborCost: number;
  subcontractorCost: number;
  equipmentCost: number;
  transportCost: number;
  otherCost: number;
  totalCost: number;
  profit: number;
  marginPct: number;
  unpaidRevenue: number;
  overdueRevenue: number;
  costUnpaid: number;
  plannedCost: number;
  plannedProfit: number;
  forecastCost: number;
  forecastProfit: number;
  forecastMarginPct: number;
  costVariance: number;
  profitVariance: number;
  costStructure: CostStructureItem[];
  monthly: MonthlyProfitability[];
  alerts: ProfitabilityAlert[];
  /** Przychód bez żadnych kosztów — wynik i marża nie mają jeszcze sensu. */
  costDataIncomplete: boolean;
  topProfitable: CaseProfitabilityRow[];
  lossMakers: CaseProfitabilityRow[];
  lowMarginRows: CaseProfitabilityRow[];
  unpaidRows: CaseProfitabilityRow[];
  highMaterialRows: CaseProfitabilityRow[];
};

export type ProfitabilityInput = {
  cases: CaseRow[];
  payments: Payment[];
  salesInvoices?: Invoice[];
  workHours: WorkHour[];
  employees: EmployeePayrollProfile[];
  employeeEntries: EmployeeSettlementEntry[];
  pieceworkEntries?: EmployeePieceworkEntry[];
  employeeMonthlySettlements?: EmployeeMonthlySettlement[];
  supplierInvoices: SupplierInvoice[];
  profitabilityPlans?: CaseProfitabilityPlan[];
  caseSubcontractors: CaseSubcontractor[];
  subcontractorEntries: SubcontractorSettlementEntry[];
  directCosts: CaseDirectCost[];
  aggregatedLaborCosts?: AggregatedLaborCost[];
};

function n(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((acc, row) => acc + pick(row), 0);
}

function normalizeName(value: string | null | undefined): string {
  return (value || "").trim().toLocaleLowerCase("pl-PL");
}

function costEffect(entry: EmployeeSettlementEntry): number {
  if (entry.entry_type === "potracenie" || (entry.entry_type === "korekta" && entry.direction === "minus")) return -n(entry.amount);
  if (entry.entry_type === "zaliczka" || entry.entry_type === "wyplata") return 0;
  return n(entry.amount);
}

function subcontractorCostEffect(entry: SubcontractorSettlementEntry): number {
  if (entry.entry_type === "potracenie") return -n(entry.amount);
  return n(entry.amount);
}

function categoryCost(invoices: SupplierInvoice[], category: SupplierInvoice["category"]): number {
  return sum(invoices.filter((i) => i.category === category), (i) => n(i.gross_total));
}

function monthKey(value: string | null | undefined): string {
  const source = value && /^\d{4}-\d{2}/.test(value) ? value : new Date().toISOString();
  return source.slice(0, 7);
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat("pl-PL", { month: "short", year: "numeric" }).format(date);
}

function pct(value: number, base: number): number {
  if (base <= 0) return 0;
  return (value / base) * 100;
}

function compactRows(rows: CaseProfitabilityRow[]): CaseProfitabilityRow[] {
  return rows.filter((r) => r.revenuePlanned > 0 || r.totalCost > 0);
}

function plannedCost(plan: CaseProfitabilityPlan | undefined): number {
  if (!plan) return 0;
  const base =
    n(plan.planned_material_cost) +
    n(plan.planned_labor_cost) +
    n(plan.planned_subcontractor_cost) +
    n(plan.planned_equipment_cost) +
    n(plan.planned_transport_cost) +
    n(plan.planned_other_cost);
  return base * (1 + n(plan.contingency_pct) / 100);
}

function forecastFinalCost(totalCost: number, planCost: number, progressPct: number): number {
  if (progressPct <= 0) return Math.max(totalCost, planCost);
  if (progressPct >= 95) return totalCost;
  const earnedCost = totalCost / (progressPct / 100);
  return Math.max(totalCost, planCost, earnedCost);
}

function forecastConfidence(plan: CaseProfitabilityPlan | undefined, totalCost: number): Pick<CaseProfitabilityRow, "forecastConfidence" | "forecastConfidenceReason"> {
  if (!plan || n(plan.progress_pct) <= 0) {
    return { forecastConfidence: "low", forecastConfidenceReason: "Brak zatwierdzonego postępu realizacji." };
  }
  if (n(plan.progress_pct) >= 20 && plannedCost(plan) > 0 && totalCost > 0) {
    return { forecastConfidence: "high", forecastConfidenceReason: "Prognoza opiera się na planie, kosztach wykonanych i postępie." };
  }
  return { forecastConfidence: "medium", forecastConfidenceReason: "Prognoza ma plan lub postęp, ale historia kosztów jest jeszcze ograniczona." };
}

/**
 * Przychód jest, kosztów nie ma wcale — to nie jest zysk, to brak danych.
 *
 * Bez tej kontroli raport przy pustych fakturach kosztowych pokazywał „Firma na plusie,
 * marża 100 %” i wynik równy całemu przychodowi. Klient słusznie uznał to za wprowadzanie
 * w błąd: taki komunikat wygląda jak ocena, a jest artefaktem nieuzupełnionych kosztów.
 */
export function isCostDataIncomplete(summary: Pick<ProfitabilitySummary, "revenuePlanned" | "totalCost">): boolean {
  return summary.revenuePlanned > 0 && summary.totalCost <= 0;
}

function buildAlerts(
  rows: CaseProfitabilityRow[],
  summary: Pick<ProfitabilitySummary, "profit" | "marginPct" | "unpaidRevenue" | "costUnpaid" | "revenuePlanned" | "totalCost">
): ProfitabilityAlert[] {
  if (isCostDataIncomplete(summary)) {
    // Zamiast oceniać rentowność — jedna jasna informacja, co trzeba uzupełnić.
    return [
      {
        id: "cost-data-incomplete",
        severity: "warning",
        title: "Niepełne dane kosztowe",
        description:
          "W systemie są przychody, ale nie ma żadnych kosztów. Wynik i marża nie mają jeszcze sensu — uzupełnij faktury kosztowe, robociznę i podwykonawców, a raport pokaże realną rentowność.",
        amount: summary.revenuePlanned
      }
    ];
  }
  const alerts: ProfitabilityAlert[] = [];

  compactRows(rows)
    .filter((r) => r.profit < 0)
    .sort((a, b) => a.profit - b.profit)
    .slice(0, 5)
    .forEach((r) => {
      alerts.push({
        id: `loss-${r.caseId}`,
        severity: "critical",
        title: "Budowa na minusie",
        description: `${r.clientName}${r.location ? `, ${r.location}` : ""}: wynik ${Math.round(r.profit).toLocaleString("pl-PL")} zł. Sprawdź koszt materiałów, robocizny i podwykonawców.`,
        caseId: r.caseId,
        amount: r.profit
      });
    });

  compactRows(rows)
    .filter((r) => r.profit >= 0 && r.revenuePlanned > 0 && r.marginPct < 15)
    .sort((a, b) => a.marginPct - b.marginPct)
    .slice(0, 5)
    .forEach((r) => {
      alerts.push({
        id: `margin-${r.caseId}`,
        severity: "warning",
        title: "Niska marża",
        description: `${r.clientName}: marża ${r.marginPct.toFixed(1)}%. Przy tej budowie firma zarabia mało względem obrotu.`,
        caseId: r.caseId,
        amount: r.profit
      });
    });

  compactRows(rows)
    .filter((r) => r.unpaidRevenue > 0)
    .sort((a, b) => b.unpaidRevenue - a.unpaidRevenue)
    .slice(0, 5)
    .forEach((r) => {
      alerts.push({
        id: `unpaid-${r.caseId}`,
        severity: r.unpaidRevenue > Math.max(5000, r.revenuePlanned * 0.25) ? "warning" : "info",
        title: "Pieniądze do odzyskania",
        description: `${r.clientName}: klient ma jeszcze do zapłaty ${Math.round(r.unpaidRevenue).toLocaleString("pl-PL")} zł.`,
        caseId: r.caseId,
        amount: r.unpaidRevenue
      });
    });

  compactRows(rows)
    .filter((r) => r.revenuePlanned > 0 && r.materialCost / r.revenuePlanned > 0.45)
    .sort((a, b) => b.materialCost / b.revenuePlanned - a.materialCost / a.revenuePlanned)
    .slice(0, 4)
    .forEach((r) => {
      alerts.push({
        id: `material-${r.caseId}`,
        severity: "warning",
        title: "Materiały zjadają marżę",
        description: `${r.clientName}: materiały to ${(r.materialCost / r.revenuePlanned * 100).toFixed(1)}% przychodu. Warto porównać faktury z kosztorysem.`,
        caseId: r.caseId,
        amount: r.materialCost
      });
    });

  compactRows(rows)
    .filter((r) => r.forecastProfit < 0 && r.profit >= 0)
    .sort((a, b) => a.forecastProfit - b.forecastProfit)
    .slice(0, 5)
    .forEach((r) => {
      alerts.push({
        id: `forecast-loss-${r.caseId}`,
        severity: "critical",
        title: "Prognoza zejścia na stratę",
        description: `${r.clientName}: dziś wynik jest dodatni, ale przy obecnym tempie kosztów prognoza końcowa to ${Math.round(r.forecastProfit).toLocaleString("pl-PL")} zł.`,
        caseId: r.caseId,
        amount: r.forecastProfit
      });
    });

  compactRows(rows)
    .filter((r) => r.plannedCost > 0 && r.costVariance > Math.max(2000, r.plannedCost * 0.12))
    .sort((a, b) => b.costVariance - a.costVariance)
    .slice(0, 5)
    .forEach((r) => {
      alerts.push({
        id: `plan-variance-${r.caseId}`,
        severity: "warning",
        title: "Koszt przekracza plan",
        description: `${r.clientName}: koszty są o ${Math.round(r.costVariance).toLocaleString("pl-PL")} zł powyżej budżetu. Sprawdź import faktur i zakres prac.`,
        caseId: r.caseId,
        amount: r.costVariance
      });
    });

  if (summary.costUnpaid > 0) {
    alerts.push({
      id: "cost-unpaid",
      severity: "info",
      title: "Niezamknięte koszty",
      description: `W fakturach kosztowych pozostaje do opłacenia ${Math.round(summary.costUnpaid).toLocaleString("pl-PL")} zł. To obciąży kasę w kolejnych dniach.`,
      amount: summary.costUnpaid
    });
  }

  if (summary.unpaidRevenue > 0 && summary.unpaidRevenue > summary.costUnpaid) {
    alerts.push({
      id: "cash-gap-positive",
      severity: "info",
      title: "Największa szansa na szybki cash",
      description: `Do zebrania od klientów jest o ${Math.round(summary.unpaidRevenue - summary.costUnpaid).toLocaleString("pl-PL")} zł więcej niż niezapłaconych kosztów. Priorytet: windykacja harmonogramów.`,
      amount: summary.unpaidRevenue - summary.costUnpaid
    });
  }

  if (rows.length > 0 && summary.profit > 0 && summary.marginPct >= 20) {
    alerts.push({
      id: "healthy-profit",
      severity: "success",
      title: "Firma na plusie",
      description: `Łączna marża wynosi ${summary.marginPct.toFixed(1)}%. Najlepsze budowy warto wykorzystać jako wzorzec wyceny kolejnych ofert.`,
      amount: summary.profit
    });
  }

  const severityOrder: Record<ProfitabilityAlertSeverity, number> = { critical: 0, warning: 1, info: 2, success: 3 };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]).slice(0, 14);
}

export function buildProfitabilitySummary(input: ProfitabilityInput): ProfitabilitySummary {
  const paymentsByCase = new Map<string, Payment[]>();
  input.payments.forEach((p) => {
    paymentsByCase.set(p.case_id, [...(paymentsByCase.get(p.case_id) || []), p]);
  });
  const salesInvoicesByCase = new Map<string, Invoice[]>();
  (input.salesInvoices || [])
    .filter((invoice) => invoice.status !== "szkic" && invoice.status !== "anulowana")
    .forEach((invoice) => {
      salesInvoicesByCase.set(invoice.case_id, [...(salesInvoicesByCase.get(invoice.case_id) || []), invoice]);
    });
  const linkedSettlementIds = new Set(
    input.supplierInvoices.map((invoice) => invoice.linked_settlement_entry_id).filter((id): id is string => !!id)
  );

  const invoicesByCase = new Map<string, SupplierInvoice[]>();
  input.supplierInvoices.forEach((i) => {
    if (!i.case_id) return;
    invoicesByCase.set(i.case_id, [...(invoicesByCase.get(i.case_id) || []), i]);
  });

  const directByCase = new Map<string, CaseDirectCost[]>();
  input.directCosts.forEach((c) => {
    directByCase.set(c.case_id, [...(directByCase.get(c.case_id) || []), c]);
  });

  const employeeById = new Map(input.employees.map((e) => [e.id, e]));
  const employeeByName = new Map(input.employees.map((e) => [normalizeName(e.full_name), e]));
  const settlementByEmployeeMonth = new Map(
    (input.employeeMonthlySettlements || []).map((card) => [`${card.employee_id}:${monthKey(card.period_month)}`, card])
  );
  const employeeMonthHours = new Map<string, number>();
  const employeeDayHours = new Map<string, number>();
  input.workHours.forEach((hour) => {
    const employee = (hour.employee_id ? employeeById.get(hour.employee_id) : null) || employeeByName.get(normalizeName(hour.worker_name));
    if (!employee) return;
    const monthId = `${employee.id}:${monthKey(hour.work_date)}`;
    const dayId = `${employee.id}:${hour.work_date}`;
    employeeMonthHours.set(monthId, (employeeMonthHours.get(monthId) || 0) + n(hour.hours));
    employeeDayHours.set(dayId, (employeeDayHours.get(dayId) || 0) + n(hour.hours));
  });
  const laborCostForHour = (hour: WorkHour): number => {
    const employee = (hour.employee_id ? employeeById.get(hour.employee_id) : null) || employeeByName.get(normalizeName(hour.worker_name));
    if (!employee) return 0;
    const hours = n(hour.hours);
    const month = monthKey(hour.work_date);
    const monthHours = employeeMonthHours.get(`${employee.id}:${month}`) || 0;
    const card = settlementByEmployeeMonth.get(`${employee.id}:${month}`);
    if (card && monthHours > 0) return n(card.base_amount) * (hours / monthHours);
    if (employee.employment_type === "godzinowka") return hours * n(employee.hourly_rate);
    if (employee.employment_type === "dniowka") {
      const dayHours = employeeDayHours.get(`${employee.id}:${hour.work_date}`) || 0;
      return dayHours > 0 ? n(employee.day_rate) * (hours / dayHours) : 0;
    }
    if (n(employee.monthly_salary) > 0 && monthHours > 0) return n(employee.monthly_salary) * (hours / monthHours);
    return hours * n(employee.hourly_rate);
  };

  const hoursByCase = new Map<string, WorkHour[]>();
  input.workHours.forEach((h) => {
    if (!h.case_id) return;
    hoursByCase.set(h.case_id, [...(hoursByCase.get(h.case_id) || []), h]);
  });

  const employeeEntriesByCase = new Map<string, EmployeeSettlementEntry[]>();
  input.employeeEntries.forEach((e) => {
    if (!e.case_id) return;
    employeeEntriesByCase.set(e.case_id, [...(employeeEntriesByCase.get(e.case_id) || []), e]);
  });

  const pieceworkByCase = new Map<string, EmployeePieceworkEntry[]>();
  (input.pieceworkEntries || []).forEach((e) => {
    if (!e.case_id) return;
    pieceworkByCase.set(e.case_id, [...(pieceworkByCase.get(e.case_id) || []), e]);
  });
  const aggregatedLaborByCase = new Map<string, AggregatedLaborCost[]>();
  (input.aggregatedLaborCosts || []).forEach((entry) => {
    aggregatedLaborByCase.set(entry.case_id, [...(aggregatedLaborByCase.get(entry.case_id) || []), entry]);
  });

  const caseSubsByCase = new Map<string, CaseSubcontractor[]>();
  input.caseSubcontractors.forEach((s) => {
    caseSubsByCase.set(s.case_id, [...(caseSubsByCase.get(s.case_id) || []), s]);
  });

  const subEntriesByCase = new Map<string, SubcontractorSettlementEntry[]>();
  input.subcontractorEntries.forEach((e) => {
    if (!e.case_id) return;
    subEntriesByCase.set(e.case_id, [...(subEntriesByCase.get(e.case_id) || []), e]);
  });

  const plansByCase = new Map((input.profitabilityPlans || []).map((plan) => [plan.case_id, plan]));

  const rows = input.cases.map((c) => {
    const payments = paymentsByCase.get(c.id) || [];
    const plan = plansByCase.get(c.id);
    const salesInvoices = salesInvoicesByCase.get(c.id) || [];
    const revenueFromPayments = sum(payments, (p) => n(p.amount_due));
    const planRevenue = n(plan?.planned_revenue);
    const revenuePlanned = planRevenue > 0 ? planRevenue : revenueFromPayments > 0 ? revenueFromPayments : n(c.estimated_value);
    const revenueInvoiced = sum(salesInvoices, (invoice) => n(invoice.gross_total));
    const revenueDue = salesInvoices.length > 0 ? revenueInvoiced : revenueFromPayments;
    const revenuePaid = salesInvoices.length > 0
      ? sum(salesInvoices, (invoice) => n(invoice.paid_amount))
      : sum(payments, (p) => n(p.amount_paid));
    const today = new Date().toISOString().slice(0, 10);
    const overdueRevenue = salesInvoices.length > 0
      ? sum(salesInvoices.filter((invoice) => !!invoice.due_date && invoice.due_date < today), (invoice) => Math.max(0, n(invoice.gross_total) - n(invoice.paid_amount)))
      : sum(payments.filter((payment) => !!payment.due_date && payment.due_date < today), (payment) => Math.max(0, n(payment.amount_due) - n(payment.amount_paid)));

    const invoices = invoicesByCase.get(c.id) || [];
    const materialCost = categoryCost(invoices, "materialy");
    const equipmentCost = categoryCost(invoices, "sprzet");
    const transportCost = categoryCost(invoices, "transport");
    const invoiceLabor = categoryCost(invoices, "robocizna");
    const invoiceOther = categoryCost(invoices, "inne");
    const invoiceSubcontractor = categoryCost(invoices, "podwykonawca");
    const costPaid = sum(invoices, (i) => n(i.paid_amount));
    const invoiceGross = sum(invoices, (i) => n(i.gross_total));

    const secureLabor = aggregatedLaborByCase.get(c.id);
    const calculatedLabor = secureLabor
      ? sum(secureLabor, (entry) => n(entry.amount))
      : sum(hoursByCase.get(c.id) || [], laborCostForHour)
        + sum(employeeEntriesByCase.get(c.id) || [], costEffect)
        + sum(pieceworkByCase.get(c.id) || [], (e) => n(e.quantity) * n(e.unit_rate_snapshot));
    const laborCost = calculatedLabor + invoiceLabor;

    const agreedSub = sum(caseSubsByCase.get(c.id) || [], (s) => n(s.agreed_total));
    const subEntryCost = sum((subEntriesByCase.get(c.id) || []).filter((entry) => !linkedSettlementIds.has(entry.id)), subcontractorCostEffect);
    const subcontractorCost = Math.max(agreedSub, subEntryCost + invoiceSubcontractor);

    const directCosts = directByCase.get(c.id) || [];
    const directMaterial = sum(directCosts.filter((d) => d.cost_type === "materialy"), (d) => n(d.amount));
    const directLabor = sum(directCosts.filter((d) => d.cost_type === "robocizna"), (d) => n(d.amount));
    const directSub = sum(directCosts.filter((d) => d.cost_type === "podwykonawcy"), (d) => n(d.amount));
    const directEquipment = sum(directCosts.filter((d) => d.cost_type === "sprzet"), (d) => n(d.amount));
    const directTransport = sum(directCosts.filter((d) => d.cost_type === "transport"), (d) => n(d.amount));
    const directOther = sum(directCosts.filter((d) => d.cost_type === "inne"), (d) => n(d.amount));

    const finalMaterialCost = materialCost + directMaterial;
    const finalLaborCost = laborCost + directLabor;
    const finalSubcontractorCost = subcontractorCost + directSub;
    const finalEquipmentCost = equipmentCost + directEquipment;
    const finalTransportCost = transportCost + directTransport;
    const otherCost = invoiceOther + directOther;
    const totalCost =
      finalMaterialCost + finalLaborCost + finalSubcontractorCost + finalEquipmentCost + finalTransportCost + otherCost;
    const profit = revenuePlanned - totalCost;
    const planCost = plannedCost(plan);
    const planProfit = revenuePlanned - planCost;
    const progressPct = n(plan?.progress_pct);
    const forecastCost = forecastFinalCost(totalCost, planCost, progressPct);
    const forecastProfit = revenuePlanned - forecastCost;
    const confidence = forecastConfidence(plan, totalCost);

    return {
      caseId: c.id,
      createdAt: c.created_at,
      clientName: c.client_name,
      location: c.location || "",
      status: c.status,
      revenuePlanned,
      revenueInvoiced,
      revenueDue,
      revenuePaid,
      materialCost: finalMaterialCost,
      laborCost: finalLaborCost,
      subcontractorCost: finalSubcontractorCost,
      equipmentCost: finalEquipmentCost,
      transportCost: finalTransportCost,
      otherCost,
      totalCost,
      profit,
      marginPct: revenuePlanned > 0 ? (profit / revenuePlanned) * 100 : 0,
      unpaidRevenue: Math.max(0, revenueDue - revenuePaid),
      overdueRevenue,
      costPaid,
      costUnpaid: Math.max(0, invoiceGross - costPaid),
      plannedCost: planCost,
      plannedProfit: planProfit,
      plannedMarginPct: revenuePlanned > 0 ? (planProfit / revenuePlanned) * 100 : 0,
      progressPct,
      forecastCost,
      forecastProfit,
      forecastMarginPct: revenuePlanned > 0 ? (forecastProfit / revenuePlanned) * 100 : 0,
      ...confidence,
      costVariance: planCost > 0 ? totalCost - planCost : 0,
      profitVariance: planCost > 0 ? profit - planProfit : 0
    } satisfies CaseProfitabilityRow;
  });

  const revenuePlanned = sum(rows, (r) => r.revenuePlanned);
  const revenueInvoiced = sum(rows, (r) => r.revenueInvoiced);
  const revenueDue = sum(rows, (r) => r.revenueDue);
  const totalCost = sum(rows, (r) => r.totalCost);
  const profit = revenuePlanned - totalCost;
  const materialCost = sum(rows, (r) => r.materialCost);
  const laborCost = sum(rows, (r) => r.laborCost);
  const subcontractorCost = sum(rows, (r) => r.subcontractorCost);
  const equipmentCost = sum(rows, (r) => r.equipmentCost);
  const transportCost = sum(rows, (r) => r.transportCost);
  const otherCost = sum(rows, (r) => r.otherCost);
  const revenuePaid = sum(rows, (r) => r.revenuePaid);
  const unpaidRevenue = sum(rows, (r) => r.unpaidRevenue);
  const overdueRevenue = sum(rows, (r) => r.overdueRevenue);
  const costUnpaid = sum(rows, (r) => r.costUnpaid);
  const marginPct = revenuePlanned > 0 ? (profit / revenuePlanned) * 100 : 0;
  const plannedCostTotal = sum(rows, (r) => r.plannedCost);
  const plannedProfit = revenuePlanned - plannedCostTotal;
  const forecastCost = sum(rows, (r) => r.forecastCost);
  const forecastProfit = revenuePlanned - forecastCost;
  const forecastMarginPct = revenuePlanned > 0 ? (forecastProfit / revenuePlanned) * 100 : 0;
  const costVariance = plannedCostTotal > 0 ? totalCost - plannedCostTotal : 0;
  const profitVariance = plannedCostTotal > 0 ? profit - plannedProfit : 0;
  const costStructure = [
    { key: "materialy", label: "Materiały", value: materialCost, percent: pct(materialCost, totalCost) },
    { key: "robocizna", label: "Robocizna", value: laborCost, percent: pct(laborCost, totalCost) },
    { key: "podwykonawcy", label: "Podwykonawcy", value: subcontractorCost, percent: pct(subcontractorCost, totalCost) },
    { key: "sprzet", label: "Sprzęt", value: equipmentCost, percent: pct(equipmentCost, totalCost) },
    { key: "transport", label: "Transport", value: transportCost, percent: pct(transportCost, totalCost) },
    { key: "inne", label: "Inne", value: otherCost, percent: pct(otherCost, totalCost) }
  ].filter((i) => i.value > 0);

  const monthlyMap = new Map<string, MonthlyProfitability>();
  const addMonthly = (date: string | null | undefined, revenue: number, cost: number) => {
    const key = monthKey(date);
    const current = monthlyMap.get(key) || { month: key, label: monthLabel(key), revenue: 0, cost: 0, profit: 0, marginPct: 0 };
    current.revenue += revenue;
    current.cost += cost;
    current.profit = current.revenue - current.cost;
    current.marginPct = current.revenue > 0 ? (current.profit / current.revenue) * 100 : 0;
    monthlyMap.set(key, current);
  };
  const issuedSalesInvoices = (input.salesInvoices || []).filter(
    (invoice) => invoice.status !== "szkic" && invoice.status !== "anulowana"
  );
  const casesWithIssuedSalesInvoices = new Set(issuedSalesInvoices.map((invoice) => invoice.case_id));
  issuedSalesInvoices.forEach((invoice) => addMonthly(invoice.issue_date, n(invoice.gross_total), 0));
  input.payments
    .filter((payment) => !casesWithIssuedSalesInvoices.has(payment.case_id) && n(payment.amount_paid) > 0)
    .forEach((payment) => addMonthly(payment.paid_at || payment.due_date, n(payment.amount_paid), 0));
  input.supplierInvoices.forEach((invoice) => addMonthly(invoice.invoice_date, 0, n(invoice.gross_total)));
  input.directCosts.forEach((cost) => addMonthly(cost.cost_date, 0, n(cost.amount)));
  if (input.aggregatedLaborCosts) {
    input.aggregatedLaborCosts.forEach((entry) => addMonthly(entry.cost_date, 0, n(entry.amount)));
  } else {
    input.workHours.forEach((hour) => {
      if (!hour.case_id) return;
      addMonthly(hour.work_date, 0, laborCostForHour(hour));
    });
    input.employeeEntries.forEach((entry) => {
      if (!entry.case_id) return;
      addMonthly(entry.entry_date, 0, costEffect(entry));
    });
    (input.pieceworkEntries || []).forEach((entry) => {
      if (!entry.case_id) return;
      addMonthly(entry.entry_date, 0, n(entry.quantity) * n(entry.unit_rate_snapshot));
    });
  }
  input.subcontractorEntries
    .filter((entry) => !linkedSettlementIds.has(entry.id))
    .forEach((entry) => addMonthly(entry.entry_date, 0, subcontractorCostEffect(entry)));

  const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));
  const businessRows = compactRows(rows);
  const topProfitable = [...businessRows].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const lossMakers = [...businessRows].filter((r) => r.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 8);
  const lowMarginRows = [...businessRows]
    .filter((r) => r.revenuePlanned > 0 && r.profit >= 0 && r.marginPct < 15)
    .sort((a, b) => a.marginPct - b.marginPct)
    .slice(0, 8);
  const unpaidRows = [...businessRows].filter((r) => r.unpaidRevenue > 0).sort((a, b) => b.unpaidRevenue - a.unpaidRevenue).slice(0, 8);
  const highMaterialRows = [...businessRows]
    .filter((r) => r.revenuePlanned > 0 && r.materialCost / r.revenuePlanned > 0.45)
    .sort((a, b) => b.materialCost / b.revenuePlanned - a.materialCost / a.revenuePlanned)
    .slice(0, 8);
  const summaryBase = { profit, marginPct, unpaidRevenue, costUnpaid, revenuePlanned, totalCost };
  const duplicateSubcontractorAlerts: ProfitabilityAlert[] = input.supplierInvoices
    .filter((invoice) => invoice.category === "podwykonawca" && !invoice.linked_settlement_entry_id && !!invoice.case_id)
    .flatMap((invoice) => {
      const candidate = input.subcontractorEntries.find(
        (entry) =>
          entry.case_id === invoice.case_id &&
          (!invoice.subcontractor_id || entry.subcontractor_id === invoice.subcontractor_id) &&
          Math.abs(n(entry.amount) - n(invoice.gross_total)) < 0.01
      );
      if (!candidate) return [];
      const caseRow = input.cases.find((item) => item.id === invoice.case_id);
      return [{
        id: `possible-subcontractor-duplicate-${invoice.id}`,
        severity: "warning" as const,
        title: "Możliwy podwójny koszt podwykonawcy",
        description: `${caseRow?.client_name || "Zlecenie"}: faktura ${invoice.invoice_number || invoice.supplier_name} ma tę samą kwotę co rozliczenie. Powiąż dokumenty albo potwierdź, że są to dwa osobne koszty.`,
        caseId: invoice.case_id || undefined,
        amount: n(invoice.gross_total)
      }];
    });

  return {
    rows,
    revenuePlanned,
    revenueInvoiced,
    revenueDue,
    revenuePaid,
    materialCost,
    laborCost,
    subcontractorCost,
    equipmentCost,
    transportCost,
    otherCost,
    totalCost,
    profit,
    marginPct,
    unpaidRevenue,
    overdueRevenue,
    costUnpaid,
    plannedCost: plannedCostTotal,
    plannedProfit,
    forecastCost,
    forecastProfit,
    forecastMarginPct,
    costVariance,
    profitVariance,
    costStructure,
    monthly,
    alerts: [...duplicateSubcontractorAlerts, ...buildAlerts(rows, summaryBase)].slice(0, 14),
    costDataIncomplete: isCostDataIncomplete(summaryBase),
    topProfitable,
    lossMakers,
    lowMarginRows,
    unpaidRows,
    highMaterialRows
  };
}
