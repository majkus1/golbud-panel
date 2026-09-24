"use client";

import { useState } from "react";
import { DropZone } from "@/components/drop-zone";
import { useOrg } from "@/components/org-context";
import { showToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { postAuthenticatedForm } from "@/lib/authed-fetch";
import type { EstimateImportDraft, ImportedEstimateLine } from "@/lib/types";
import { parseEstimateFile } from "@/lib/estimate-import";
import { OFFER_SECTIONS, OFFER_SECTION_SHORT, type OfferSection } from "@/lib/offer-sections";
import { supabase } from "@/lib/supabase";
import { insertImportedOfferLines } from "@/lib/offer-lines";

type DraftMode = {
  mode: "draft";
  draft: EstimateImportDraft | null;
  onDraftChange: (draft: EstimateImportDraft | null) => void;
};

type PersistMode = {
  mode: "persist";
  variantId: string;
  organizationId: string;
  baseSortOrder: number;
  onImported: () => Promise<void> | void;
};

type Props = (DraftMode | PersistMode) & {
  /** Pełny panel od razu otwarty (formularz nowego zlecenia). */
  defaultOpen?: boolean;
  /** Ukryj przycisk zwijania — sekcja zawsze widoczna. */
  embedded?: boolean;
};

export function EstimatePreviewTable({
  rows,
  include,
  onIncludeChange,
  onRowsChange
}: {
  rows: ImportedEstimateLine[];
  include: boolean[];
  onIncludeChange: (next: boolean[]) => void;
  onRowsChange: (next: ImportedEstimateLine[]) => void;
}) {
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-stone-200">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="sticky top-0 bg-white text-xs uppercase text-steel">
          <tr>
            <th className="p-2">Importuj</th>
            <th className="p-2">Nazwa</th>
            <th className="p-2">Sekcja</th>
            <th className="p-2">J.m.</th>
            <th className="p-2">Ilość</th>
            <th className="p-2">Cena netto</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((line, i) => (
            <tr key={`${line.name}-${i}`} className={include[i] ? "" : "opacity-40"}>
              <td className="p-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={include[i]}
                  onChange={(e) =>
                    onIncludeChange(include.map((v, idx) => (idx === i ? e.target.checked : v)))
                  }
                />
              </td>
              <td className="p-2 text-ink">{line.name}</td>
              <td className="p-2">
                <select
                  className="input py-1 text-xs"
                  value={line.section}
                  onChange={(e) =>
                    onRowsChange(
                      rows.map((r, idx) =>
                        idx === i ? { ...r, section: e.target.value as OfferSection } : r
                      )
                    )
                  }
                >
                  {OFFER_SECTIONS.map((sec) => (
                    <option key={sec} value={sec}>{OFFER_SECTION_SHORT[sec]}</option>
                  ))}
                </select>
              </td>
              <td className="p-2 text-steel">{line.unit}</td>
              <td className="p-2 text-steel">{line.quantity}</td>
              <td className="p-2 text-steel">{line.unitRate.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ParsedEstimate = { lines: ImportedEstimateLine[]; headerInfo: string; sourceLabel: string };

/** PDF i zdjęcia czyta AI na serwerze; CSV i Excel — przeglądarka, bez AI. */
function needsAi(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") || file.type.startsWith("image/");
}

const ACCEPTED_FILES = ".csv,.txt,.xlsx,.xls,.pdf,image/jpeg,image/png,image/webp,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function EstimateImportPanel(props: Props) {
  const { defaultOpen = false, embedded = false } = props;
  const { organizationId } = useOrg();
  const [open, setOpen] = useState(defaultOpen || embedded);
  const [parsing, setParsing] = useState<null | "file" | "ai">(null);
  const [importing, setImporting] = useState(false);

  const isDraft = props.mode === "draft";
  const rows = isDraft ? props.draft?.lines ?? [] : [];
  const include = isDraft ? props.draft?.include ?? [] : [];

  // Stan lokalny tylko dla trybu persist (istniejąca oferta).
  const [persistRows, setPersistRows] = useState<ImportedEstimateLine[]>([]);
  const [persistInclude, setPersistInclude] = useState<boolean[]>([]);
  const [persistHeader, setPersistHeader] = useState("");

  const setLocalPersist = (parsed: { lines: ImportedEstimateLine[]; headerInfo: string; sourceLabel: string }) => {
    setPersistRows(parsed.lines);
    setPersistInclude(parsed.lines.map(() => true));
    setPersistHeader(`${parsed.sourceLabel}: ${parsed.headerInfo}`);
    setOpen(true);
  };

  const readWithAi = async (file: File): Promise<ParsedEstimate> => {
    if (!organizationId) throw new Error("Brak firmy — odśwież stronę");
    const form = new FormData();
    form.append("organizationId", organizationId);
    form.append("file", file);
    const res = await postAuthenticatedForm<ParsedEstimate>("/api/estimate-import", form);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  };

  const handleFile = async (file: File) => {
    const ai = needsAi(file);
    setParsing(ai ? "ai" : "file");
    try {
      const parsed = ai ? await readWithAi(file) : await parseEstimateFile(file);
      if (props.mode === "draft") {
        props.onDraftChange({
          sourceLabel: parsed.sourceLabel,
          headerInfo: parsed.headerInfo,
          lines: parsed.lines,
          include: parsed.lines.map(() => true)
        });
      } else {
        setLocalPersist(parsed);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Nie udało się odczytać pliku", "error");
    } finally {
      setParsing(null);
    }
  };

  const displayRows = isDraft ? rows : persistRows;
  const displayInclude = isDraft ? include : persistInclude;
  const displayHeader = isDraft
    ? props.draft
      ? `${props.draft.sourceLabel}: ${props.draft.headerInfo}`
      : ""
    : persistHeader;

  const updateRows = (next: ImportedEstimateLine[]) => {
    if (isDraft && props.draft) {
      props.onDraftChange({ ...props.draft, lines: next });
    } else {
      setPersistRows(next);
    }
  };

  const updateInclude = (next: boolean[]) => {
    if (isDraft && props.draft) {
      props.onDraftChange({ ...props.draft, include: next });
    } else {
      setPersistInclude(next);
    }
  };

  const clearAll = () => {
    if (isDraft) props.onDraftChange(null);
    else {
      setPersistRows([]);
      setPersistInclude([]);
      setPersistHeader("");
    }
    if (!embedded) setOpen(false);
  };

  const doPersistImport = async () => {
    if (props.mode !== "persist") return;
    const selected = persistRows.filter((_, i) => persistInclude[i]);
    if (selected.length === 0) {
      showToast("Zaznacz przynajmniej jedną pozycję", "error");
      return;
    }
    setImporting(true);
    try {
      const result = await insertImportedOfferLines(
        supabase,
        props.organizationId,
        props.variantId,
        selected,
        props.baseSortOrder
      );
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      showToast(`Zaimportowano ${result.count} pozycji`, "success");
      clearAll();
      await props.onImported();
    } finally {
      setImporting(false);
    }
  };

  if (!open && !embedded) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        block
        className="border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100"
        onClick={() => setOpen(true)}
      >
        Importuj kosztorys (PDF / Excel / CSV)
      </Button>
    );
  }

  const selectedCount = displayInclude.filter(Boolean).length;

  return (
    <div className="grid gap-3 rounded-lg border border-violet-200/80 bg-violet-50/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-ink">Import kosztorysu zewnętrznego</h4>
          <p className="text-xs text-steel">
            Kosztorys od kosztorysanta: Excel lub CSV (kolumny: nazwa, jednostka, ilość, cena, wartość), a także PDF albo zdjęcie —
            te odczytuje AI, więc przed importem sprawdź ilości i ceny.
            {isDraft && " Po utworzeniu zlecenia pozycje trafią do wyceny — tam możesz je edytować."}
          </p>
        </div>
        {!embedded && (
          <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-steel hover:text-ink">
            Zamknij
          </button>
        )}
      </div>

      <DropZone
        onFile={handleFile}
        accept={ACCEPTED_FILES}
        busy={parsing !== null}
        label="Przeciągnij kosztorys tutaj albo kliknij, żeby wybrać"
        hint="PDF, zdjęcie, Excel (XLSX/XLS) lub CSV"
      />

      {parsing === "file" && <p className="text-sm text-steel">Analiza pliku…</p>}
      {parsing === "ai" && <p className="text-sm text-steel">Odczytuję kosztorys z pliku — to może potrwać do minuty…</p>}
      {displayHeader && <p className="text-xs font-medium text-moss">{displayHeader}</p>}

      {displayRows.length > 0 && (
        <>
          <EstimatePreviewTable
            rows={displayRows}
            include={displayInclude}
            onIncludeChange={updateInclude}
            onRowsChange={updateRows}
          />
          <div className="flex flex-wrap items-center gap-2">
            {isDraft ? (
              <>
                <span className="text-xs text-steel">
                  {selectedCount} z {displayRows.length} pozycji trafi do oferty przy zapisie zlecenia
                </span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs font-semibold text-steel hover:text-rose-600"
                >
                  Wyczyść import
                </button>
              </>
            ) : (
              <>
                <Button type="button" onClick={() => void doPersistImport()} disabled={importing}>
                  {importing ? "Importowanie…" : "Importuj zaznaczone do wariantu"}
                </Button>
                <span className="text-xs text-steel">
                  {selectedCount} z {displayRows.length} zaznaczonych
                </span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs font-semibold text-steel hover:text-rose-600"
                >
                  Anuluj
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
