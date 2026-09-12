"use client";

import { useEffect, useState } from "react";
import { EstimatePreviewTable } from "@/components/case/estimate-import-panel";
import { showToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { estimateDraftFromTemplate, templateLinesToImported } from "@/lib/estimate-templates";
import { insertImportedOfferLines } from "@/lib/offer-lines";
import { supabase } from "@/lib/supabase";
import type { EstimateImportDraft, EstimateTemplate, EstimateTemplateLine, ImportedEstimateLine } from "@/lib/types";

type DraftMode = {
  mode: "draft";
  draft: EstimateImportDraft | null;
  onDraftChange: (draft: EstimateImportDraft | null) => void;
};

type PersistMode = {
  mode: "persist";
  variantId: string;
  baseSortOrder: number;
  onImported: () => Promise<void> | void;
};

type Props = (DraftMode | PersistMode) & {
  organizationId: string;
  /** Pełny panel od razu otwarty (formularz nowego zlecenia). */
  defaultOpen?: boolean;
  /** Ukryj przycisk zwijania — sekcja zawsze widoczna. */
  embedded?: boolean;
};

export function TemplateApplyPanel(props: Props) {
  const { organizationId, defaultOpen = false, embedded = false } = props;
  const [open, setOpen] = useState(defaultOpen || embedded);
  const [templates, setTemplates] = useState<EstimateTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [loadingLines, setLoadingLines] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewName, setPreviewName] = useState("");
  const [previewRows, setPreviewRows] = useState<ImportedEstimateLine[]>([]);
  const [previewInclude, setPreviewInclude] = useState<boolean[]>([]);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("estimate_templates")
      .select("*")
      .eq("organization_id", organizationId)
      .order("sort_order")
      .order("name")
      .then(({ data }) => setTemplates((data || []) as EstimateTemplate[]));
  }, [organizationId, open]);

  const clearPreview = () => {
    setTemplateId("");
    setPreviewName("");
    setPreviewRows([]);
    setPreviewInclude([]);
  };

  const loadTemplateLines = async () => {
    if (!templateId) return;
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setLoadingLines(true);
    const { data, error } = await supabase
      .from("estimate_template_lines")
      .select("*")
      .eq("template_id", templateId)
      .order("sort_order");
    setLoadingLines(false);
    if (error) {
      showToast("Nie udało się wczytać pozycji szablonu", "error");
      return;
    }
    const lines = (data || []) as EstimateTemplateLine[];
    if (lines.length === 0) {
      showToast("Ten szablon nie ma jeszcze żadnych pozycji", "error");
      return;
    }
    if (props.mode === "draft") {
      props.onDraftChange(estimateDraftFromTemplate(template.name, lines));
      clearPreview();
      return;
    }
    setPreviewName(template.name);
    setPreviewRows(templateLinesToImported(lines));
    setPreviewInclude(lines.map(() => true));
  };

  const applyToVariant = async () => {
    if (props.mode !== "persist") return;
    const selected = previewRows.filter((_, i) => previewInclude[i]);
    if (selected.length === 0) {
      showToast("Zaznacz przynajmniej jedną pozycję", "error");
      return;
    }
    setApplying(true);
    try {
      const result = await insertImportedOfferLines(supabase, organizationId, props.variantId, selected, props.baseSortOrder);
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      showToast(`Wstawiono ${result.count} pozycji z szablonu „${previewName}”`, "success");
      clearPreview();
      if (!embedded) setOpen(false);
      await props.onImported();
    } finally {
      setApplying(false);
    }
  };

  if (!open && !embedded) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        block
        className="border-moss/30 bg-moss/10 text-moss-dark hover:bg-moss/20"
        onClick={() => setOpen(true)}
      >
        Zastosuj szablon kosztorysu
      </Button>
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border border-moss/30 bg-moss/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-ink">Zastosuj gotowy szablon kosztorysu</h4>
          <p className="text-xs text-steel">
            Wybierz jeden z zapisanych szablonów — jego pozycje wstawisz jednym kliknięciem, bez ręcznego przepisywania.
            {props.mode === "draft" && " Po utworzeniu zlecenia edytujesz je w zakładce Wycena / oferta."}
          </p>
        </div>
        {!embedded && (
          <button type="button" onClick={() => { clearPreview(); setOpen(false); }} className="text-xs font-semibold text-steel hover:text-ink">
            Zamknij
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <select className="input flex-1" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">{templates.length === 0 ? "— brak zapisanych szablonów —" : "— wybierz szablon —"}</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <Button type="button" size="sm" disabled={!templateId || loadingLines} onClick={() => void loadTemplateLines()} className="shrink-0">
          {loadingLines ? "Wczytywanie…" : "Wczytaj pozycje"}
        </Button>
      </div>

      {templates.length === 0 && (
        <p className="text-xs text-steel">
          Nie masz jeszcze żadnego szablonu. Utwórz go w Ustawieniach → Słowniki → Warianty kosztorysów, albo zapisz istniejącą wycenę jako szablon.
        </p>
      )}

      {props.mode === "persist" && previewRows.length > 0 && (
        <>
          <p className="text-xs font-medium text-moss-dark">Szablon: {previewName} — {previewRows.length} pozycji</p>
          <EstimatePreviewTable rows={previewRows} include={previewInclude} onIncludeChange={setPreviewInclude} onRowsChange={setPreviewRows} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void applyToVariant()} disabled={applying}>
              {applying ? "Wstawianie…" : "Wstaw zaznaczone do wariantu"}
            </Button>
            <span className="text-xs text-steel">{previewInclude.filter(Boolean).length} z {previewRows.length} zaznaczonych</span>
            <button type="button" onClick={clearPreview} className="text-xs font-semibold text-steel hover:text-rose-600">
              Anuluj
            </button>
          </div>
        </>
      )}
    </div>
  );
}
