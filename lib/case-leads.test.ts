import { describe, expect, it } from "vitest";
import { memberDisplayName, memberShortName } from "./case-leads";
import type { OrgMemberProfile } from "./types";

function member(overrides: Partial<OrgMemberProfile>): OrgMemberProfile {
  return {
    user_id: "11111111-2222-3333-4444-555555555555",
    email: "ktos@example.com",
    display_name: null,
    role: "sales",
    ...overrides
  } as OrgMemberProfile;
}

describe("memberShortName", () => {
  it("używa imienia i nazwiska, gdy jest uzupełnione", () => {
    expect(memberShortName(member({ display_name: "Kacper Szmurło" }))).toBe("Kacper Szmurło");
  });

  it("obcina domenę, gdy zostaje sam e-mail", () => {
    expect(memberShortName(member({ email: "kontakt.golbud@gmail.com" }))).toBe("kontakt.golbud");
  });

  it("nie tyka imienia i nazwiska, nawet gdy e-mail też jest", () => {
    expect(memberShortName(member({ display_name: "Ewelina Golczuk", email: "ewelina.golbud@gmail.com" }))).toBe(
      "Ewelina Golczuk"
    );
  });

  it("skraca też wtedy, gdy adres przyszedł jako nazwa wyświetlana", () => {
    // Tak właśnie robi baza: `display_name` to coalesce(imię i nazwisko, e-mail, id).
    // Bez tego przypadku plakietka pokazywałaby pełny adres mimo skracania.
    expect(memberShortName(member({ display_name: "kontakt.golbud@gmail.com", email: "kontakt.golbud@gmail.com" }))).toBe(
      "kontakt.golbud"
    );
  });

  it("zostawia wartość bez zmian, gdy nie wygląda jak adres", () => {
    expect(memberShortName(member({ email: "biuro" }))).toBe("biuro");
  });

  it("nie gubi treści przy adresie zaczynającym się od małpy", () => {
    // Adres bez części lokalnej jest nieprawidłowy, ale obcięcie do pustego napisu
    // dałoby pustą plakietkę — lepiej pokazać cokolwiek niż nic.
    expect(memberShortName(member({ email: "@gmail.com" }))).toBe("@gmail.com");
  });

  it("gdy nie ma żadnych danych, pokazuje skrót identyfikatora", () => {
    expect(memberShortName(undefined, "abcdef12-3456-7890-abcd-ef1234567890")).toBe("abcdef12");
  });

  it("nie zostawia pustej plakietki bez żadnych danych", () => {
    expect(memberShortName(undefined, "")).toBe("Nieznana osoba");
  });
});

describe("memberDisplayName", () => {
  it("zostaje przy pełnym adresie — używamy go tam, gdzie trzeba odróżnić osoby", () => {
    expect(memberDisplayName(member({ email: "kontakt.golbud@gmail.com" }))).toBe("kontakt.golbud@gmail.com");
  });
});
