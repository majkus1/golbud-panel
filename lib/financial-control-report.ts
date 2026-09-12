import type { CaseRow, Crew, FinancialControlItem, FinancialControlSection, Payment } from "@/lib/types";

export const FINANCIAL_CONTROL_SECTIONS: {
  id: FinancialControlSection;
  number: string;
  title: string;
  shortTitle: string;
  description: string;
}[] = [
  {
    id: "confirmed_receivable",
    number: "1",
    title: "Należności - budowy zakończone / czekamy na pieniądze",
    shortTitle: "Należności",
    description: "Potwierdzone kwoty do kontroli, windykacji lub odbioru."
  },
  {
    id: "potential_scope",
    number: "2",
    title: "Zakresy potencjalne / do decyzji klienta",
    shortTitle: "Zakresy potencjalne",
    description: "Kwoty warunkowe, rozszerzenia zakresu i decyzje klienta."
  },
  {
    id: "cash_outside_transfer",
    number: "3",
    title: "Gotówkowe / poza przelewem",
    shortTitle: "Gotówka",
    description: "Pozycje do odebrania poza standardowym przelewem."
  },
  {
    id: "dispute",
    number: "4",
    title: "Spory",
    shortTitle: "Spory",
    description: "Sprawy sądowe, sporne lub wymagające oddzielnej dokumentacji."
  },
  {
    id: "completion_receivable",
    number: "5",
    title: "Do dokończenia - pieniądze do odbioru po zakończeniu",
    shortTitle: "Do dokończenia",
    description: "Kwoty zależne od zakończenia zakresu, odbioru i rozliczenia końcowego."
  },
  {
    id: "scheduled_build",
    number: "6",
    title: "Budowy podpisane / do wykonania",
    shortTitle: "Budowy do wykonania",
    description: "Terminy wejścia ekip, telefony i zakresy do potwierdzenia przed startem."
  },
  {
    id: "crew_settlement",
    number: "7",
    title: "Rozrachunki z ekipami",
    shortTitle: "Ekipy",
    description: "Zaliczki, zakresy przerobione i rozliczenia brygad."
  },
  {
    id: "employee_settlement",
    number: "8",
    title: "Rozliczenia pracowników",
    shortTitle: "Pracownicy",
    description: "Godzinówki, zaliczki, potrącenia i wynagrodzenia."
  },
  {
    id: "subcontractor_settlement",
    number: "9",
    title: "Rozliczenia podwykonawców",
    shortTitle: "Podwykonawcy",
    description: "Zakresy wykonane, zaliczki i salda podwykonawców."
  }
];

export const SECTION_BY_ID = new Map(FINANCIAL_CONTROL_SECTIONS.map((s) => [s.id, s]));

export type FinancialControlSource = "manual" | "payment" | "case";

export type FinancialControlReportRow = {
  id: string;
  source: FinancialControlSource;
  itemId: string | null;
  caseId: string | null;
  paymentId: string | null;
  section: FinancialControlSection;
  location: string;
  address: string;
  clientLabel: string;
  title: string;
  scope: string;
  amount: number | null;
  amountLabel: string;
  payer: string;
  statusAction: string;
  conditionLabel: string;
  phone: string;
  termLabel: string;
  crewLabel: string;
  notes: string;
  sortOrder: number;
};

export type FinancialControlReportSection = {
  id: FinancialControlSection;
  number: string;
  title: string;
  shortTitle: string;
  rows: FinancialControlReportRow[];
  total: number;
};

export type FinancialControlReport = {
  asOfDate: string;
  confirmedTotal: number;
  potentialTotal: number;
  cashTotal: number;
  completionTotal: number;
  settlementsTotal: number;
  disputeCount: number;
  scheduledCount: number;
  sections: FinancialControlReportSection[];
  operationalNotes: string[];
};

export type FinancialControlBuildInput = {
  asOfDate: string;
  cases: CaseRow[];
  payments: Payment[];
  crews?: Crew[];
  items: FinancialControlItem[];
  includeEmployeeSettlements?: boolean;
};

function money(value: number): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("pl-PL").format(new Date(`${value}T00:00:00`));
}

