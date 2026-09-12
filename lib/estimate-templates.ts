import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstimateImportDraft, EstimateTemplateLine, ImportedEstimateLine, OfferLine } from "@/lib/types";

/** Zamienia pozycje szablonu na kształt używany przez istniejący mechanizm importu kosztorysu. */
export function templateLinesToImported(lines: EstimateTemplateLine[]): ImportedEstimateLine[] {
  return lines.map((line) => ({
    section: line.section,
    name: line.label,
    unit: line.unit,
    quantity: Number(line.quantity),
    unitRate: Number(line.unit_rate)
  }));
}

/** Buduje draft kosztorysu (jak po imporcie pliku) z pozycji szablonu — do kroku "Kosztorys" przy nowym zleceniu. */
export function estimateDraftFromTemplate(templateName: string, lines: EstimateTemplateLine[]): EstimateImportDraft {
  const imported = templateLinesToImported(lines);
  return {
    sourceLabel: `Szablon: ${templateName}`,
    headerInfo: `${imported.length} pozycji z szablonu.`,
    lines: imported,
    include: imported.map(() => true)
  };
}

/** Kopiuje bieżące pozycje wariantu oferty do nowego, reużywalnego szablonu. */
export async function saveOfferLinesAsTemplate(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string | null,
  name: string,
  lines: OfferLine[]
): Promise<{ ok: true; templateId: string } | { ok: false; error: string }> {
  if (lines.length === 0) return { ok: false, error: "Ten wariant nie ma jeszcze żadnych pozycji do zapisania." };
  const { data: template, error: templateError } = await supabase
    .from("estimate_templates")
    .insert({ organization_id: organizationId, name: name.trim(), created_by: userId })
    .select("id")
    .single();
  if (templateError || !template) {
    return { ok: false, error: templateError?.message || "Nie udało się utworzyć szablonu" };
  }
  const payload = lines.map((line, idx) => ({
    organization_id: organizationId,
    template_id: template.id,
    section: line.section,
    label: line.label,
    unit: line.unit,
    quantity: line.quantity,
    unit_rate: line.unit_rate,
    sort_order: idx * 10
  }));
  const { error: linesError } = await supabase.from("estimate_template_lines").insert(payload);
  if (linesError) {
    await supabase.from("estimate_templates").delete().eq("id", template.id);
    return { ok: false, error: linesError.message };
  }
  return { ok: true, templateId: template.id as string };
}
