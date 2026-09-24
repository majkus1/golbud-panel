import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { DocumentPdfDocument } from "@/components/pdf/document-pdf-document";
import { parseDocumentBody } from "./document-body";
import { buildDocumentContext } from "./document-context";
import { DOCUMENT_TEMPLATES } from "./document-templates";
import { sellerProfileFromOrganization } from "./organization-offer-profile";
import type { OfferLine } from "./types";

const seller = { ...sellerProfileFromOrganization(null), bankAccount: "12 3456 7890 1234 5678 9012 3456" };

const fullContext = buildDocumentContext({
  caseRow: {
    client_name: "Jan Kowalski",
    phone: "600 100 200",
    email: "jan@example.com",
    location: "ul. Lipowa 4, 05-870 Błonie",
    client_address: "ul. Polna 1, 05-850 Ożarów Mazowiecki",
    client_tax_id: "85010112345",
    work_description: "Docieplenie ścian",
    contract_number: "12/2026",
    contract_date: "2026-09-01",
    planned_start_date: "2026-09-15",
    realization_end_date: "2026-10-30",
    estimated_value: 10000
  },
  seller,
  lines: [
    { id: "1", organization_id: "o", variant_id: "v", section: "mixed", label: "Docieplenie EPS 15 cm", unit: "m²", quantity: 120, unit_rate: 150, line_total: 18000, sort_order: 0, created_at: "" } as OfferLine
  ],
  payments: [{ id: "p", organization_id: "o", case_id: "c", title: "Zaliczka", due_date: "2026-09-10", amount_due: 5000, amount_paid: 0, paid_at: null, sort_order: 0, created_at: "" }],
  extras: [{ id: "e", organization_id: "o", case_id: "c", work_date: "2026-09-20", description: "Naprawa murku", quantity: 5, unit: "mb", unit_rate: 200, line_total: 1000, accepted: true, created_at: "" }],
  todayIso: "2026-09-24"
});

const emptyContext = buildDocumentContext({ caseRow: null, seller: null, todayIso: "2026-09-24" });

describe("wzory dokumentów", () => {
  it("mają unikalne identyfikatory i nazwy", () => {
    const ids = DOCUMENT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "umowa-konsument", "umowa-przedwstepna", "zamowienie", "aneks-roboty-dodatkowe", "aneks-termin", "aneks-zaplata",
        "aneks-rozliczeniowy", "protokol-odbioru", "protokol-czesciowy", "protokol-przekazania", "oswiadczenie-rodo",
        "oswiadczenie-vat8", "potwierdzenie-gotowka"
      ])
    );
  });

  for (const template of DOCUMENT_TEMPLATES) {
    it(`${template.id}: treść bez „undefined” i „null”, z danymi i bez nich`, () => {
      for (const ctx of [fullContext, emptyContext]) {
        const body = template.buildBody(ctx);
        expect(body).not.toMatch(/undefined|null|\[object/);
        expect(parseDocumentBody(body).length).toBeGreaterThan(3);
      }
    });
  }

  it("umowa konsument ma dane spółki, stawki, zaliczki i poprawione odwołania", () => {
    const body = DOCUMENT_TEMPLATES.find((t) => t.id === "umowa-konsument")!.buildBody(fullContext);
    expect(body).toContain("KRS pod numerem 0001216652");
    expect(body).toContain("Docieplenie EPS 15 cm — 150,00 zł netto za m²");
    expect(body).toContain("wskazanych w § 5 ust. 3 Umowy");
    expect(body).not.toContain("§ 5 ust. 4 Umowy");
    expect(body).toContain("przez Wykonawcę, pod warunkiem");
    expect(body).toContain("12 3456 7890");
  });

  it("aneks o roboty dodatkowe bierze pozycje z zakładki Roboty dodatkowe", () => {
    const body = DOCUMENT_TEMPLATES.find((t) => t.id === "aneks-roboty-dodatkowe")!.buildBody(fullContext);
    expect(body).toContain("Naprawa murku");
    expect(body).toContain("§ 5 ust. 3 Umowy");
    expect(body).toContain("(dalej: „Aneks”)");
  });

  it("każdy wzór renderuje się do PDF", async () => {
    for (const template of DOCUMENT_TEMPLATES) {
      const buffer = await renderToBuffer(
        createElement(DocumentPdfDocument, {
          logoPath: null,
          title: template.title,
          docNumber: null,
          docDate: "24.09.2026",
          seller,
          parties: template.parties,
          buyer: { name: "Jan Kowalski", nip: null, address: "ul. Polna 1", city: null, phone: null, email: null },
          body: template.buildBody(fullContext),
          signatures: template.signatures,
          footer: template.footer ?? null
        }) as Parameters<typeof renderToBuffer>[0]
      );
      expect(buffer.subarray(0, 4).toString(), template.id).toBe("%PDF");
    }
  }, 60_000);
});
