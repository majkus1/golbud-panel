import { describe, expect, it } from "vitest";
import { guessSection, normalizeAiEstimateRows, normalizeUnit } from "./estimate-import";

describe("guessSection — rodzaj pozycji z pliku kosztorysu", () => {
  it("rozpoznaje pozycje z materiałem i robocizną, zanim zadziała samo słowo „robocizna”", () => {
    for (const raw of ["Materiał i robocizna", "materiał + robocizna", "robocizna z materiałem", "z materiałem", "mat. + rob.", "Kompleksowo"]) {
      expect(guessSection(raw), raw).toBe("mixed");
    }
  });

  it("nadal rozpoznaje zwykłą robociznę i materiał", () => {
    expect(guessSection("Robocizna")).toBe("labor");
    expect(guessSection("montaż")).toBe("labor");
    expect(guessSection("Materiał")).toBe("material");
    expect(guessSection("")).toBeNull();
    expect(guessSection("inne")).toBeNull();
  });
});

describe("normalizeUnit — nowe jednostki", () => {
  it("m³, kg, t i godz. nie zamieniają się już w sztuki", () => {
    expect(normalizeUnit("m3")).toBe("m³");
    expect(normalizeUnit("m³")).toBe("m³");
    expect(normalizeUnit("kg")).toBe("kg");
    expect(normalizeUnit("t")).toBe("t");
    expect(normalizeUnit("tona")).toBe("t");
    expect(normalizeUnit("godz.")).toBe("godz.");
  });

  it("dotychczasowe jednostki bez zmian", () => {
    expect(normalizeUnit("m2")).toBe("m²");
    expect(normalizeUnit("m")).toBe("mb");
    expect(normalizeUnit("r-g")).toBe("roboczogodz.");
    expect(normalizeUnit("")).toBe("szt.");
  });
});

describe("normalizeAiEstimateRows — pozycje odczytane przez AI z PDF", () => {
  it("zamienia odpowiedź modelu na pozycje oferty i pomija wiersze sum", () => {
    const result = normalizeAiEstimateRows({
      pozycje: [
        { nazwa: "Docieplenie ścian styropianem 15 cm", jednostka: "m2", ilosc: "245,5", cena_netto: "189,00", rodzaj: "materiał i robocizna" },
        { Nazwa: "Rusztowanie", jednostka: "m²", ilość: 300, cena_netto: 0, wartosc_netto: "4 500,00", rodzaj: "robocizna" },
        { nazwa: "Razem netto", wartosc_netto: 50899.5 },
        { nazwa: "", ilosc: 1 }
      ]
    });
    expect(result.lines).toEqual([
      { section: "mixed", name: "Docieplenie ścian styropianem 15 cm", unit: "m²", quantity: 245.5, unitRate: 189 },
      { section: "labor", name: "Rusztowanie", unit: "m²", quantity: 300, unitRate: 15 }
    ]);
    expect(result.skippedRows).toBe(2);
  });

  it("nie wywraca się na odpowiedzi, która nie jest listą", () => {
    expect(normalizeAiEstimateRows("brak").lines).toEqual([]);
    expect(normalizeAiEstimateRows(null).lines).toEqual([]);
  });
});
