import { describe, expect, it } from "vitest";
import { invoiceCostParts, validateCostSplit } from "@/lib/supplier-invoice-categories";
import type { SupplierInvoiceCategory } from "@/lib/types";

describe("podział faktury „materiały i robocizna”", () => {
  it("jedna podana część — druga to reszta brutto", () => {
    expect(validateCostSplit(12300, 8000, null)).toEqual({ ok: true, material: 8000, labor: 4300 });
    expect(validateCostSplit(12300, null, 4300.5)).toEqual({ ok: true, material: 7999.5, labor: 4300.5 });
  });

  it("obie części muszą dać brutto co do grosza", () => {
    expect(validateCostSplit(1000, 600, 400)).toEqual({ ok: true, material: 600, labor: 400 });
    const bad = validateCostSplit(1000, 600, 300);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/900,00 zł.*1000,00 zł/);
  });

  it("odrzuca brak podziału, ujemne kwoty i część większą niż brutto", () => {
    expect(validateCostSplit(1000, null, null).ok).toBe(false);
    expect(validateCostSplit(1000, -1, null).ok).toBe(false);
    expect(validateCostSplit(1000, 1200, null).ok).toBe(false);
    expect(validateCostSplit(0, 10, null).ok).toBe(false);
  });
});

describe("koszt faktury w rentowności", () => {
  const inv = (category: SupplierInvoiceCategory, gross: number, material: number | null = null, labor: number | null = null) => ({
    category,
    gross_total: gross,
    material_gross: material,
    labor_gross: labor
  });

  it("dzieli fakturę mieszaną według zapisanych kwot", () => {
    expect(invoiceCostParts(inv("materialy_robocizna", 10000, 6500, 3500))).toEqual({ material: 6500, labor: 3500 });
    expect(invoiceCostParts(inv("materialy_robocizna", 10000, null, 3500))).toEqual({ material: 6500, labor: 3500 });
  });

  it("mieszana bez podziału w całości w materiałach; pozostałe kategorie bez zmian", () => {
    expect(invoiceCostParts(inv("materialy_robocizna", 10000))).toEqual({ material: 10000, labor: 0 });
    expect(invoiceCostParts(inv("materialy", 500))).toEqual({ material: 500, labor: 0 });
    expect(invoiceCostParts(inv("robocizna", 700))).toEqual({ material: 0, labor: 700 });
    expect(invoiceCostParts(inv("transport", 300))).toEqual({ material: 0, labor: 0 });
  });
});
