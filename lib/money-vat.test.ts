import { describe, expect, it } from "vitest";
import { describeNetGross, grossFromNet, normalizeVatRate, settleAgainstPayments } from "./money-vat";

describe("normalizeVatRate", () => {
  it("przyjmuje liczbę i tekst z ustawień", () => {
    expect(normalizeVatRate(8)).toBe(8);
    expect(normalizeVatRate("23")).toBe(23);
    expect(normalizeVatRate("8,5")).toBe(8.5);
  });

  it("wraca do wartości domyślnej przy śmieciach", () => {
    expect(normalizeVatRate(null)).toBe(23);
    expect(normalizeVatRate("abc")).toBe(23);
    expect(normalizeVatRate(-5)).toBe(23);
    expect(normalizeVatRate(150, 8)).toBe(8);
  });
});

describe("grossFromNet", () => {
  it("liczy VAT 8 % jak w budownictwie mieszkaniowym", () => {
    expect(grossFromNet(10_000, 8)).toEqual({ net: 10_000, vatRate: 8, vat: 800, gross: 10_800 });
  });

  it("zaokrągla do groszy", () => {
    const b = grossFromNet(1234.56, 23);
    expect(b.vat).toBe(283.95);
    expect(b.gross).toBe(1518.51);
  });

  it("nie wywraca się na pustej wartości", () => {
    expect(grossFromNet(Number.NaN, 8).gross).toBe(0);
  });
});

describe("settleAgainstPayments", () => {
  it("odejmuje wpłaty od brutto, nie od netto", () => {
    // Błąd zgłoszony przez klienta: 10 000 netto − 5 000 wpłaty = „5 000 do dopłaty”,
    // a naprawdę do zapłaty jest 10 800 − 5 000 = 5 800.
    const s = settleAgainstPayments(10_000, 8, 5_000);
    expect(s.gross).toBe(10_800);
    expect(s.balanceGross).toBe(5_800);
    expect(s.overpaid).toBe(0);
  });

  it("pokazuje nadpłatę zamiast ujemnego salda", () => {
    const s = settleAgainstPayments(1_000, 8, 1_200);
    expect(s.balanceGross).toBe(0);
    expect(s.overpaid).toBe(120);
  });

  it("ujemne wpłaty traktuje jak zero", () => {
    expect(settleAgainstPayments(1_000, 8, -50).paid).toBe(0);
  });
});

describe("describeNetGross", () => {
  it("opisuje kwotę w umowie z obiema wartościami i stawką", () => {
    // Intl w pl-PL rozdziela tysiące twardą spacją — porównujemy po ujednoliceniu odstępów.
    const plain = describeNetGross(12_000, 8).replace(/\s/g, " ");
    expect(plain).toBe("12 000,00 zł netto, tj. 12 960,00 zł brutto (VAT 8 %)");
  });

  it("zwraca pusty napis, gdy nie ma kwoty — szablon wstawi wielokropek", () => {
    expect(describeNetGross(null, 8)).toBe("");
    expect(describeNetGross(0, 8)).toBe("");
  });
});
