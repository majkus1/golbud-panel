import { describe, expect, it } from "vitest";
import { isCostDataIncomplete } from "./profitability-report";

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
