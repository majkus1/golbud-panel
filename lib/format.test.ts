import { describe, expect, it } from "vitest";
import { amountToInput, parseAmount } from "@/lib/format";

/**
 * Regresja na zgłoszenie klienta: „kwota na zleceniu wywala przy przecinku".
 * Pola kwotowe były typu `number`, który odrzuca polski zapis z przecinkiem
 * i zwraca pustą wartość — formularza nie dało się zapisać.
 */
describe("parseAmount", () => {
  it("przyjmuje polski zapis z przecinkiem", () => {
    expect(parseAmount("1500,50")).toBe(1500.5);
    expect(parseAmount("0,99")).toBe(0.99);
  });

  it("przyjmuje też kropkę", () => {
    expect(parseAmount("1500.50")).toBe(1500.5);
  });

  it("ignoruje spacje używane jako separator tysięcy", () => {
    expect(parseAmount("12 500,50")).toBe(12500.5);
    expect(parseAmount("  250  ")).toBe(250);
  });

  it("liczby całkowite działają jak wcześniej", () => {
    expect(parseAmount("300")).toBe(300);
  });

  it("tekst bez liczby daje zero zamiast wartości nieliczbowej", () => {
    expect(parseAmount("brak")).toBe(0);
    expect(parseAmount("")).toBe(0);
  });
});

describe("amountToInput", () => {
  it("brak kwoty to puste pole, nie zero", () => {
    expect(amountToInput(null)).toBe("");
    expect(amountToInput(undefined)).toBe("");
  });

  it("zero pozostaje zerem", () => {
    expect(amountToInput(0)).toBe("0");
  });

  it("kwota z groszami zachowuje część dziesiętną", () => {
    expect(amountToInput(1500.5)).toBe("1500.5");
  });
});
