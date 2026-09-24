import { describe, expect, it } from "vitest";
import { guessSection, normalizeUnit } from "./estimate-import";

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
