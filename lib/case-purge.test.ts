import { describe, expect, it } from "vitest";
import { describePurgeCounts, purgeBlockers } from "./case-purge";

describe("purgeBlockers", () => {
  it("szkic faktury nie blokuje, wystawiona i anulowana — tak", () => {
    expect(purgeBlockers({ salesInvoices: [{ number: null, status: "szkic" }], supplierInvoices: [] })).toEqual([]);
    const blockers = purgeBlockers({
      salesInvoices: [
        { number: "FV 1/09/2026", status: "wystawiona" },
        { number: "FV 2/09/2026", status: "anulowana" }
      ],
      supplierInvoices: []
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("FV 1/09/2026, FV 2/09/2026");
  });

  it("faktura kosztowa blokuje z podpowiedzią, co zrobić", () => {
    const blockers = purgeBlockers({ salesInvoices: [], supplierInvoices: [{ invoice_number: "123/2026", supplier_name: "Hurtownia" }] });
    expect(blockers[0]).toContain("Hurtownia 123/2026");
    expect(blockers[0]).toContain("Koszty");
  });
});

describe("describePurgeCounts", () => {
  it("odmienia liczebniki i pomija zera", () => {
    expect(describePurgeCounts({ payments: 3, attachments: 12, tasks: 1, variants: 0, protocols: 5, notes: 22 })).toBe(
      "3 płatności, 12 plików, 1 zadanie, 5 protokołów, 22 notatki"
    );
    expect(describePurgeCounts({ payments: 0, attachments: 0, tasks: 0, variants: 0, protocols: 0, notes: 0 })).toBe(
      "sprawa nie ma powiązanych danych"
    );
  });
});
