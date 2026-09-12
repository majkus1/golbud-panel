import { describe, expect, it } from "vitest";
import { complianceStateFromDate, employeeCompliance, summarizeCompliance, type ComplianceDocument, type ComplianceEmployee } from "./employee-compliance";

const TODAY = "2026-09-12";

function emp(overrides: Partial<ComplianceEmployee> = {}): ComplianceEmployee {
  return { id: "e1", active: true, bhp_valid_until: null, medical_valid_until: null, ...overrides };
}

function doc(overrides: Partial<ComplianceDocument> = {}): ComplianceDocument {
  return { employee_id: "e1", document_type: "bhp", status: "active", valid_until: "2027-01-01", ...overrides };
}

describe("complianceStateFromDate", () => {
  it("brak daty to brak danych, nie przeterminowanie", () => {
    expect(complianceStateFromDate(null, TODAY)).toBe("missing");
  });

  it("rozróżnia po terminie, wygasa i aktualne", () => {
    expect(complianceStateFromDate("2026-09-11", TODAY)).toBe("expired");
    expect(complianceStateFromDate("2026-09-12", TODAY)).toBe("expiring");
    expect(complianceStateFromDate("2026-10-12", TODAY)).toBe("expiring");
    expect(complianceStateFromDate("2026-10-13", TODAY)).toBe("ok");
  });
});

describe("employeeCompliance", () => {
  it("bierze datę z profilu, gdy nie ma dokumentu — tak liczyła Struktura firmy", () => {
    const c = employeeCompliance(emp({ bhp_valid_until: "2027-03-01" }), [], TODAY);
    expect(c.bhp).toBe("ok");
    expect(c.medical).toBe("missing");
  });

  it("bierze datę z dokumentu, gdy nie ma jej w profilu — tak liczyły Kadry", () => {
    const c = employeeCompliance(emp(), [doc({ document_type: "medical", valid_until: "2026-09-20" })], TODAY);
    expect(c.medical).toBe("expiring");
  });

  it("gdy są oba źródła, liczy się późniejsza data", () => {
    // Profil ma starą datę, w dokumentach jest nowe szkolenie — osoba jest w porządku.
    const c = employeeCompliance(emp({ bhp_valid_until: "2026-01-01" }), [doc({ valid_until: "2027-06-01" })], TODAY);
    expect(c.bhp).toBe("ok");
    expect(c.bhpValidUntil).toBe("2027-06-01");
  });

  it("pomija dokumenty nieaktywne i cudze", () => {
    const docs = [doc({ status: "archived", valid_until: "2027-06-01" }), doc({ employee_id: "e2", valid_until: "2027-06-01" })];
    expect(employeeCompliance(emp(), docs, TODAY).bhp).toBe("missing");
  });
});

describe("summarizeCompliance", () => {
  it("liczy osobę raz, według najgorszego stanu", () => {
    // Przeterminowane BHP + wygasające badania = jedna osoba „po terminie”, nie dwie pozycje.
    const s = summarizeCompliance(
      [emp({ bhp_valid_until: "2026-01-01", medical_valid_until: "2026-09-20" })],
      [],
      TODAY
    );
    expect(s.expired).toBe(1);
    expect(s.expiring).toBe(0);
    expect(s.missing).toBe(0);
    expect(s.bhp.expired).toBe(1);
    expect(s.medical.expiring).toBe(1);
  });

  it("nie liczy pracowników archiwalnych", () => {
    const s = summarizeCompliance([emp({ active: false })], [], TODAY);
    expect(s.missing).toBe(0);
  });

  it("daje ten sam wynik dla Kadr i Struktury, bo oba źródła są uwzględnione", () => {
    const employees = [
      emp({ id: "a", bhp_valid_until: "2027-01-01", medical_valid_until: "2027-01-01" }),
      emp({ id: "b" }),
      emp({ id: "c", bhp_valid_until: "2026-05-01" })
    ];
    const docs = [doc({ employee_id: "c", document_type: "medical", valid_until: "2027-01-01" })];
    const s = summarizeCompliance(employees, docs, TODAY);
    expect(s).toMatchObject({ expiring: 0, expired: 1, missing: 1 });
  });
});
