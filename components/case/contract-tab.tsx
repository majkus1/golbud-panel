"use client";

import { useEffect, useMemo, useState } from "react";
import { DateInput } from "@/components/date-input";
import { showToast } from "@/components/toast";
import { AttachmentList } from "@/components/case/attachment-list";
import { DocumentsSection } from "@/components/case/documents-section";
import { supabase } from "@/lib/supabase";
import type { Attachment, CaseRow, ExtraWork, OfferLine, OfferVariant, Payment } from "@/lib/types";

const CONTRACT_CATEGORIES = ["umowa", "aneks"] as const;

/**
 * Zakładka Umowa — wszystko o umowie w jednym miejscu: dane umowy, podpisane skany,
 * umowy i aneksy wygenerowane z wzoru. Wcześniej umowa była w trzech miejscach
 * (krok 3 wyceny, Dokumenty, Pliki), a numer i datę wpisywało się w formularzu sprawy.
 */
export function ContractTab({
  caseId,
  organizationId,
  userId,
  caseRow,
  payments,
  attachments,
  variants,
  linesByVariant,
  selectedVariantId,
  extras,
  onChange
}: {
  caseId: string;
  organizationId: string;
  userId: string;
  caseRow: CaseRow;
  payments: Payment[];
  attachments: Attachment[];
  variants: OfferVariant[];
  linesByVariant: Record<string, OfferLine[]>;
  selectedVariantId: string | null;
  extras: ExtraWork[];
  onChange: () => Promise<void>;
}) {
  const files = useMemo(
    () => attachments.filter((a) => (CONTRACT_CATEGORIES as readonly string[]).includes(a.category)),
    [attachments]
  );

  return (
    <div className="grid min-w-0 gap-4">
      <ContractDetails caseRow={caseRow} onSaved={onChange} />

      <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-base font-bold text-ink">Umowy i aneksy w sprawie</h2>
        <p className="mt-0.5 text-xs text-steel">
          Podpisane skany i dokumenty zapisane z wzoru. Oznaczenie „z wzoru” to PDF przygotowany w programie, bez podpisów.
        </p>
        <div className="mt-3">
          <AttachmentList
            caseId={caseId}
            organizationId={organizationId}
            userId={userId}
            items={files}
            uploadCategories={[...CONTRACT_CATEGORIES]}
            uploadLabel="Dodaj podpisaną umowę lub aneks — przeciągnij skan albo kliknij"
            emptyText="Nie ma jeszcze umowy w tej sprawie. Przygotuj ją z wzoru poniżej albo dodaj podpisany skan."
            onChange={onChange}
          />
        </div>
      </section>

      <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
        <DocumentsSection
          caseId={caseId}
          organizationId={organizationId}
          userId={userId}
          caseRow={caseRow}
          payments={payments}
          onChange={onChange}
          categories={[...CONTRACT_CATEGORIES]}
          variants={variants}
          linesByVariant={linesByVariant}
          defaultVariantId={selectedVariantId}
          extras={extras}
          heading="Przygotuj umowę lub aneks z naszego wzoru"
          intro="Treść uzupełnia się danymi klienta i sprawy. Sprawdź ją, popraw w razie potrzeby i zapisz PDF — trafi na listę powyżej."
        />
      </section>
    </div>
  );
}

/** Numer, data i terminy umowy — zapisywane w samej sprawie, więc widzą je też raporty i kosztorys powykonawczy. */
function ContractDetails({ caseRow, onSaved }: { caseRow: CaseRow; onSaved: () => Promise<void> }) {
  const [number, setNumber] = useState(caseRow.contract_number || "");
  const [date, setDate] = useState(caseRow.contract_date || "");
  const [start, setStart] = useState(caseRow.planned_start_date || "");
  const [end, setEnd] = useState(caseRow.realization_end_date || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNumber(caseRow.contract_number || "");
    setDate(caseRow.contract_date || "");
    setStart(caseRow.planned_start_date || "");
    setEnd(caseRow.realization_end_date || "");
  }, [caseRow.contract_number, caseRow.contract_date, caseRow.planned_start_date, caseRow.realization_end_date]);

  const dirty =
    number !== (caseRow.contract_number || "") ||
    date !== (caseRow.contract_date || "") ||
    start !== (caseRow.planned_start_date || "") ||
    end !== (caseRow.realization_end_date || "");

  const save = async () => {
    if (start && end && start > end) {
      showToast("Planowane rozpoczęcie jest później niż zakończenie", "error");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("cases")
      .update({
        contract_number: number.trim() || null,
        contract_date: date || null,
        planned_start_date: start || null,
        realization_end_date: end || null
      })
      .eq("id", caseRow.id);
    setSaving(false);
    if (error) {
      showToast("Nie udało się zapisać danych umowy", "error");
      return;
    }
    showToast("Zapisano dane umowy");
    await onSaved();
  };

  return (
    <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
      <h2 className="text-base font-bold text-ink">Dane umowy</h2>
      <p className="mt-0.5 text-xs text-steel">Wpisz raz — trafią do dokumentów z wzoru, kosztorysu powykonawczego i harmonogramu.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs font-semibold text-ink">
          Numer umowy
          <input className="input font-normal" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="np. 12/2026" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink">
          Data zawarcia
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink">
          Planowane rozpoczęcie
          <DateInput value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink">
          Planowane zakończenie
          <DateInput value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !dirty}
        className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50"
      >
        {saving ? "Zapisywanie…" : dirty ? "Zapisz dane umowy" : "Zapisane"}
      </button>
    </section>
  );
}
