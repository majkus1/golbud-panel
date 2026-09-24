import { describe, expect, it } from "vitest";
import { buildProfitabilitySummary, isCostDataIncomplete } from "./profitability-report";
import type { CaseRow, SupplierInvoice } from "@/lib/types";

describe("isCostDataIncomplete", () => {
  it("przychód bez kosztów to brak danych, nie zysk", () => {
    // Przypadek zgłoszony przez klienta: ponad milion „wyniku” i marża 100 % przy zerowych kosztach.
    expect(isCostDataIncomplete({ revenuePlanned: 1_200_000, totalCost: 0 })).toBe(true);
  });

  it("gdy są jakiekolwiek koszty, raport ma podstawy do oceny", () => {
    expect(isCostDataIncomplete({ revenuePlanned: 1_200_000, totalCost: 15 })).toBe(false);
  });

  it("pusty raport bez przychodów nie jest „niepełny” — po prostu nie ma czego liczyć", () => {
    expect(isCostDataIncomplete({ revenuePlanned: 0, totalCost: 0 })).toBe(false);
  });
});

describe("faktura „materiały i robocizna” w rentowności", () => {
  it("rozdziela kwotę na materiały i robociznę", () => {
    const caseRow = { id: "c1", client_name: "Kowalski", location: "Ożarów", status: "realizacja", estimated_value: 50000 } as unknown as CaseRow;
    const invoice = (over: Partial<SupplierInvoice>) =>
      ({ id: Math.random().toString(36), case_id: "c1", category: "materialy", gross_total: 0, paid_amount: 0, invoice_date: "2026-09-01", ...over }) as SupplierInvoice;
    const summary = buildProfitabilitySummary({
      cases: [caseRow],
      payments: [],
      workHours: [],
      employees: [],
      employeeEntries: [],
      supplierInvoices: [
        invoice({ category: "materialy", gross_total: 1000 }),
        invoice({ category: "materialy_robocizna", gross_total: 10000, material_gross: 6500, labor_gross: 3500 })
      ],
      caseSubcontractors: [],
      subcontractorEntries: [],
      directCosts: []
    });
    const row = summary.rows.find((r) => r.caseId === "c1");
    expect(row?.materialCost).toBe(7500);
    expect(row?.laborCost).toBe(3500);
  });
});
