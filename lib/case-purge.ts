/**
 * Trwałe usunięcie sprawy z kosza. Baza kasuje razem ze sprawą warianty, płatności,
 * harmonogram, zadania, pliki i faktury sprzedaży (kaskada). Dokumentów księgowych nie
 * wolno stracić po cichu, więc usunięcie jest blokowane, gdy sprawa ma:
 *  - fakturę sprzedaży inną niż szkic (wystawiona, opłacona, anulowana — wszystkie są w ewidencji),
 *  - fakturę kosztową (zostałaby bez sprawy i bez skanu, który leży w plikach sprawy).
 */

export type PurgeInput = {
  salesInvoices: { number: string | null; status: string }[];
  supplierInvoices: { invoice_number: string | null; supplier_name: string | null }[];
};

export function purgeBlockers({ salesInvoices, supplierInvoices }: PurgeInput): string[] {
  const blockers: string[] = [];
  const issued = salesInvoices.filter((inv) => inv.status !== "szkic");
  if (issued.length > 0) {
    const numbers = issued.map((inv) => inv.number || "bez numeru").join(", ");
    blockers.push(`Faktury sprzedaży w ewidencji (${numbers}) — faktury nie mogą zniknąć razem ze sprawą.`);
  }
  if (supplierInvoices.length > 0) {
    const list = supplierInvoices
      .slice(0, 5)
      .map((inv) => [inv.supplier_name, inv.invoice_number].filter(Boolean).join(" ") || "bez numeru")
      .join(", ");
    const more = supplierInvoices.length > 5 ? ` i ${supplierInvoices.length - 5} kolejnych` : "";
    blockers.push(`Faktury kosztowe (${list}${more}) — przepnij je do innej sprawy albo usuń w zakładce Koszty.`);
  }
  return blockers;
}

export type PurgeCounts = {
  payments: number;
  attachments: number;
  tasks: number;
  variants: number;
  protocols: number;
  notes: number;
};

/** Opis skutków do okna potwierdzenia: „3 płatności, 12 plików, …”. Puste pozycje pomijamy. */
export function describePurgeCounts(counts: PurgeCounts): string {
  const parts: [number, string, string, string][] = [
    [counts.variants, "wariant wyceny", "warianty wyceny", "wariantów wyceny"],
    [counts.payments, "płatność", "płatności", "płatności"],
    [counts.attachments, "plik", "pliki", "plików"],
    [counts.tasks, "zadanie", "zadania", "zadań"],
    [counts.protocols, "protokół", "protokoły", "protokołów"],
    [counts.notes, "notatka", "notatki", "notatek"]
  ];
  const plural = (n: number, one: string, few: string, many: string) => {
    if (n === 1) return one;
    const mod10 = n % 10;
    const mod100 = n % 100;
    return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  };
  const text = parts.filter(([n]) => n > 0).map(([n, one, few, many]) => `${n} ${plural(n, one, few, many)}`);
  return text.length ? text.join(", ") : "sprawa nie ma powiązanych danych";
}
