import { describe, expect, it } from "vitest";
import { buildPdfLines, sumPdfLines } from "./offer-pdf-helpers";
import { groupOfferLines, summarizeOfferLines } from "./offer-sections";
import type { OfferLine } from "./types";

function line(id: string, section: string, total: number): OfferLine {
  return {
    id,
    organization_id: "o",
    variant_id: "v",
    section: section as OfferLine["section"],
    label: `Pozycja ${id}`,
    unit: "m²",
    quantity: 1,
    unit_rate: total,
    line_total: total,
    sort_order: Number(id),
    created_at: ""
  };
}

const lines = [line("1", "labor", 1000), line("2", "mixed", 2500.5), line("3", "material", 300), line("4", "mixed", 199.5)];

describe("summarizeOfferLines", () => {
  it("suma grup równa się sumie wszystkich pozycji", () => {
    const s = summarizeOfferLines(lines);
    expect(s.bySection).toEqual({ labor: 1000, material: 300, mixed: 2700 });
    expect(s.total).toBe(4000);
    expect(s.bySection.labor + s.bySection.material + s.bySection.mixed).toBe(s.total);
  });

  it("pozycja o nieznanym rodzaju nie znika z sumy", () => {
    const s = summarizeOfferLines([line("1", "cokolwiek", 50), line("2", "labor", 50)]);
    expect(s.total).toBe(100);
    expect(s.bySection.material).toBe(50);
  });
});

describe("groupOfferLines", () => {
  it("grupuje w stałej kolejności i pomija puste grupy", () => {
    expect(groupOfferLines(lines).map((g) => [g.section, g.lines.map((l) => l.id)])).toEqual([
      ["labor", ["1"]],
      ["material", ["3"]],
      ["mixed", ["2", "4"]]
    ]);
    expect(groupOfferLines([line("1", "mixed", 10)]).map((g) => g.section)).toEqual(["mixed"]);
  });
});

describe("PDF oferty z pozycjami „materiał i robocizna”", () => {
  it("pozycje mieszane są w PDF i w sumie", () => {
    const pdf = buildPdfLines(lines, 8);
    expect(pdf.filter((l) => l.isSectionHeader).map((l) => l.label)).toEqual(["Robocizna", "Materiał", "Materiał i robocizna"]);
    expect(pdf.filter((l) => !l.isSectionHeader).map((l) => l.lp)).toEqual([1, 2, 3, 4]);
    expect(sumPdfLines(pdf).net).toBe(4000);
    expect(sumPdfLines(pdf).gross).toBe(4320);
  });
});