function reportDate(value: string): Date {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function dateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function isDateOnlyOnOrBefore(value: string | null | undefined, date: Date): boolean {
  const parsed = dateOnly(value);
  return !parsed || parsed.getTime() <= date.getTime();
}

function isDateOnlyBefore(value: string | null | undefined, date: Date): boolean {
  const parsed = dateOnly(value);
  return !!parsed && parsed.getTime() < date.getTime();
}

function wasCreatedOnOrBefore(value: string | null | undefined, date: Date): boolean {
  if (!value) return true;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.getTime() <= date.getTime();
}

function nonEmpty(...values: (string | null | undefined)[]): string {
  return values.map((v) => v?.trim()).find(Boolean) ?? "";
}

function numeric(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowAmount(row: FinancialControlReportRow): number {
  return Number(row.amount || 0);
}

function buildManualRows(
  items: FinancialControlItem[],
  caseById: Map<string, CaseRow>,
  asOfEnd: Date
): FinancialControlReportRow[] {
  return items
    .filter((i) => i.active)
    .filter((i) => wasCreatedOnOrBefore(i.created_at, asOfEnd))
    .map((item) => {
      const c = item.case_id ? caseById.get(item.case_id) : null;
      const amount = numeric(item.amount);
      const amountLabel = nonEmpty(item.amount_label, amount != null ? money(amount) : "");
      return {
        id: `item:${item.id}`,
        source: "manual",
        itemId: item.id,
        caseId: item.case_id,
        paymentId: item.payment_id,
        section: item.section,
        location: nonEmpty(item.location, c?.location, c?.client_name, "Bez lokalizacji"),
        address: nonEmpty(item.address, c?.location),
        clientLabel: nonEmpty(item.client_label, c?.client_name),
        title: nonEmpty(item.title),
        scope: nonEmpty(item.scope, c?.work_description),
        amount,
        amountLabel,
        payer: nonEmpty(item.payer),
        statusAction: nonEmpty(item.status_action),
        conditionLabel: nonEmpty(item.condition_label),
        phone: nonEmpty(item.phone, c?.phone),
        termLabel: nonEmpty(item.term_label, dateLabel(c?.realization_end_date), dateLabel(c?.next_contact_date)),
        crewLabel: nonEmpty(item.crew_label),
        notes: nonEmpty(item.notes),
        sortOrder: item.sort_order
      };
    });
}

function buildPaymentRows(
  payments: Payment[],
  caseById: Map<string, CaseRow>,
  manualPaymentIds: Set<string>,
  asOfDate: Date,
  asOfEnd: Date
): FinancialControlReportRow[] {
  return payments
    .filter((p) => !manualPaymentIds.has(p.id))
    .filter((p) => wasCreatedOnOrBefore(p.created_at, asOfEnd))
    .filter((p) => isDateOnlyOnOrBefore(p.due_date, asOfDate))
    .map((p) => {
      const due = Number(p.amount_due || 0);
      const paidAt = p.paid_at ? new Date(p.paid_at) : null;
      const paid =
        paidAt && !Number.isNaN(paidAt.getTime()) && paidAt.getTime() > asOfEnd.getTime()
          ? 0
          : Number(p.amount_paid || 0);
      const balance = due - paid;
      return { p, due, paid, balance };
    })
    .filter(({ balance }) => balance > 0.01)
    .map(({ p, due, paid, balance }, index) => {
      const c = caseById.get(p.case_id);
      const isOverdue = isDateOnlyBefore(p.due_date, asOfDate);
      return {
        id: `payment:${p.id}`,
        source: "payment",
        itemId: null,
        caseId: p.case_id,
        paymentId: p.id,
        section: "confirmed_receivable",
        location: nonEmpty(c?.location, c?.client_name, "Sprawa"),
        address: nonEmpty(c?.location),
        clientLabel: nonEmpty(c?.client_name),
        title: p.title,
        scope: nonEmpty(c?.work_description),
        amount: balance,
        amountLabel: money(balance),
        payer: "klient",
        statusAction: isOverdue ? "po terminie - do pilnego kontaktu / wezwania" : "do kontroli terminu płatności",
        conditionLabel: p.due_date ? `termin ${dateLabel(p.due_date)}` : "",
        phone: nonEmpty(c?.phone),
        termLabel: dateLabel(p.due_date),
        crewLabel: "",
        notes: paid > 0 ? `Zapłacono dotąd ${money(paid)} z ${money(due)}.` : "",
        sortOrder: 10_000 + index
      } satisfies FinancialControlReportRow;
    });
}

function buildScheduledRows(
  cases: CaseRow[],
  crews: Crew[],
  manualCaseIds: Set<string>,
  asOfEnd: Date
): FinancialControlReportRow[] {
  const crewById = new Map(crews.map((c) => [c.id, c.name]));
  const scheduledStatuses = new Set(["umowa do podpisu", "zaliczka do wpłaty", "termin zarezerwowany", "realizacja", "odbiór"]);
  return cases
    .filter((c) => !manualCaseIds.has(c.id))
    .filter((c) => wasCreatedOnOrBefore(c.created_at, asOfEnd))
    .filter((c) => scheduledStatuses.has(c.status))
    .map((c, index) => ({
      id: `case:${c.id}`,
      source: "case",
      itemId: null,
      caseId: c.id,
      paymentId: null,
      section: "scheduled_build",
      location: nonEmpty(c.location, c.client_name),
      address: nonEmpty(c.location),
      clientLabel: c.client_name,
      title: c.status,
      scope: c.work_description,
      amount: numeric(c.estimated_value),
      amountLabel: c.estimated_value != null ? money(Number(c.estimated_value)) : "",
      payer: "",
      statusAction: c.status === "odbiór" ? "dopilnować protokołu i rozliczenia końcowego" : "potwierdzić termin, zakres i wejście ekipy",
      conditionLabel: "",
      phone: nonEmpty(c.phone),
      termLabel: nonEmpty(dateLabel(c.realization_end_date), dateLabel(c.next_contact_date), "do ustalenia"),
      crewLabel: c.crew_id ? crewById.get(c.crew_id) ?? "do ustalenia" : "do ustalenia",
      notes: "",
      sortOrder: 20_000 + index
    }));
}

export function buildFinancialControlReport(input: FinancialControlBuildInput): FinancialControlReport {
  const asOfDate = reportDate(input.asOfDate);
  const asOfEnd = endOfDay(asOfDate);
  const caseById = new Map(input.cases.map((c) => [c.id, c]));
  const manualRows = buildManualRows(input.items, caseById, asOfEnd);
  const manualPaymentIds = new Set(manualRows.map((r) => r.paymentId).filter((id): id is string => !!id));
  const manualScheduledCaseIds = new Set(
    manualRows.filter((r) => r.section === "scheduled_build").map((r) => r.caseId).filter((id): id is string => !!id)
  );

  const rows = [
    ...manualRows,
    ...buildPaymentRows(input.payments, caseById, manualPaymentIds, asOfDate, asOfEnd),
    ...buildScheduledRows(input.cases, input.crews ?? [], manualScheduledCaseIds, asOfEnd)
  ];

  const sectionDefinitions = input.includeEmployeeSettlements === false
    ? FINANCIAL_CONTROL_SECTIONS.filter((section) => section.id !== "employee_settlement")
    : FINANCIAL_CONTROL_SECTIONS;
  const sections: FinancialControlReportSection[] = sectionDefinitions.map((section) => {
    const sectionRows = rows
      .filter((r) => r.section === section.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.location.localeCompare(b.location, "pl"));
    return {
      id: section.id,
      number: section.number,
      title: section.title,
      shortTitle: section.shortTitle,
      rows: sectionRows,
      total: sectionRows.reduce((sum, row) => sum + rowAmount(row), 0)
    };
  });

  const totalOf = (id: FinancialControlSection) => sections.find((s) => s.id === id)?.total ?? 0;
  const countOf = (id: FinancialControlSection) => sections.find((s) => s.id === id)?.rows.length ?? 0;
  const settlementsTotal =
    totalOf("crew_settlement") + totalOf("employee_settlement") + totalOf("subcontractor_settlement");

  return {
    asOfDate: input.asOfDate,
    confirmedTotal: totalOf("confirmed_receivable"),
    potentialTotal: totalOf("potential_scope"),
    cashTotal: totalOf("cash_outside_transfer"),
    completionTotal: totalOf("completion_receivable"),
    settlementsTotal,
    disputeCount: countOf("dispute"),
    scheduledCount: countOf("scheduled_build"),
    sections,
    operationalNotes: [
      "Kwoty automatyczne z płatności pokazują saldo: należność minus zapłacono.",
      "Pozycje ręczne służą do gotówki, zakresów warunkowych, sporów i notatek właścicielskich.",
      "Do każdej budowy przed wejściem ekipy: potwierdzić termin, prąd/wodę, zakres materiałowy, składowanie, rusztowanie, kontener, płatność startową i osobę do odbioru etapowego."
    ]
  };
}

export function formatFinancialMoney(value: number): string {
  return money(value);
}
