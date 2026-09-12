"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { DateInput } from "@/components/date-input";
import { AuthGate } from "@/components/auth-gate";
import { InfoTip } from "@/components/info-tip";
import { showToast } from "@/components/toast";
import { useOrg } from "@/components/org-context";
import { downloadAuthenticatedPdf } from "@/lib/download-authenticated-pdf";
import { currency, formatDate } from "@/lib/format";
import {
  computeReportMetrics,
  defaultReportFrom,
  defaultReportTo
} from "@/lib/reports-metrics";
import { downloadXlsx } from "@/lib/xlsx-export";
import { supabase } from "@/lib/supabase";
import type { CaseRow, Payment } from "@/lib/types";

const REPORT_HELP = {
  period: "Filtr dotyczy spraw według daty wpłynięcia zapytania. Nie ogranicza podsumowania płatności pokazanego niżej.",
  inquiries: "Liczba spraw i zapytań utworzonych w wybranym okresie.",
  offered: "Sprawy, które doszły co najmniej do etapu wysłanej wyceny, decyzji klienta, umowy albo dalszej realizacji.",
  won: "Sprawy z terminem zarezerwowanym, w realizacji, odbiorze albo już rozliczone.",
  lost: "Sprawy oznaczone jako utracone w wybranym okresie.",
  offeredValue: "Suma szacowanych wartości spraw, które doszły co najmniej do etapu ofertowego.",
  wonValue: "Suma szacowanych wartości spraw uznanych za wygrane.",
  offerConversion: "Liczba wygranych spraw podzielona przez liczbę spraw, które doszły do etapu ofertowego.",
  inquiryConversion: "Liczba wygranych spraw podzielona przez wszystkie zapytania z wybranego okresu.",
  paymentsDue: "Suma kwot wymaganych w całym harmonogramie płatności, niezależnie od filtra dat zapytań.",
  paymentsPaid: "Suma wpłat zapisanych w całym harmonogramie płatności.",
  paymentsOverdue: "Niezapłacona część pozycji harmonogramu, których termin przypada dziś lub już minął."
} as const;

export default function ReportsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <Reports />
        </AppShell>
      )}
    </AuthGate>
  );
}

