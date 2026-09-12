import { CASE_SOURCES, CASE_STATUSES } from "@/lib/domain";
import type { CaseRow, CaseSource, CaseStatus, Payment } from "@/lib/types";

export const WON_STATUSES: CaseStatus[] = [
  "termin zarezerwowany",
  "realizacja",
  "odbiór",
  "rozliczone"
];

export type SourceMetrics = {
  source: CaseSource;
  total: number;
  won: number;
  value: number;
  conversion: number;
};

export type StatusMetrics = {
  status: CaseStatus;
  count: number;
};

export type PaymentsSummary = {
  due: number;
  paid: number;
  overdue: number;
  collectionRate: number;
};

export type ReportMetrics = {
  periodLabel: string;
  from: string;
  to: string;
  inquiries: number;
  offered: number;
  won: number;
  lost: number;
  offeredValue: number;
  wonValue: number;
  conversionOfferToWon: number;
  conversionInquiryToWon: number;
  avgWonValue: number;
  bySource: SourceMetrics[];
  byStatus: StatusMetrics[];
  activeStatuses: StatusMetrics[];
  payments: PaymentsSummary;
  funnel: { label: string; value: number }[];
};

export function defaultReportFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}

export function defaultReportTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatPeriodDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("pl-PL").format(new Date(`${value}T00:00:00`));
}

export function buildPeriodLabel(from: string, to: string): string {
  return `Okres: ${formatPeriodDate(from) || "od początku"} – ${formatPeriodDate(to) || "do dziś"}`;
}

export function computeReportMetrics(
  cases: CaseRow[],
  payments: Payment[],
  from: string,
  to: string
): ReportMetrics {
  const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : 0;
  const toTs = to ? new Date(`${to}T23:59:59`).getTime() : Date.now();

  const inRange = cases.filter((c) => {
    const t = new Date(c.created_at).getTime();
    return t >= fromTs && t <= toTs;
  });

  const offeredStatuses: CaseStatus[] = [
    "wycena wysłana",
    "do decyzji klienta",
    "umowa do podpisu",
    "zaliczka do wpłaty",
    ...WON_STATUSES,
    "utracone"
  ];

  const offered = inRange.filter((c) => offeredStatuses.includes(c.status));
  const won = inRange.filter((c) => WON_STATUSES.includes(c.status));
  const lost = inRange.filter((c) => c.status === "utracone");

  const offeredValue = offered.reduce((s, c) => s + Number(c.estimated_value || 0), 0);
  const wonValue = won.reduce((s, c) => s + Number(c.estimated_value || 0), 0);

  const conversionOfferToWon = offered.length === 0 ? 0 : (won.length / offered.length) * 100;
  const conversionInquiryToWon = inRange.length === 0 ? 0 : (won.length / inRange.length) * 100;
  const avgWonValue = won.length === 0 ? 0 : wonValue / won.length;

  const bySource: SourceMetrics[] = CASE_SOURCES.map((source) => {
    const rows = inRange.filter((c) => c.source === source);
    const wonRows = rows.filter((c) => WON_STATUSES.includes(c.status));
    const value = wonRows.reduce((s, c) => s + Number(c.estimated_value || 0), 0);
    const total = rows.length;
    return {
      source,
      total,
      won: wonRows.length,
      value,
      conversion: total === 0 ? 0 : (wonRows.length / total) * 100
    };
  });

  const byStatus: StatusMetrics[] = CASE_STATUSES.map((status) => ({
    status,
    count: inRange.filter((c) => c.status === status).length
  }));

  const activeStatuses = byStatus.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);

  const due = payments.reduce((s, p) => s + Number(p.amount_due || 0), 0);
  const paid = payments.reduce((s, p) => s + Number(p.amount_paid || 0), 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = payments
    .filter(
      (p) =>
        p.due_date &&
        Number(p.amount_paid) < Number(p.amount_due) &&
        new Date(`${p.due_date}T00:00:00`) <= today
    )
    .reduce((s, p) => s + (Number(p.amount_due) - Number(p.amount_paid)), 0);

  return {
    periodLabel: buildPeriodLabel(from, to),
    from,
    to,
    inquiries: inRange.length,
    offered: offered.length,
    won: won.length,
    lost: lost.length,
    offeredValue,
    wonValue,
    conversionOfferToWon,
    conversionInquiryToWon,
    avgWonValue,
    bySource,
    byStatus,
    activeStatuses,
    payments: {
      due,
      paid,
      overdue,
      collectionRate: due === 0 ? 0 : (paid / due) * 100
    },
    funnel: [
      { label: "Zapytania", value: inRange.length },
      { label: "Oferty wysłane", value: offered.length },
      { label: "Wygrane", value: won.length },
      { label: "Utracone", value: lost.length }
    ]
  };
}

export function formatReportMoney(value: number): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatReportPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
