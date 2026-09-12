import type { AsBuiltLineSnapshot, OfferLine, Payment } from "@/lib/types";

/** Spójna nazwa modułu — jak w PDF od klienta. */
export const AS_BUILT_ESTIMATE_TITLE = "KOSZTORYS POWYKONAWCZY";
export const AS_BUILT_ESTIMATE_LABEL = "Kosztorys powykonawczy";
/** Skrót w menu na mobile (pełna fraza, nie myli się z „Podwykonawcy”). */
export const AS_BUILT_ESTIMATE_NAV_SHORT = "Kosztorys powyk.";

export const DEFAULT_SETTLEMENT_BASIS =
  "obmiar powykonawczy robót oraz ceny jednostkowe wynikające z umowy i uzgodnionego zakresu prac";

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Format kwoty jak w PDF klienta: 30 000,00 zł */
export function pdfPlMoney(value: number): string {
  return `${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} zł`;
}

/** Cena jednostkowa z jednostką: 300,00 zł/m² */
export function pdfPlUnitRate(value: number, unit: string): string {
  const amount = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const u = unit.trim() || "szt.";
  return `${amount} zł/${u}`;
}

export function buildAsBuiltLineSnapshots(lines: OfferLine[]): AsBuiltLineSnapshot[] {
  return lines.map((line, index) => ({
    lp: index + 1,
    label: line.label,
    quantity: Number(line.quantity) || 0,
    unit: line.unit,
    unit_rate: roundMoney(Number(line.unit_rate) || 0),
    line_total: roundMoney(Number(line.line_total) || 0)
  }));
}

export function sumAsBuiltNet(lines: AsBuiltLineSnapshot[]): number {
  return roundMoney(lines.reduce((s, l) => s + l.line_total, 0));
}

export function sumPaymentsPaid(payments: Payment[]): number {
  return roundMoney(payments.reduce((s, p) => s + Number(p.amount_paid || 0), 0));
}

export function buildDefaultFooterNote(params: {
  location: string | null;
  advancesPaid: number;
}): string {
  const loc = params.location?.trim() || "inwestycji";
  const adv = pdfPlMoney(params.advancesPaid);
  // Wpłaty klienta są kwotami brutto, więc potrącamy je od wartości brutto — nie od netto.
  return (
    `Rozliczenie obejmuje roboty wykonane na inwestycji przy ${loc}. Zgodnie z umową wynagrodzenie końcowe ustalane jest na podstawie faktycznie zrealizowanych robót, obmiarów powykonawczych oraz cen jednostkowych. ` +
    `Ceny jednostkowe i wartości pozycji podano netto; do wartości robót doliczono podatek VAT. Kwota do zapłaty została wyliczona po potrąceniu otrzymanych wpłat w wysokości ${adv} brutto od wartości robót brutto.`
  );
}

export function buildAsBuiltDisplayFileName(clientName: string, createdAt: Date): string {
  const date = createdAt.toISOString().slice(0, 10);
  const client = clientName.trim().slice(0, 60) || "inwestycja";
  return `kosztorys_powykonawczy_${client}_${date}.pdf`;
}

const PL_STORAGE_CHARS: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
  Ą: "A",
  Ć: "C",
  Ę: "E",
  Ł: "L",
  Ń: "N",
  Ó: "O",
  Ś: "S",
  Ź: "Z",
  Ż: "Z"
};

/** Bezpieczna nazwa segmentu ścieżki w Supabase Storage (bez spacji i znaków specjalnych). */
export function sanitizeStorageFileName(name: string): string {
  const ascii = name.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => PL_STORAGE_CHARS[ch] ?? ch);
  return (
    ascii
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || "kosztorys_powykonawczy.pdf"
  );
}

/** @deprecated Użyj buildAsBuiltDisplayFileName + sanitizeStorageFileName */
export function buildAsBuiltFileName(clientName: string, createdAt: Date): string {
  return sanitizeStorageFileName(buildAsBuiltDisplayFileName(clientName, createdAt));
}

export function formatContractDateLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatContractReference(number: string | null | undefined, date: string | null | undefined): string | null {
  const num = number?.trim();
  const dateLabel = formatContractDateLabel(date ?? null);
  if (num && dateLabel) return `Umowa nr ${num} z dnia ${dateLabel} r.`;
  if (num) return `Umowa nr ${num}`;
  if (dateLabel) return `Umowa z dnia ${dateLabel} r.`;
  return null;
}
