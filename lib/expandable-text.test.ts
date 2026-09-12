import { describe, expect, it } from "vitest";
import { clampClass, isTextOverflowing, normalizeText } from "./expandable-text";

describe("clampClass", () => {
  it("przycina do zadanej liczby wierszy, gdy tekst jest zwinięty", () => {
    expect(clampClass(2, false)).toBe("line-clamp-2");
    expect(clampClass(3, false)).toBe("line-clamp-3");
    expect(clampClass(4, false)).toBe("line-clamp-4");
  });

  it("nie przycina niczego po rozwinięciu", () => {
    expect(clampClass(2, true)).toBe("");
    expect(clampClass(4, true)).toBe("");
  });
});

describe("isTextOverflowing", () => {
  it("wykrywa tekst dłuższy niż przycięty obszar", () => {
    expect(isTextOverflowing(120, 48)).toBe(true);
  });

  it("nie pokazuje przycisku, gdy tekst mieści się w całości", () => {
    expect(isTextOverflowing(48, 48)).toBe(false);
  });

  it("ignoruje różnicę poniżej piksela z zaokrąglenia wysokości wiersza", () => {
    // Bez tolerancji krótki opis dostałby bezużyteczny przycisk „Rozwiń".
    expect(isTextOverflowing(48.5, 48)).toBe(false);
    expect(isTextOverflowing(49, 48)).toBe(false);
  });

  it("uznaje za wystający dopiero realny nadmiar", () => {
    expect(isTextOverflowing(50, 48)).toBe(true);
  });
});

describe("normalizeText", () => {
  it("traktuje brak wartości jako pusty opis", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });

  it("traktuje same białe znaki jako pusty opis", () => {
    expect(normalizeText("   \n\t ")).toBe("");
  });

  it("obcina otoczenie, zachowując treść i łamania wierszy w środku", () => {
    expect(normalizeText("  Malowanie elewacji\nod strony podwórza  ")).toBe("Malowanie elewacji\nod strony podwórza");
  });
});
