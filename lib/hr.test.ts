import { describe, expect, it } from "vitest";
import { employmentPeriodLabel, isEmployedOn } from "@/lib/hr";

describe("okres zatrudnienia", () => {
  it("sprawdza dzień względem dat od–do (brak daty nie ogranicza)", () => {
    const p = { employment_start_date: "2026-03-01", employment_end_date: "2026-12-31" };
    expect(isEmployedOn(p, "2026-02-28")).toBe(false);
    expect(isEmployedOn(p, "2026-03-01")).toBe(true);
    expect(isEmployedOn(p, "2026-12-31")).toBe(true);
    expect(isEmployedOn(p, "2027-01-01")).toBe(false);
    expect(isEmployedOn({}, "2030-01-01")).toBe(true);
  });

  it("opisuje okres po polsku", () => {
    expect(employmentPeriodLabel("2026-03-01", "2026-12-31")).toBe("od 01.03.2026 do 31.12.2026");
    expect(employmentPeriodLabel("2026-03-01", null)).toBe("od 01.03.2026 (bezterminowo)");
    expect(employmentPeriodLabel(null, "2026-12-31")).toBe("do 31.12.2026");
    expect(employmentPeriodLabel(null, null)).toBe("nie podano");
  });
});
