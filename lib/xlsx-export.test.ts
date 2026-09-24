import { describe, expect, it } from "vitest";
import { toExcelDate } from "@/lib/xlsx-export";

describe("daty w eksporcie do Excela", () => {
  it("zamienia ISO i zapis polski na daty (UTC, bez przesunięcia dnia)", () => {
    expect(toExcelDate("2026-09-24")?.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(toExcelDate("2026-09-24T21:15:00+00:00")?.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(toExcelDate("5.08.2026")?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("puste pole zamiast tekstu dla braku daty i bzdur", () => {
    expect(toExcelDate("Nie ustawiono")).toBeNull();
    expect(toExcelDate("")).toBeNull();
    expect(toExcelDate(null)).toBeNull();
    expect(toExcelDate("2026-02-31")).toBeNull();
  });
});
