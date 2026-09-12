import { describe, expect, it } from "vitest";
import { ROW_DRAG_TOLERANCE_PX, shouldActivateRow } from "./row-activation";

describe("shouldActivateRow", () => {
  it("otwiera sprawę przy zwykłym kliknięciu", () => {
    expect(shouldActivateRow({ dx: 0, dy: 0, selectedText: "" })).toBe(true);
  });

  it("wybacza drgnięcie ręki w granicach tolerancji", () => {
    expect(shouldActivateRow({ dx: ROW_DRAG_TOLERANCE_PX, dy: -ROW_DRAG_TOLERANCE_PX, selectedText: "" })).toBe(true);
  });

  it("nie otwiera sprawy, gdy tekst został zaznaczony", () => {
    // Główny przypadek: kopiowanie miejscowości z wiersza listy.
    expect(shouldActivateRow({ dx: 60, dy: 0, selectedText: "Łomianki" })).toBe(false);
  });

  it("nie otwiera sprawy po przeciągnięciu, nawet gdy zaznaczenie jest puste", () => {
    // Zdarza się przy przeciągnięciu po pustym obszarze wiersza — kliknięciem to nie było.
    expect(shouldActivateRow({ dx: 40, dy: 2, selectedText: "" })).toBe(false);
  });

  it("liczy przeciągnięcie w obie strony i w pionie", () => {
    expect(shouldActivateRow({ dx: -30, dy: 0, selectedText: "" })).toBe(false);
    expect(shouldActivateRow({ dx: 0, dy: 25, selectedText: "" })).toBe(false);
  });

  it("traktuje samą spację jak brak zaznaczenia", () => {
    // Puszczenie przycisku potrafi zostawić zaznaczoną pojedynczą spację między kolumnami —
    // to nie jest treść, którą ktoś chciał skopiować.
    expect(shouldActivateRow({ dx: 1, dy: 0, selectedText: "   " })).toBe(true);
  });
});
