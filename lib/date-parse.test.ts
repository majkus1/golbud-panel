import { describe, expect, it } from "vitest";
import { formatDateWhileTyping, isoToPlDate, parsePlDate } from "./date-parse";

/** Symuluje pisanie znak po znaku: pole dostaje poprzedni tekst + nowy znak. */
function typeInto(keys: string): string {
  let text = "";
  for (const ch of keys) text = formatDateWhileTyping(text + ch);
  return text;
}

describe("formatDateWhileTyping", () => {
  it("dopełnia dzień zerem, gdy nie może mieć drugiej cyfry", () => {
    expect(typeInto("5")).toBe("05");
    expect(typeInto("58")).toBe("05.08");
    expect(typeInto("582026")).toBe("05.08.2026");
  });

  it("czeka na drugą cyfrę dnia 1–3 i miesiąca 0–1", () => {
    expect(typeInto("1")).toBe("1");
    expect(typeInto("12")).toBe("12");
    expect(typeInto("121")).toBe("12.1");
    expect(typeInto("1212")).toBe("12.12");
  });

  it("separator po jednej cyfrze zamyka segment", () => {
    expect(typeInto("1.")).toBe("01");
    expect(typeInto("1.1.")).toBe("01.01");
    expect(typeInto("5.8.2026")).toBe("05.08.2026");
    expect(typeInto("5/8/26")).toBe("05.08.26");
    expect(typeInto("5-8-2026")).toBe("05.08.2026");
  });

  it("zachowuje dotychczasowy wpis z samych cyfr", () => {
    expect(typeInto("08082026")).toBe("08.08.2026");
    expect(formatDateWhileTyping("08082026")).toBe("08.08.2026");
  });

  it("pozwala cofać Backspace'em bez dopisywania kropki z powrotem", () => {
    expect(formatDateWhileTyping("05.08.")).toBe("05.08");
    expect(formatDateWhileTyping("05.")).toBe("05");
    expect(formatDateWhileTyping("0")).toBe("0");
    expect(formatDateWhileTyping("")).toBe("");
  });

  it("obcina rok do czterech cyfr i pomija litery", () => {
    expect(formatDateWhileTyping("05.08.202699")).toBe("05.08.2026");
    expect(formatDateWhileTyping("ab05x08y2026")).toBe("05.08.2026");
  });

  it("przyjmuje wklejoną datę ISO", () => {
    expect(formatDateWhileTyping("2026-08-05")).toBe("05.08.2026");
  });
});

describe("parsePlDate", () => {
  it("rozpoznaje różne zapisy tej samej daty", () => {
    for (const raw of ["05.08.2026", "5.8.2026", "05082026", "5/8/2026", "5-8-2026", " 5 8 2026 ", "2026-08-05"]) {
      expect(parsePlDate(raw), raw).toBe("2026-08-05");
    }
  });

  it("rok dwucyfrowy tylko przy wyjściu z pola", () => {
    expect(parsePlDate("5/8/26")).toBeNull();
    expect(parsePlDate("5/8/26", { allowShortYear: true })).toBe("2026-08-05");
  });

  it("odrzuca daty, które nie istnieją", () => {
    expect(parsePlDate("31.02.2026")).toBeNull();
    expect(parsePlDate("29.02.2025")).toBeNull();
    expect(parsePlDate("29.02.2028")).toBe("2028-02-29");
    expect(parsePlDate("13.13.2026")).toBeNull();
    expect(parsePlDate("0.08.2026")).toBeNull();
    expect(parsePlDate("05.0.2026")).toBeNull();
  });

  it("odrzuca wpis niepełny", () => {
    expect(parsePlDate("05.08")).toBeNull();
    expect(parsePlDate("05.08.202")).toBeNull();
    expect(parsePlDate("")).toBeNull();
  });
});

describe("isoToPlDate", () => {
  it("zamienia ISO na dd.mm.rrrr", () => {
    expect(isoToPlDate("2026-08-05")).toBe("05.08.2026");
    expect(isoToPlDate("2026-08-05T10:00:00Z")).toBe("05.08.2026");
    expect(isoToPlDate(null)).toBe("");
    expect(isoToPlDate("bzdura")).toBe("");
  });
});
