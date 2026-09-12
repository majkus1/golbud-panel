import type { InvoiceKind } from "@/lib/domain";
import { INVOICE_KIND_PREFIX } from "@/lib/domain";
import type { InvoiceLine } from "@/lib/types";

export function roundMoney(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Wartości pojedynczej pozycji (netto po rabacie, VAT, brutto). */
export function computeInvoiceLine(line: Pick<InvoiceLine, "quantity" | "unit_price_net" | "discount_pct" | "vat_rate">) {
  const qty = Number(line.quantity) || 0;
  const price = Number(line.unit_price_net) || 0;
  const discount = Number(line.discount_pct) || 0;
  const rate = Number(line.vat_rate) || 0;
  const net = roundMoney(qty * price * (1 - discount / 100));
  const vat = roundMoney((net * rate) / 100);
  const gross = roundMoney(net + vat);
  return { net, vat, gross };
}

export type InvoiceTotals = {
  net: number;
  vat: number;
  gross: number;
};

export function summarizeInvoice(lines: InvoiceLine[]): InvoiceTotals {
  let net = 0;
  let vat = 0;
  for (const line of lines) {
    const c = computeInvoiceLine(line);
    net = roundMoney(net + c.net);
    vat = roundMoney(vat + c.vat);
  }
  return { net, vat, gross: roundMoney(net + vat) };
}

export type VatBucket = { rate: number; net: number; vat: number; gross: number };

/** Rozbicie sum wg stawek VAT — wymagane na fakturze i w strukturze KSeF. */
export function vatBreakdown(lines: InvoiceLine[]): VatBucket[] {
  const map = new Map<number, VatBucket>();
  for (const line of lines) {
    const rate = Number(line.vat_rate) || 0;
    const c = computeInvoiceLine(line);
    const bucket = map.get(rate) ?? { rate, net: 0, vat: 0, gross: 0 };
    bucket.net = roundMoney(bucket.net + c.net);
    bucket.vat = roundMoney(bucket.vat + c.vat);
    bucket.gross = roundMoney(bucket.gross + c.gross);
    map.set(rate, bucket);
  }
  return Array.from(map.values()).sort((a, b) => b.rate - a.rate);
}

/** Numer faktury w formacie PREFIX/ROK/NNNN, np. FV/2026/0001. */
export function buildInvoiceNumber(kind: InvoiceKind, seq: number, year: number): string {
  return `${INVOICE_KIND_PREFIX[kind]}/${year}/${String(seq).padStart(4, "0")}`;
}

export type PdfInvoiceLine = {
  id: string;
  lp: number;
  name: string;
  quantity: number;
  unit: string;
  unitPriceNet: number;
  discountPct: number;
  vatRate: number;
  net: number;
  vat: number;
  gross: number;
};

export function buildInvoicePdfLines(lines: InvoiceLine[]): PdfInvoiceLine[] {
  return lines.map((line, index) => {
    const c = computeInvoiceLine(line);
    return {
      id: line.id,
      lp: index + 1,
      name: line.name,
      quantity: Number(line.quantity) || 0,
      unit: line.unit,
      unitPriceNet: roundMoney(Number(line.unit_price_net) || 0),
      discountPct: Number(line.discount_pct) || 0,
      vatRate: Number(line.vat_rate) || 0,
      net: c.net,
      vat: c.vat,
      gross: c.gross
    };
  });
}
