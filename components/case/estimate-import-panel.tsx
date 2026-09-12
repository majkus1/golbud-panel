"use client";

import { useRef, useState } from "react";
import { showToast } from "@/components/toast";
import { Button } from "@/components/ui";
import type { EstimateImportDraft, ImportedEstimateLine } from "@/lib/types";
import { parseEstimateFile } from "@/lib/estimate-import";
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
                        idx === i ? { ...r, section: e.target.value as "labor" | "material" } : r
                      )
                    )
                  }
                >
                  <option value="labor">robocizna</option>
                  <option value="material">materiał</option>
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

export function EstimateImportPanel(props: Props) {
  const { defaultOpen = false, embedded = false } = props;
  const [open, setOpen] = useState(defaultOpen || embedded);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const handleFile = async (file: File) => {
    setParsing(true);
    try {
      const parsed = await parseEstimateFile(file);
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
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
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
        Importuj kosztorys (CSV / XLSX)
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
            Wgraj plik od kosztorysanta (CSV/XLSX). Kolumny: nazwa, jednostka, ilość, cena, wartość.
            {isDraft && " Po utworzeniu zlecenia pozycje trafią do wyceny — tam możesz je edytować."}
          </p>
        </div>
        {!embedded && (
          <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-steel hover:text-ink">
            Zamknij
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
        className="block w-full text-sm text-steel file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-moss"
      />

      {parsing && <p className="text-sm text-steel">Analiza pliku…</p>}
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
