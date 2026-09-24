import { OFFER_SECTION_LABELS, groupOfferLines, type OfferSection } from "@/lib/offer-sections";
import type { OfferLine } from "@/lib/types";

export type PdfOfferLine = {
  id: string;
  lp: number;
  label: string;
  quantity: number;
  unit: string;
  unitRateNet: number;
  netTotal: number;
  vatRate: number;
  vatAmount: number;
  grossTotal: number;
  section: OfferSection | null;
  isSectionHeader: boolean;
};

export function formatPlDate(d: Date): string {
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** Numer oferty w stylu Firmao: 2026-05-077-O-A */
export function buildOfferNumber(caseId: string, variantName: string, caseCreatedAt: string): string {
  const created = new Date(caseCreatedAt);
  const y = Number.isFinite(created.getTime()) ? created.getFullYear() : new Date().getFullYear();
  const m = String((Number.isFinite(created.getTime()) ? created : new Date()).getMonth() + 1).padStart(2, "0");
  const digits = caseId.replace(/\D/g, "");
  const seq = String((parseInt(digits.slice(-4) || "1", 10) % 999) + 1).padStart(3, "0");
  const v = (variantName.trim()[0] || "A").toUpperCase().replace(/[^A-Z0-9]/g, "A");
  return `${y}-${m}-${seq}-O-${v}`;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pozycje do tabeli PDF: grupy w stałej kolejności (robocizna, materiał, materiał i robocizna),
 * numeracja ciągła przez wszystkie grupy. Grupowanie w jednym miejscu — wcześniej trasy PDF
 * filtrowały „labor” i „material” same i pozycja innego rodzaju wypadała z oferty.
 */
export function buildPdfLines(lines: OfferLine[], defaultVatRate: number): PdfOfferLine[] {
  const vat = defaultVatRate;
  const out: PdfOfferLine[] = [];
  let lp = 0;

  const pushSection = (title: string, section: OfferSection) => {
    out.push({
      id: `section-${section}`,
      lp: 0,
      label: title,
      quantity: 0,
      unit: "",
      unitRateNet: 0,
      netTotal: 0,
      vatRate: 0,
      vatAmount: 0,
      grossTotal: 0,
      section,
      isSectionHeader: true
    });
  };

  const pushLines = (group: OfferLine[], section: OfferSection) => {
    if (group.length === 0) return;
    pushSection(OFFER_SECTION_LABELS[section], section);
    for (const l of group) {
      lp += 1;
      const net = roundMoney(Number(l.line_total) || 0);
      const vatAmount = roundMoney((net * vat) / 100);
      const gross = roundMoney(net + vatAmount);
      out.push({
        id: l.id,
        lp,
        label: l.label,
        quantity: Number(l.quantity) || 0,
        unit: l.unit,
        unitRateNet: roundMoney(Number(l.unit_rate) || 0),
        netTotal: net,
        vatRate: vat,
        vatAmount,
        grossTotal: gross,
        section,
        isSectionHeader: false
      });
    }
  };

  for (const group of groupOfferLines(lines)) pushLines(group.lines, group.section);
  return out;
}

export function sumPdfLines(lines: PdfOfferLine[]) {
  const items = lines.filter((l) => !l.isSectionHeader);
  const net = roundMoney(items.reduce((s, l) => s + l.netTotal, 0));
  const vat = roundMoney(items.reduce((s, l) => s + l.vatAmount, 0));
  const gross = roundMoney(items.reduce((s, l) => s + l.grossTotal, 0));
  return { net, vat, gross };
}