function Reports() {
  const { organizationId } = useOrg();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [from, setFrom] = useState(defaultReportFrom);
  const [to, setTo] = useState(defaultReportTo);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from("case_records").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      supabase.from("payments").select("*").eq("organization_id", organizationId)
    ]);
    setCases((c || []) as CaseRow[]);
    setPayments((p || []) as Payment[]);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(() => computeReportMetrics(cases, payments, from, to), [cases, payments, from, to]);

  const stats = [
    { label: "Zapytania", value: metrics.inquiries, help: REPORT_HELP.inquiries },
    { label: "Oferty wysłane", value: metrics.offered, help: REPORT_HELP.offered },
    { label: "Wygrane", value: metrics.won, help: REPORT_HELP.won },
    { label: "Utracone", value: metrics.lost, help: REPORT_HELP.lost },
    { label: "Wartość ofert", value: currency.format(metrics.offeredValue), help: REPORT_HELP.offeredValue },
    { label: "Wartość wygranych", value: currency.format(metrics.wonValue), help: REPORT_HELP.wonValue },
    { label: "Konwersja oferty na wygraną", value: `${metrics.conversionOfferToWon.toFixed(1)}%`, help: REPORT_HELP.offerConversion },
    { label: "Konwersja zapytań na wygraną", value: `${metrics.conversionInquiryToWon.toFixed(1)}%`, help: REPORT_HELP.inquiryConversion }
  ];

  const exportCases = () => {
    void downloadXlsx(`golbud-sprawy-${from || "od-poczatku"}-${to || "do-dzis"}.xlsx`, [
      {
        name: "Sprawy",
        title: "Sprawy / zapytania",
        subtitle: metrics.periodLabel,
        totalsLabel: "RAZEM",
        columns: [
          { header: "Data wpłynięcia", type: "date" },
          { header: "Klient", type: "text" },
          { header: "Telefon", type: "text" },
          { header: "Email", type: "text" },
          { header: "Lokalizacja", type: "text" },
          { header: "Opis", type: "text" },
          { header: "Źródło", type: "text" },
          { header: "Status", type: "text" },
          { header: "Wartość szacowana", type: "currency", total: true },
          { header: "Kolejny kontakt", type: "date" },
          { header: "Planowany koniec", type: "date" }
        ],
        rows: cases
          .filter((c) => {
            const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : 0;
            const toTs = to ? new Date(`${to}T23:59:59`).getTime() : Date.now();
            const t = new Date(c.created_at).getTime();
            return t >= fromTs && t <= toTs;
          })
          .map((c) => [
            formatDate(c.created_at.slice(0, 10)),
            c.client_name,
            c.phone || "",
            c.email || "",
            c.location || "",
            c.work_description,
            c.source,
            c.status,
            c.estimated_value != null ? Number(c.estimated_value) : null,
            formatDate(c.next_contact_date),
            formatDate(c.realization_end_date)
          ])
      }
    ]);
  };

  const exportPayments = () => {
    const caseById = new Map(cases.map((c) => [c.id, c]));
    void downloadXlsx(`golbud-platnosci-${from || "od-poczatku"}-${to || "do-dzis"}.xlsx`, [
      {
        name: "Płatności",
        title: "Płatności",
        subtitle: metrics.periodLabel,
        totalsLabel: "RAZEM",
        columns: [
          { header: "Klient", type: "text" },
          { header: "Tytuł", type: "text" },
          { header: "Termin", type: "date" },
          { header: "Należność", type: "currency", total: true },
          { header: "Zapłacono", type: "currency", total: true },
          { header: "Saldo", type: "currency", total: true },
          { header: "Zapłacono dnia", type: "date" }
        ],
        rows: payments.map((p) => {
          const c = caseById.get(p.case_id);
          const balance = Number(p.amount_due) - Number(p.amount_paid);
          return [
            c?.client_name || "",
            p.title,
            formatDate(p.due_date),
            Number(p.amount_due),
            Number(p.amount_paid),
            balance,
            p.paid_at ? formatDate(p.paid_at.slice(0, 10)) : ""
          ];
        })
      }
    ]);
  };

  const exportPdf = async () => {
    if (!organizationId) return;
    setPdfBusy(true);
    try {
      const qs = new URLSearchParams({
        organizationId,
        ...(from ? { from } : {}),
        ...(to ? { to } : {})
      });
      await downloadAuthenticatedPdf(`/api/reports/pdf?${qs.toString()}`, `golbud-raport-${from || "od-poczatku"}-${to || "do-dzis"}`);
      showToast("Raport PDF pobrany");
    } finally {
      setPdfBusy(false);
    }
  };

  if (!organizationId) return null;

  return (
    <div className="grid min-w-0 max-w-full gap-5">
      <div className="min-w-0 max-w-full">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Raporty</p>
        <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">Skuteczność sprzedaży i realizacji</h1>
        <p className="mt-1 text-sm text-steel">
          Filtruj po dacie wpłynięcia zapytania. Eksport do Excela (.xlsx) lub profesjonalnego raportu PDF z wykresami i podsumowaniem.
        </p>
      </div>

      <section className="grid min-w-0 max-w-full gap-3 rounded-lg bg-white p-4 shadow-panel">
        <div className="rounded-lg border border-moss/20 bg-moss/5 p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-ink">Rejestr należności i harmonogram budów</p>
                <p className="mt-1 text-xs text-steel">
                  Raport właścicielski jak dokument GOLBUD: należności, gotówka, spory, kwoty warunkowe, budowy do wykonania i rozrachunki.
                </p>
              </div>
              <Link
                href="/reports/financial-control"
                className="inline-flex justify-center rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss"
              >
                Otwórz rejestr
              </Link>
            </div>
            <div className="flex flex-col gap-3 border-t border-moss/15 pt-4 sm:flex-row sm:items-center sm:justify-between lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
              <div>
                <p className="text-sm font-bold text-ink">Rentowność budów</p>
                <p className="mt-1 text-xs text-steel">
                  Materiały, robocizna, podwykonawcy, koszty dodatkowe, zysk i marża przy każdej sprawie.
                </p>
              </div>
              <Link
                href="/reports/profitability"
                className="inline-flex justify-center rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink"
              >
                Otwórz rentowność
              </Link>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <p className="text-xs font-semibold text-steel">Okres analizy zapytań</p>
          <InfoTip text={REPORT_HELP.period} />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-steel">
            Od
            <DateInput className="min-w-0" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-steel">
            Do
            <DateInput className="min-w-0" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="grid min-w-0 gap-2 sm:flex sm:flex-wrap">
          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={pdfBusy || loading}
            className="w-full rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-moss disabled:opacity-60 sm:w-auto"
          >
            {pdfBusy ? "Generowanie PDF…" : "Generuj raport PDF"}
          </button>
          <button type="button" onClick={exportCases} className="w-full rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-ink hover:bg-stone-50 sm:w-auto">
            Eksport spraw (Excel)
          </button>
          <button type="button" onClick={exportPayments} className="w-full rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-ink hover:bg-stone-50 sm:w-auto">
            Eksport płatności (Excel)
          </button>
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-steel">Wczytywanie...</p>
      ) : (
        <>
          <section className="grid min-w-0 max-w-full gap-3 md:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0 rounded-lg bg-white p-4 shadow-panel">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-xs leading-5 text-steel">{s.label}</p>
                  <InfoTip text={s.help} />
                </div>
                <p className="mt-1 text-xl font-bold text-ink">{s.value}</p>
              </div>
            ))}
          </section>

          <section className="grid min-w-0 max-w-full gap-4 md:grid-cols-2">
            <div className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
              <h2 className="text-lg font-bold text-ink">Źródła zapytań</h2>
              <div className="overflow-x-auto">
                <table className="mt-3 w-full min-w-[340px] text-sm">
                  <thead className="text-xs uppercase text-steel">
                    <tr>
                      <th className="py-2 text-left">Źródło</th>
                      <th className="py-2 text-right">Zapytania</th>
                      <th className="py-2 text-right">Wygrane</th>
                      <th className="py-2 text-right">Wartość</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {metrics.bySource.map((e) => (
                      <tr key={e.source}>
                        <td className="py-2">{e.source}</td>
                        <td className="py-2 text-right">{e.total}</td>
                        <td className="py-2 text-right">{e.won}</td>
                        <td className="py-2 text-right">{e.value > 0 ? currency.format(e.value) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
              <h2 className="text-lg font-bold text-ink">Statusy spraw</h2>
              <div className="overflow-x-auto">
                <table className="mt-3 w-full text-sm">
                  <thead className="text-xs uppercase text-steel">
                    <tr>
                      <th className="py-2 text-left">Status</th>
                      <th className="py-2 text-right">Liczba</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {metrics.byStatus.map((row) => (
                      <tr key={row.status}>
                        <td className="py-2">{row.status}</td>
                        <td className="py-2 text-right">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="min-w-0 max-w-full rounded-lg bg-white p-4 shadow-panel sm:p-5">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 break-words text-lg font-bold text-ink">Płatności (cały okres)</h2>
              <InfoTip text="Ta sekcja celowo pokazuje cały harmonogram płatności firmy i nie jest ograniczana filtrem dat zapytań powyżej." />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <div className="flex items-center gap-2"><p className="text-xs text-steel">Należności łącznie</p><InfoTip text={REPORT_HELP.paymentsDue} /></div>
                <p className="text-lg font-bold text-ink">{currency.format(metrics.payments.due)}</p>
              </div>
              <div>
                <div className="flex items-center gap-2"><p className="text-xs text-steel">Zapłacone</p><InfoTip text={REPORT_HELP.paymentsPaid} /></div>
                <p className="text-lg font-bold text-emerald-700">{currency.format(metrics.payments.paid)}</p>
              </div>
              <div>
                <div className="flex items-center gap-2"><p className="text-xs text-steel">Zaległe (po terminie)</p><InfoTip text={REPORT_HELP.paymentsOverdue} /></div>
                <p className="text-lg font-bold text-amber-700">{currency.format(metrics.payments.overdue)}</p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
