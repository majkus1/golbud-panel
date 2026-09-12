/**
 * Netto ↔ brutto w jednym miejscu.
 *
 * Powstało po zgłoszeniu klienta: w umowie kwota z pola „szacowana wartość netto”
 * była opisana jako brutto, a kosztorys powykonawczy odejmował wpłaty brutto od
 * wartości netto. Oba błędy brały się z tego, że każdy dokument liczył VAT po swojemu
 * albo wcale. Teraz jest jedna definicja, z której korzystają umowy, kosztorys
 * powykonawczy i podsumowania.
 */

export type VatBreakdown = {
  net: number;
  vatRate: number;
  vat: number;
  gross: number;
};

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Stawka VAT z ustawień bywa zapisana jako tekst („8”) — normalizujemy do liczby z zakresu 0–100. */
export function normalizeVatRate(value: number | string | null | undefined, fallback = 23): number {
  // `Number(null)` daje 0 — a 0 % to legalna stawka, więc brak wartości trzeba odróżnić jawnie.
  if (value == null || (typeof value === "string" && value.trim() === "")) return fallback;
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fallback;
  return parsed;
}

export function grossFromNet(net: number, vatRate: number): VatBreakdown {
  const safeNet = roundMoney(Number.isFinite(net) ? net : 0);
  const rate = normalizeVatRate(vatRate);
  const vat = roundMoney(safeNet * (rate / 100));
  return { net: safeNet, vatRate: rate, vat, gross: roundMoney(safeNet + vat) };
}

export type SettlementBalance = VatBreakdown & {
  /** Suma faktycznie otrzymanych wpłat — zawsze brutto, bo klient płaci kwoty brutto. */
  paid: number;
  /** Pozostało do zapłaty brutto; nie schodzi poniżej zera. */
  balanceGross: number;
  /** Nadpłata, gdy wpłaty przekroczyły wartość brutto. */
  overpaid: number;
};

/**
 * Rozliczenie: wartość netto robót → brutto → minus wpłaty → saldo brutto.
 *
 * Wpłaty klienta są brutto (tyle realnie przelał), więc wolno je odejmować wyłącznie
 * od wartości brutto. Odejmowanie ich od netto zaniżało kwotę do zapłaty o cały VAT.
 */
export function settleAgainstPayments(net: number, vatRate: number, paid: number): SettlementBalance {
  const breakdown = grossFromNet(net, vatRate);
  const safePaid = roundMoney(Math.max(0, Number.isFinite(paid) ? paid : 0));
  const diff = roundMoney(breakdown.gross - safePaid);
  return {
    ...breakdown,
    paid: safePaid,
    balanceGross: Math.max(0, diff),
    overpaid: Math.max(0, roundMoney(-diff))
  };
}

const plMoney = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatPlMoney(value: number): string {
  return `${plMoney.format(roundMoney(value))} zł`;
}

/**
 * Zapis kwoty do treści umowy: „12 000,00 zł netto, tj. 12 960,00 zł brutto (VAT 8 %)”.
 * Pusta wartość zwraca pusty napis — szablon sam wstawi wielokropek.
 */
export function describeNetGross(net: number | null | undefined, vatRate: number): string {
  if (net == null || !Number.isFinite(net) || net <= 0) return "";
  const b = grossFromNet(net, vatRate);
  return `${formatPlMoney(b.net)} netto, tj. ${formatPlMoney(b.gross)} brutto (VAT ${b.vatRate} %)`;
}
