import { describe, expect, it } from "vitest";
import { buildDocumentContext, buildKomparycja, findMissingFields, shortLegalName, splitAdvances } from "./document-context";
import { sellerProfileFromOrganization } from "./organization-offer-profile";
import type { OfferLine } from "./types";

const seller = sellerProfileFromOrganization(null);

/** Kwoty mają twardą spację w tysiącach (liczba nie łamie się w PDF) — w testach porównujemy zwykłą. */
const plain = (value: string | string[]) => (Array.isArray(value) ? value.map((v) => v.replace(/ /g, " ")) : value.replace(/ /g, " "));

function line(label: string, section: OfferLine["section"], quantity: number, rate: number): OfferLine {
  return { id: label, organization_id: "o", variant_id: "v", section, label, unit: "m²", quantity, unit_rate: rate, line_total: quantity * rate, sort_order: 0, created_at: "" };
}

const caseRow = {
  client_name: "Jan Kowalski",
  phone: "600 100 200",
  email: "jan@example.com",
  location: "ul. Lipowa 4, Błonie",
  client_address: null,
  client_tax_id: "85010112345",
  work_description: "Docieplenie ścian\nTynk silikonowy",
  contract_number: "12/2026",
  contract_date: "2026-09-01",
  planned_start_date: "2026-09-15",
  realization_end_date: "2026-10-30",
  estimated_value: 10000
};

describe("splitAdvances", () => {
  it("dzieli na równe części i zachowuje sumę", () => {
    expect(splitAdvances(1000, [30, 30, 30])).toEqual([300, 300, 300]);
    const parts = splitAdvances(1000.01, [30, 30, 30]);
    expect(Math.round(parts.reduce((s, p) => s + p, 0) * 100) / 100).toBe(900.01);
  });

  it("zero lub brak kwoty daje zera", () => {
    expect(splitAdvances(0, [30, 30])).toEqual([0, 0]);
    expect(splitAdvances(Number.NaN, [50])).toEqual([0]);
  });
});

describe("komparycja wykonawcy", () => {
  it("zawiera dane spółki z wzorów GolBud", () => {
    const text = buildKomparycja(seller);
    expect(text).toContain("**GOLBUD DAWID GOLCZUK SPÓŁKA KOMANDYTOWA** z siedzibą w Ożarowie Mazowieckim");
    expect(text).toContain("KRS pod numerem 0001216652, NIP 1182321382, REGON 543732168");
    expect(text).toContain("reprezentowaną przez komplementariusza Dawida Golczuka");
    expect(text).not.toContain("pełnomocnictwa");
  });

  it("z pełnomocnikiem do umowy przedwstępnej", () => {
    expect(buildKomparycja(seller, { withProxy: true })).toContain("oraz przez Kacpra Szmurło, działającego w imieniu spółki");
  });

  it("pomija brakujące dane zamiast drukować puste miejsca", () => {
    const text = buildKomparycja({ ...seller, krs: "", regon: "", representation: "" });
    expect(text).not.toContain("KRS");
    expect(text).not.toContain("REGON");
    expect(text).not.toContain("reprezentowaną");
  });

  it("skrócona nazwa do nagłówka", () => {
    expect(shortLegalName("GOLBUD DAWID GOLCZUK SPÓŁKA KOMANDYTOWA")).toBe("GOLBUD DAWID GOLCZUK Sp. k.");
    expect(shortLegalName("Firma X")).toBe("Firma X");
  });
});

describe("buildDocumentContext", () => {
  it("wartość z pozycji wariantu, stawki i zaliczki", () => {
    const ctx = buildDocumentContext({
      caseRow,
      seller,
      lines: [line("Docieplenie EPS", "mixed", 100, 150), line("Tynk", "labor", 100, 50)],
      todayIso: "2026-09-24"
    });
    expect(plain(ctx.valueNet)).toBe("20 000,00 zł");
    expect(plain(ctx.valueGross)).toBe("21 600,00 zł");
    expect(ctx.valueGrossWords).toBe("dwadzieścia jeden tysięcy sześćset złotych");
    expect(plain(ctx.advances)).toEqual(["6480,00 zł", "6480,00 zł", "6480,00 zł"]);
    expect(plain(ctx.rateLines[0])).toBe("Docieplenie EPS — 150,00 zł netto za m², tj. 162,00 zł brutto");
    expect(ctx.scopeItems).toEqual(["Docieplenie EPS", "Tynk"]);
    expect(ctx.contractDate).toBe("01.09.2026");
    expect(ctx.startDate).toBe("15.09.2026");
    expect(ctx.place).toBe("Ożarowie Mazowieckim");
  });

  it("bez wariantu bierze szacowaną wartość i zakres z opisu", () => {
    const ctx = buildDocumentContext({ caseRow, seller, todayIso: "2026-09-24" });
    expect(plain(ctx.valueNet)).toBe("10 000,00 zł");
    expect(ctx.scopeItems).toEqual(["Docieplenie ścian", "Tynk silikonowy"]);
    expect(ctx.clientParty).toBe("**Jan Kowalski**, zam. ul. Lipowa 4, Błonie, PESEL/NIP: 85010112345");
  });

  it("zaległości: najpierw po terminie", () => {
    const payments = [
      { id: "1", organization_id: "o", case_id: "c", title: "Zaliczka 1", due_date: "2026-09-01", amount_due: 1000, amount_paid: 400, paid_at: null, sort_order: 0, created_at: "" },
      { id: "2", organization_id: "o", case_id: "c", title: "Końcowa", due_date: "2026-12-01", amount_due: 5000, amount_paid: 0, paid_at: null, sort_order: 1, created_at: "" }
    ];
    const ctx = buildDocumentContext({ caseRow, seller, payments, todayIso: "2026-09-24" });
    expect(plain(ctx.debtAmount)).toBe("600,00 zł");
    expect(plain(ctx.overduePaymentSummary)).toBe("Zaliczka 1, termin 01.09.2026: 600,00 zł");
  });
});

describe("findMissingFields", () => {
  it("wskazuje brakujące dane i gdzie je uzupełnić", () => {
    const ctx = buildDocumentContext({ caseRow: { ...caseRow, contract_number: null }, seller, todayIso: "2026-09-24" });
    const missing = findMissingFields(["contractNumber", "rates", "bankAccount", "clientName"], ctx);
    expect(missing.map((m) => m.field)).toEqual(["contractNumber", "rates", "bankAccount"]);
    expect(missing[0].where).toBe("zakładka Umowa");
  });
});

describe("dane firmy z ustawień", () => {
  it("przy NIP dawnej JDG nie dokleja KRS i reprezentacji spółki", () => {
    const jdg = sellerProfileFromOrganization({ offer_legal_name: "Golbud Dawid Golczuk — usługi ogólnobudowlane", offer_nip: "1182217667" });
    expect(jdg.krs).toBe("");
    expect(jdg.regon).toBe("");
    expect(jdg.representation).toBe("");
    const ctx = buildDocumentContext({ caseRow, seller: jdg, todayIso: "2026-09-24" });
    expect(findMissingFields(["sellerKrs", "sellerRegon"], ctx).map((m) => m.field)).toEqual(["sellerKrs", "sellerRegon"]);
  });

  it("przy NIP spółki albo pustym uzupełnia dane spółki", () => {
    expect(sellerProfileFromOrganization({ offer_nip: "118-232-13-82" }).krs).toBe("0001216652");
    expect(sellerProfileFromOrganization(null).representation).toContain("komplementariusza");
  });
});
