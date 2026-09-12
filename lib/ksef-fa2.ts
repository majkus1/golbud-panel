import type { Invoice, InvoiceLine } from "@/lib/types";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import { buildInvoicePdfLines, summarizeInvoice, vatBreakdown } from "@/lib/invoice";

/**
 * Fundament KSeF — generuje uproszczony dokument w strukturze zbliżonej do FA(2).
 * To NIE jest wysyłka do KSeF (to osobny etap: uwierzytelnienie, sesja, podpis, API MF),
 * ale przygotowuje dane i format tak, by integrację dało się dołożyć bez przebudowy.
 */

function esc(value: unknown): string {
  const s = value == null ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function num(n: number): string {
  return (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
}

function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

type Params = {
  invoice: Invoice;
  lines: InvoiceLine[];
  seller: OfferSellerProfile;
};

export function buildKsefFa2Xml({ invoice, lines, seller }: Params): string {
  const totals = summarizeInvoice(lines);
  const buckets = vatBreakdown(lines);
  const pdfLines = buildInvoicePdfLines(lines);

  const vatRows = buckets
    .map((b) => {
      // P_13_x = netto wg stawki, P_14_x = VAT wg stawki (mapowanie uproszczone).
      if (b.rate === 23) return `      <P_13_1>${num(b.net)}</P_13_1>\n      <P_14_1>${num(b.vat)}</P_14_1>`;
      if (b.rate === 8) return `      <P_13_2>${num(b.net)}</P_13_2>\n      <P_14_2>${num(b.vat)}</P_14_2>`;
      if (b.rate === 5) return `      <P_13_3>${num(b.net)}</P_13_3>\n      <P_14_3>${num(b.vat)}</P_14_3>`;
      return `      <P_13_6_1>${num(b.net)}</P_13_6_1>`;
    })
    .join("\n");

  const wiersze = pdfLines
    .map(
      (l) => `    <FaWiersz>
      <NrWierszaFa>${l.lp}</NrWierszaFa>
      <P_7>${esc(l.name)}</P_7>
      <P_8A>${esc(l.unit)}</P_8A>
      <P_8B>${num(l.quantity)}</P_8B>
      <P_9A>${num(l.unitPriceNet)}</P_9A>
      <P_11>${num(l.net)}</P_11>
      <P_12>${l.vatRate}</P_12>
    </FaWiersz>`
    )
    .join("\n");

  const sellerNip = onlyDigits(seller.nip);
  const buyerNip = onlyDigits(invoice.buyer_nip);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Dokument poglądowy w strukturze zbliżonej do KSeF FA(2). Wymaga finalnej walidacji wg schematu MF przed wysyłką. -->
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (2)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>2</WariantFormularza>
    <DataWytworzeniaFa>${esc(new Date().toISOString())}</DataWytworzeniaFa>
  </Naglowek>
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>${esc(sellerNip)}</NIP>
      <Nazwa>${esc(seller.legalName)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>${esc(seller.addressLine)}</AdresL1>
      <AdresL2>${esc(seller.postalCity)}</AdresL2>
    </Adres>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      ${buyerNip ? `<NIP>${esc(buyerNip)}</NIP>` : `<BrakID>1</BrakID>`}
      <Nazwa>${esc(invoice.buyer_name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>${esc(invoice.buyer_address)}</AdresL1>
      <AdresL2>${esc(invoice.buyer_city)}</AdresL2>
    </Adres>
  </Podmiot2>
  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>${esc(invoice.issue_date)}</P_1>
    <P_2>${esc(invoice.number)}</P_2>
    ${invoice.sale_date ? `<P_6>${esc(invoice.sale_date)}</P_6>` : ""}
${vatRows}
      <P_15>${num(totals.gross)}</P_15>
    <Adnotacje>
      <P_16>2</P_16>
      <P_17>2</P_17>
      <P_18>2</P_18>
      <P_19>2</P_19>
    </Adnotacje>
    <RodzajFaktury>VAT</RodzajFaktury>
${wiersze}
  </Fa>
</Faktura>
`;
}
