"use client";

import { DateInput } from "@/components/date-input";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { showToast } from "@/components/toast";
import {
  AS_BUILT_ESTIMATE_LABEL,
  AS_BUILT_ESTIMATE_NAV_SHORT,
  AS_BUILT_ESTIMATE_TITLE,
  buildDefaultFooterNote,
  buildAsBuiltLineSnapshots,
  DEFAULT_SETTLEMENT_BASIS,
  sumAsBuiltNet,
  sumPaymentsPaid
} from "@/lib/as-built-estimate";
import { postAuthenticatedJson } from "@/lib/authed-fetch";
import { downloadAuthenticatedPdf } from "@/lib/download-authenticated-pdf";
import { formatDateTime, formatMoney } from "@/lib/format";
import { normalizeVatRate, settleAgainstPayments } from "@/lib/money-vat";
import { supabase } from "@/lib/supabase";
import type { CaseAsBuiltEstimate, CaseRow, OfferLine, OfferVariant, Payment } from "@/lib/types";

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:opacity-60";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50 disabled:opacity-60";

type GenerateResponse = {
  id: string;
  fileName: string;
  createdAt: string;
  netTotal: number;
  advancesPaid: number;
  balanceDue: number;
  lineCount: number;
};

type Props = {
  caseId: string;
  caseRow: CaseRow;
  variants: OfferVariant[];
  linesByVariant: Record<string, OfferLine[]>;
  payments: Payment[];
  showFinances: boolean;
  estimates: CaseAsBuiltEstimate[];
  initialVariantId: string | null;
  onChange: () => Promise<void>;
  compact?: boolean;
};

