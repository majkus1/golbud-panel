import { describe, expect, it } from "vitest";
import { amountInWordsPl } from "./amount-words-pl";

describe("amountInWordsPl", () => {
  it("tysiące w rodzaju męskim", () => {
    expect(amountInWordsPl(32400)).toBe("trzydzieści dwa tysiące czterysta złotych");
    expect(amountInWordsPl(2000)).toBe("dwa tysiące złotych");
    expect(amountInWordsPl(22000)).toBe("dwadzieścia dwa tysiące złotych");
  });

  it("sam tysiąc bez „jeden”", () => {
    expect(amountInWordsPl(1000)).toBe("tysiąc złotych");
    expect(amountInWordsPl(1500)).toBe("tysiąc pięćset złotych");
    expect(amountInWordsPl(21000)).toBe("dwadzieścia jeden tysięcy złotych");
    expect(amountInWordsPl(1_000_000)).toBe("jeden milion złotych");
  });

  it("odmiana złotych i groszy", () => {
    expect(amountInWordsPl(1)).toBe("jeden złoty");
    expect(amountInWordsPl(2)).toBe("dwa złote");
    expect(amountInWordsPl(12)).toBe("dwanaście złotych");
    expect(amountInWordsPl(22.02)).toBe("dwadzieścia dwa złote dwa grosze");
    expect(amountInWordsPl(15.01)).toBe("piętnaście złotych jeden grosz");
    expect(amountInWordsPl(0.5)).toBe("zero złotych pięćdziesiąt groszy");
  });

  it("zaokrągla w groszach", () => {
    expect(amountInWordsPl(12.999)).toBe("trzynaście złotych");
    expect(amountInWordsPl(12960.004)).toBe("dwanaście tysięcy dziewięćset sześćdziesiąt złotych");
    expect(amountInWordsPl(0.1 + 0.2)).toBe("zero złotych trzydzieści groszy");
  });

  it("kwoty ujemne i niepoprawne", () => {
    expect(amountInWordsPl(-250)).toBe("minus dwieście pięćdziesiąt złotych");
    expect(amountInWordsPl(Number.NaN)).toBe("zero złotych");
  });
});
