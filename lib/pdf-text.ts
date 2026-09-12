/**
 * Wartości z Supabase (numeric jako string itd.) do @react-pdf/renderer.
 * React #31 = próba wyrenderowania obiektu / elementu jako dziecka <Text>.
 */
export function pdfText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Znaki spoza Inter latin-ext (strzałki, cudzysłowy typograficzne) psują PDF — podmieniamy na bezpieczne. */
export function pdfSafeText(v: unknown): string {
  return pdfText(v)
    .replace(/→/g, " na ")
    .replace(/[—–]/g, "-")
    .replace(/[„”]/g, '"')
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

export function pdfFixed(v: unknown, decimals: number): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return decimals === 2 ? "0.00" : "0";
  return n.toFixed(decimals);
}

/** Zapobiega łamaniu w środku słowa — react-pdf domyślnie tnie dowolnie (np. BUDOWLA|NE). */
export function pdfHyphenation(word: string): string[] {
  return [word];
}