export function AsBuiltEstimatesSection({
  caseId,
  caseRow,
  variants,
  linesByVariant,
  payments,
  showFinances,
  estimates,
  initialVariantId,
  onChange,
  compact = false
}: Props) {
  const defaultVariant = initialVariantId || variants[0]?.id || "";
  const [variantId, setVariantId] = useState(defaultVariant);
  const [contractNumber, setContractNumber] = useState(caseRow.contract_number || "");
  const [contractDate, setContractDate] = useState(caseRow.contract_date || "");
  const [pdfWorkDescription, setPdfWorkDescription] = useState(caseRow.work_description || "");
  const [settlementBasis, setSettlementBasis] = useState(DEFAULT_SETTLEMENT_BASIS);
  const [footerNote, setFooterNote] = useState("");
  const [advancesPaid, setAdvancesPaid] = useState("");
  const [saveContractToCase, setSaveContractToCase] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setContractNumber(caseRow.contract_number || "");
    setContractDate(caseRow.contract_date || "");
    setPdfWorkDescription(caseRow.work_description || "");
  }, [caseRow.contract_number, caseRow.contract_date, caseRow.work_description, caseRow.id]);

  useEffect(() => {
    if (defaultVariant && !variantId) setVariantId(defaultVariant);
  }, [defaultVariant, variantId]);

  const selectedLines = variantId ? linesByVariant[variantId] || [] : [];
  const snapshots = useMemo(() => buildAsBuiltLineSnapshots(selectedLines), [selectedLines]);
  const netPreview = useMemo(() => sumAsBuiltNet(snapshots), [snapshots]);
  const autoAdvances = useMemo(() => (showFinances ? sumPaymentsPaid(payments) : 0), [payments, showFinances]);
  const advancesPreview = useMemo(() => {
    if (advancesPaid.trim() !== "") {
      const n = Number(advancesPaid);
      return Number.isFinite(n) ? Math.max(0, n) : autoAdvances;
    }
    return autoAdvances;
  }, [advancesPaid, autoAdvances]);
  // Stawka VAT z ustawień firmy — podgląd ma liczyć tak samo jak PDF: wpłaty klienta są brutto,
  // więc potrącamy je od wartości brutto. Wcześniej podgląd i dokument odejmowały je od netto.
  const [vatRate, setVatRate] = useState<number>(23);
  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("organizations")
      .select("offer_default_vat_rate")
      .eq("id", caseRow.organization_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setVatRate(normalizeVatRate(data?.offer_default_vat_rate));
      });
    return () => {
      cancelled = true;
    };
  }, [caseRow.organization_id]);
  const settlement = useMemo(() => settleAgainstPayments(netPreview, vatRate, advancesPreview), [netPreview, vatRate, advancesPreview]);

  useEffect(() => {
    setFooterNote((prev) => (prev.trim() ? prev : buildDefaultFooterNote({ location: caseRow.location, advancesPaid: advancesPreview })));
  }, [caseRow.location, advancesPreview]);

  const refreshFooter = useCallback(() => {
    setFooterNote(buildDefaultFooterNote({ location: caseRow.location, advancesPaid: advancesPreview }));
  }, [caseRow.location, advancesPreview]);

  const generate = async () => {
    if (!variantId) {
      showToast("Wybierz wariant kosztorysu", "error");
      return;
    }
    if (selectedLines.length === 0) {
      showToast("Brak pozycji — uzupełnij kosztorys w zakładce Wycena / oferta", "error");
      return;
    }

    setGenerating(true);
    const payload = {
      variantId,
      contractNumber: contractNumber.trim() || null,
      contractDate: contractDate.trim() || null,
      pdfWorkDescription: pdfWorkDescription.trim() || null,
      settlementBasis: settlementBasis.trim() || null,
      footerNote: footerNote.trim() || null,
      advancesPaid: advancesPaid.trim() !== "" ? Number(advancesPaid) : null,
      saveContractToCase
    };

    const res = await postAuthenticatedJson<GenerateResponse>(`/api/cases/${caseId}/as-built-estimates`, payload);
    setGenerating(false);

    if (!res.ok) {
      showToast(res.error, "error");
      return;
    }

    const downloaded = await downloadAuthenticatedPdf(
      `/api/cases/${caseId}/as-built-estimates/${res.data.id}/pdf`,
      res.data.fileName
    );
    await onChange();
    if (downloaded) {
      showToast(`Wygenerowano ${AS_BUILT_ESTIMATE_LABEL.toLowerCase()}`);
    } else {
      showToast("Zapisano w historii — użyj „Pobierz ponownie” poniżej.", "error");
    }
  };

  const downloadExisting = async (row: CaseAsBuiltEstimate) => {
    setDownloadingId(row.id);
    await downloadAuthenticatedPdf(`/api/cases/${caseId}/as-built-estimates/${row.id}/pdf`, row.file_name);
    setDownloadingId(null);
  };

  const formBlock = (
    <div className="grid gap-4">
      {!compact && (
        <div className="rounded-xl2 border border-moss/25 bg-gradient-to-br from-moss/10 via-white to-stone-50 p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-moss-dark">{AS_BUILT_ESTIMATE_TITLE}</p>
          <h2 className="mt-1 text-lg font-bold text-ink sm:text-xl">{AS_BUILT_ESTIMATE_LABEL}</h2>
          <p className="mt-1 max-w-2xl text-sm text-steel">
            Rozliczenie końcowe wykonanych robót (wartości netto): pozycje, suma, potrącenie zaliczek i kwota do dopłaty. Każde
            wygenerowanie zapisuje PDF w historii poniżej.
          </p>
        </div>
      )}

      {variants.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-amber-200 bg-amber-50/60 p-5 text-sm text-amber-900">
          <p className="font-semibold">Brak wariantu wyceny</p>
          <p className="mt-1 text-amber-800/90">
            Najpierw dodaj wariant i pozycje w{" "}
            <Link href={`/cases/${caseId}?tab=offer`} className="font-semibold underline">
              Wycena / oferta
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:grid-cols-2 sm:p-5">
            <label className="grid gap-1 text-xs font-semibold text-ink sm:col-span-2">
              Wariant kosztorysu (źródło pozycji)
              <select className="input font-normal" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({(linesByVariant[v.id] || []).length} poz.)
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-semibold text-ink">
              Numer umowy
              <input
                className="input font-normal"
                value={contractNumber}
                onChange={(e) => setContractNumber(e.target.value)}
                placeholder="np. 01/05"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Data umowy
              <DateInput className="input font-normal" value={contractDate} onChange={(e) => setContractDate(e.target.value)} />
            </label>

            <label className="flex items-center gap-2 text-sm font-medium text-ink sm:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-moss"
                checked={saveContractToCase}
                onChange={(e) => setSaveContractToCase(e.target.checked)}
              />
              Zapisz numer i datę umowy na karcie sprawy
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            <div className="rounded-xl2 border border-stone-200 bg-stone-50/80 p-3">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-steel">Pozycje</p>
              <p className="mt-0.5 text-lg font-bold text-ink">{snapshots.length}</p>
            </div>
            <div className="rounded-xl2 border border-moss/30 bg-moss/10 p-3">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-moss-dark">Robót netto</p>
              <p className="mt-0.5 text-lg font-bold text-moss-dark">{formatMoney(netPreview)}</p>
            </div>
            <div className="rounded-xl2 border border-moss/30 bg-moss/10 p-3">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-moss-dark">Brutto (VAT {settlement.vatRate} %)</p>
              <p className="mt-0.5 text-lg font-bold text-moss-dark">{formatMoney(settlement.gross)}</p>
            </div>
            <div className="rounded-xl2 border border-sky-200/70 bg-sky-50/60 p-3">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-sky-700">Otrzymane wpłaty</p>
              <p className="mt-0.5 text-lg font-bold text-sky-800">{formatMoney(advancesPreview)}</p>
              {!showFinances && (
                <p className="mt-0.5 text-[0.65rem] text-sky-700/80">Uzupełnij ręcznie poniżej</p>
              )}
            </div>
            <div className="rounded-xl2 border border-amber-200/80 bg-amber-50/70 p-3">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-amber-800">Do zapłaty brutto</p>
              <p className="mt-0.5 text-lg font-bold text-amber-900">{formatMoney(settlement.balanceGross)}</p>
              {settlement.overpaid > 0 && (
                <p className="mt-0.5 text-[0.65rem] text-amber-800/80">nadpłata {formatMoney(settlement.overpaid)}</p>
              )}
            </div>
          </div>

          <div className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center justify-between text-left text-sm font-semibold text-ink"
            >
              <span>Ustawienia zaawansowane</span>
              <span className="text-steel">{showAdvanced ? "▴" : "▾"}</span>
            </button>

            {showAdvanced && (
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-xs font-semibold text-ink">
                  Otrzymane wpłaty (brutto)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input font-normal"
                    value={advancesPaid}
                    onChange={(e) => setAdvancesPaid(e.target.value)}
                    placeholder={showFinances ? `Auto: ${autoAdvances}` : "Kwota wpłaconych zaliczek"}
                  />
                  {showFinances && (
                    <span className="text-[0.7rem] font-normal text-steel">
                      Domyślnie suma wpłat z zakładki Płatności ({formatMoney(autoAdvances)}).
                    </span>
                  )}
                </label>

                <label className="grid gap-1 text-xs font-semibold text-ink">
                  Tekst pod nagłówkiem PDF
                  <textarea
                    className="input min-h-20 font-normal leading-relaxed"
                    value={pdfWorkDescription}
                    onChange={(e) => setPdfWorkDescription(e.target.value)}
                    placeholder="np. elewacyjnych i towarzyszących"
                  />
                  <span className="text-[0.7rem] font-normal text-steel">
                    Domyślnie z pola „Zakres prac” w zleceniu. Zmiana dotyczy tylko tego PDF.
                  </span>
                </label>

                <label className="grid gap-1 text-xs font-semibold text-ink">
                  Podstawa rozliczenia
                  <textarea
                    className="input min-h-16 font-normal"
                    value={settlementBasis}
                    onChange={(e) => setSettlementBasis(e.target.value)}
                  />
                </label>

                <label className="grid gap-1 text-xs font-semibold text-ink">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    Uwagi na dole dokumentu
                    <button
                      type="button"
                      onClick={refreshFooter}
                      className="rounded-md border border-stone-300 px-2 py-0.5 text-[0.7rem] font-medium text-steel hover:bg-stone-50"
                    >
                      ↺ odśwież szablon
                    </button>
                  </span>
                  <textarea className="input min-h-24 font-normal leading-relaxed" value={footerNote} onChange={(e) => setFooterNote(e.target.value)} />
                </label>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" onClick={() => void generate()} disabled={generating || selectedLines.length === 0} className={btnPrimary}>
              {generating ? "Generowanie…" : "Generuj i pobierz PDF"}
            </button>
            <Link href={`/cases/${caseId}?tab=offer`} className={`${btnSecondary} text-center`}>
              Edytuj pozycje kosztorysu
            </Link>
          </div>
        </>
      )}
    </div>
  );

  const historyBlock = !compact && (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-ink">Historia wygenerowanych</h3>
        <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-steel">{estimates.length}</span>
      </div>

      {estimates.length === 0 ? (
        <p className="rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-sm text-steel">
          Jeszcze nie wygenerowano {AS_BUILT_ESTIMATE_LABEL.toLowerCase()} dla tej sprawy.
        </p>
      ) : (
        <div className="grid gap-2.5">
          {estimates.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-3 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{row.file_name}</p>
                <p className="mt-0.5 text-xs text-steel">
                  {formatDateTime(row.created_at)}
                  {row.variant_name ? ` · ${row.variant_name}` : ""}
                  {row.line_count ? ` · ${row.line_count} poz.` : ""}
                </p>
                <p className="mt-1 text-xs font-medium text-moss-dark">
                  Netto {formatMoney(Number(row.net_total))}
                  {row.gross_total != null ? ` · brutto ${formatMoney(Number(row.gross_total))}` : ""}
                  {Number(row.advances_paid) > 0 ? ` · wpłaty ${formatMoney(Number(row.advances_paid))}` : ""}
                  {row.balance_due_gross != null
                    ? ` · do zapłaty brutto ${formatMoney(Number(row.balance_due_gross))}`
                    : ` · do dopłaty netto ${formatMoney(Number(row.balance_due))}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void downloadExisting(row)}
                disabled={downloadingId === row.id}
                className={`${btnSecondary} w-full sm:w-auto`}
              >
                {downloadingId === row.id ? "Pobieranie…" : "Pobierz ponownie"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (compact) {
    return <div className="grid gap-3">{formBlock}</div>;
  }

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      {formBlock}
      {historyBlock}
    </section>
  );
}
