import type { SupplierInvoice, SupplierInvoiceCategory } from "@/lib/types";

/**
 * Kategorie faktur kosztowych — jedna lista dla karty zlecenia (Koszty), Rentowności
 * i importu. „Materiały i robocizna” to faktura, na której firma rozlicza oba rodzaje
 * kosztu (np. ekipa z własnym materiałem): podajemy, ile z brutto to materiały, a ile
 * robocizna, i tak to trafia do rentowności.
 */
export const SUPPLIER_INVOICE_CATEGORIES: { id: SupplierInvoiceCategory; label: string }[] = [
  { id: "materialy", label: "Materiały" },
  { id: "robocizna", label: "Robocizna / usługi" },
  { id: "materialy_robocizna", label: "Materiały i robocizna" },
  { id: "sprzet", label: "Sprzęt" },
  { id: "transport", label: "Transport" },
  { id: "podwykonawca", label: "Podwykonawca" },
  { id: "inne", label: "Inne" }
];

export function supplierInvoiceCategoryLabel(value: string): string {
  return SUPPLIER_INVOICE_CATEGORIES.find((c) => c.id === value)?.label || value;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export type CostSplitResult = { ok: true; material: number; labor: number } | { ok: false; error: string };

/**
 * Podział brutto faktury „materiały i robocizna”. Wystarczy podać jedną część —
 * druga to reszta do kwoty brutto. Obie podane muszą się sumować do brutto (co do grosza).
 */
export function validateCostSplit(gross: number, material: number | null, labor: number | null): CostSplitResult {
  if (!(gross > 0)) return { ok: false, error: "Podaj kwotę brutto faktury." };
  if (material === null && labor === null) return { ok: false, error: "Podaj, ile z kwoty brutto to materiały, a ile robocizna." };
  if ((material !== null && material < 0) || (labor !== null && labor < 0)) return { ok: false, error: "Kwoty materiałów i robocizny nie mogą być ujemne." };
  if (material !== null && labor === null) {
    if (material > gross) return { ok: false, error: "Materiały nie mogą przekraczać kwoty brutto." };
    return { ok: true, material: round2(material), labor: round2(gross - material) };
  }
  if (labor !== null && material === null) {
    if (labor > gross) return { ok: false, error: "Robocizna nie może przekraczać kwoty brutto." };
    return { ok: true, material: round2(gross - labor), labor: round2(labor) };
  }
  const m = material as number;
  const l = labor as number;
  if (Math.abs(m + l - gross) > 0.005) {
    return { ok: false, error: `Materiały i robocizna razem (${formatPl(m + l)} zł) muszą dać kwotę brutto (${formatPl(gross)} zł).` };
  }
  return { ok: true, material: round2(m), labor: round2(l) };
}

function formatPl(value: number): string {
  return value.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Ile z faktury liczy się jako materiały, a ile jako robocizna (do rentowności).
 * Faktura „materiały i robocizna” bez podziału (np. z importu) idzie w całości do materiałów,
 * dopóki ktoś jej nie poprawi — tak jak wcześniej domyślna kategoria importu.
 */
export function invoiceCostParts(invoice: Pick<SupplierInvoice, "category" | "gross_total" | "material_gross" | "labor_gross">): { material: number; labor: number } {
  const gross = Number(invoice.gross_total || 0);
  if (invoice.category === "materialy") return { material: gross, labor: 0 };
  if (invoice.category === "robocizna") return { material: 0, labor: gross };
  if (invoice.category !== "materialy_robocizna") return { material: 0, labor: 0 };
  const material = invoice.material_gross == null ? null : Number(invoice.material_gross);
  const labor = invoice.labor_gross == null ? null : Number(invoice.labor_gross);
  if (material !== null && labor !== null) return { material, labor };
  if (material !== null) return { material, labor: round2(gross - material) };
  if (labor !== null) return { material: round2(gross - labor), labor };
  return { material: gross, labor: 0 };
}
