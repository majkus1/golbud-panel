import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportedEstimateLine } from "@/lib/types";

/** Wstawia zaimportowane pozycje do wariantu oferty. */
export async function insertImportedOfferLines(
  supabase: SupabaseClient,
  organizationId: string,
  variantId: string,
  lines: ImportedEstimateLine[],
  baseSortOrder = 0
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (lines.length === 0) return { ok: true, count: 0 };
  const payload = lines.map((line, idx) => ({
    organization_id: organizationId,
    variant_id: variantId,
    section: line.section,
    label: line.name,
    unit: line.unit,
    quantity: line.quantity,
    unit_rate: line.unitRate,
    sort_order: baseSortOrder + idx
  }));
  const { error } = await supabase.from("offer_lines").insert(payload);
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: lines.length };
}
