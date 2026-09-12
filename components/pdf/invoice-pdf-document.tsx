import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { amountInWordsPl } from "@/lib/amount-words-pl";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import type { PdfInvoiceLine, VatBucket } from "@/lib/invoice";
import { pdfFixed, pdfText } from "@/lib/pdf-text";
import { PDF_FONT_FAMILY, registerPdfFonts } from "@/lib/register-pdf-fonts";

registerPdfFonts();

const C = {
  ink: "#17201b",
  muted: "#5d6b66",
  brand: "#536b4d",
  line: "#d6d3d1",
  panel: "#f3f2ee"
};

const styles = StyleSheet.create({
  page: { padding: 32, paddingBottom: 44, fontSize: 9, fontFamily: PDF_FONT_FAMILY, color: C.ink },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  logo: { width: 140, height: 48, objectFit: "contain" as const },
  metaBox: { width: "52%", alignItems: "flex-end" },
  metaTitle: { fontSize: 14, fontWeight: "bold", color: C.brand, marginBottom: 6 },
  metaLine: { fontSize: 8, color: C.muted, marginBottom: 2, textAlign: "right" },
  parties: { flexDirection: "row", gap: 12, marginBottom: 12 },
  partyBox: { flex: 1, borderWidth: 0.5, borderColor: C.line, padding: 8, minHeight: 78 },
  partyTitle: { fontSize: 8, fontWeight: "bold", color: C.brand, marginBottom: 4, textTransform: "uppercase" },
  partyLine: { fontSize: 8, marginBottom: 2 },
  tableHead: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.ink,
    paddingVertical: 4,
    fontWeight: "bold",
    fontSize: 7
  },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 4, fontSize: 7 },
  colLp: { width: "4%", textAlign: "center" },
  colName: { width: "24%" },
  colQty: { width: "7%", textAlign: "right" },
  colUnit: { width: "6%", textAlign: "center" },
  colRate: { width: "11%", textAlign: "right" },
  colDisc: { width: "7%", textAlign: "right" },
  colNet: { width: "12%", textAlign: "right" },
  colVatPct: { width: "6%", textAlign: "center" },
  colVat: { width: "11%", textAlign: "right" },
  colGross: { width: "12%", textAlign: "right" },
  vatTableWrap: { marginTop: 12, flexDirection: "row", justifyContent: "space-between" },
  vatTable: { width: "48%" },
  vatHead: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.ink, paddingVertical: 3, fontSize: 7, fontWeight: "bold" },
  vatRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 3, fontSize: 7 },
  vatCol: { width: "25%", textAlign: "right" },
  vatColFirst: { width: "25%", textAlign: "left" },
  totalsBox: { width: "48%", borderWidth: 0.5, borderColor: C.line, padding: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3, fontSize: 8 },
  totalBold: { fontWeight: "bold", fontSize: 11, marginTop: 4, color: C.brand },
  words: { marginTop: 10, fontSize: 8, lineHeight: 1.4 },
  payBox: { marginTop: 10, padding: 8, backgroundColor: C.panel, fontSize: 8, lineHeight: 1.4 },
  note: { marginTop: 8, fontSize: 7, color: C.muted, lineHeight: 1.35 },
  signatures: { flexDirection: "row", marginTop: 26, gap: 24 },
  signCol: { flex: 1 },
  signLine: { borderTopWidth: 0.5, borderTopColor: C.ink, marginTop: 28, paddingTop: 4, fontSize: 7, color: C.muted, textAlign: "center" },
  footer: { position: "absolute", bottom: 24, left: 32, right: 32, fontSize: 7, color: C.muted, textAlign: "center" }
});

type Buyer = {
  name: string;
  nip: string | null;
  address: string | null;
  city: string | null;
  email: string | null;
};

type Props = {
  logoPath: string | null;
  title: string;
  isVatInvoice: boolean;
  invoiceNumber: string;
  issueDate: string;
  saleDate: string | null;
  dueDate: string | null;
  paymentMethod: string;
  seller: OfferSellerProfile;
  buyer: Buyer;
  lines: PdfInvoiceLine[];
  vatBuckets: VatBucket[];
  netTotal: number;
  vatTotal: number;
  grossTotal: number;
  notes: string | null;
};

function PartyBlock({ title, lines }: { title: string; lines: string[] }) {
  const visible = lines.filter((l) => l.trim().length > 0);
  return (
    <View style={styles.partyBox}>
      <Text style={styles.partyTitle}>{title}</Text>
      {visible.length === 0 ? (
        <Text style={styles.partyLine}>—</Text>
      ) : (
        visible.map((line, i) => (
          <Text key={`${title}-${i}`} style={styles.partyLine}>
            {pdfText(line)}
          </Text>
        ))
      )}
    </View>
  );
}

export function InvoicePdfDocument({
  logoPath,
  title,
  isVatInvoice,
  invoiceNumber,
  issueDate,
  saleDate,
  dueDate,
  paymentMethod,
  seller,
  buyer,
  lines,
  vatBuckets,
  netTotal,
  vatTotal,
  grossTotal,
  notes
}: Props) {
  const sellerLines = [
    seller.legalName,
    seller.nip ? `NIP: ${seller.nip}` : "",
    seller.addressLine,
    seller.postalCity,
    seller.phone ? `tel. ${seller.phone}` : "",
    seller.email
  ];

  const buyerLines = [
    buyer.name,
    buyer.nip ? `NIP: ${buyer.nip}` : "",
    buyer.address || "",
    buyer.city || "",
    buyer.email || ""
  ];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={{ width: "44%" }}>
            {logoPath ? (
              <Image src={logoPath} style={styles.logo} />
            ) : (
              <Text style={{ fontSize: 16, fontWeight: "bold", color: C.brand }}>GolBud</Text>
            )}
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaTitle}>{pdfText(title)}</Text>
            <Text style={styles.metaLine}>{`Numer: ${pdfText(invoiceNumber)}`}</Text>
            <Text style={styles.metaLine}>{`Data wystawienia: ${pdfText(issueDate)}`}</Text>
            {saleDate ? <Text style={styles.metaLine}>{`Data sprzedaży: ${pdfText(saleDate)}`}</Text> : null}
            {dueDate ? <Text style={styles.metaLine}>{`Termin płatności: ${pdfText(dueDate)}`}</Text> : null}
            <Text style={styles.metaLine}>{`Sposób płatności: ${pdfText(paymentMethod)}`}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          <PartyBlock title="Sprzedawca" lines={sellerLines} />
          <PartyBlock title="Nabywca" lines={buyerLines} />
        </View>

        <View style={styles.tableHead} fixed>
          <Text style={styles.colLp}>Lp.</Text>
          <Text style={styles.colName}>Nazwa</Text>
          <Text style={styles.colQty}>Ilość</Text>
          <Text style={styles.colUnit}>J.m.</Text>
          <Text style={styles.colRate}>Cena netto</Text>
          <Text style={styles.colDisc}>Rabat %</Text>
          <Text style={styles.colNet}>Wartość netto</Text>
          <Text style={styles.colVatPct}>VAT %</Text>
          <Text style={styles.colVat}>Kwota VAT</Text>
          <Text style={styles.colGross}>Wartość brutto</Text>
        </View>
        {lines.length === 0 ? (
          <View style={styles.tableRow}>
            <Text style={{ width: "100%", color: C.muted }}>Brak pozycji na fakturze.</Text>
          </View>
        ) : (
          lines.map((row) => (
            <View key={row.id} style={styles.tableRow} wrap={false}>
              <Text style={styles.colLp}>{row.lp}</Text>
              <Text style={styles.colName}>{pdfText(row.name)}</Text>
              <Text style={styles.colQty}>{pdfFixed(row.quantity, 2)}</Text>
              <Text style={styles.colUnit}>{pdfText(row.unit)}</Text>
              <Text style={styles.colRate}>{pdfFixed(row.unitPriceNet, 2)}</Text>
              <Text style={styles.colDisc}>{pdfFixed(row.discountPct, 0)}</Text>
              <Text style={styles.colNet}>{pdfFixed(row.net, 2)}</Text>
              <Text style={styles.colVatPct}>{pdfFixed(row.vatRate, 0)}</Text>
              <Text style={styles.colVat}>{pdfFixed(row.vat, 2)}</Text>
              <Text style={styles.colGross}>{pdfFixed(row.gross, 2)}</Text>
            </View>
          ))
        )}

        <View style={styles.vatTableWrap}>
          <View style={styles.vatTable}>
            <View style={styles.vatHead}>
              <Text style={styles.vatColFirst}>Stawka</Text>
              <Text style={styles.vatCol}>Netto</Text>
              <Text style={styles.vatCol}>VAT</Text>
              <Text style={styles.vatCol}>Brutto</Text>
            </View>
            {vatBuckets.map((b) => (
              <View key={`vat-${b.rate}`} style={styles.vatRow}>
                <Text style={styles.vatColFirst}>{`${pdfFixed(b.rate, 0)}%`}</Text>
                <Text style={styles.vatCol}>{pdfFixed(b.net, 2)}</Text>
                <Text style={styles.vatCol}>{pdfFixed(b.vat, 2)}</Text>
                <Text style={styles.vatCol}>{pdfFixed(b.gross, 2)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text>Razem netto:</Text>
              <Text>{`${pdfFixed(netTotal, 2)} PLN`}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>Razem VAT:</Text>
              <Text>{`${pdfFixed(vatTotal, 2)} PLN`}</Text>
            </View>
            <View style={[styles.totalRow, styles.totalBold]}>
              <Text>Do zapłaty:</Text>
              <Text>{`${pdfFixed(grossTotal, 2)} PLN`}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.words}>
          <Text style={{ fontWeight: "bold" }}>Słownie: </Text>
          {pdfText(amountInWordsPl(grossTotal))}
        </Text>

        {seller.bankAccount ? (
          <View style={styles.payBox}>
            <Text style={{ fontWeight: "bold", marginBottom: 2 }}>Dane do płatności</Text>
            <Text>{`Numer konta: ${pdfText(seller.bankAccount)}${seller.bankName ? ` (${pdfText(seller.bankName)})` : ""}`}</Text>
            <Text>{`Sposób płatności: ${pdfText(paymentMethod)}`}</Text>
          </View>
        ) : null}

        {notes?.trim() ? <Text style={styles.note}>{pdfText(notes.trim())}</Text> : null}

        {!isVatInvoice ? (
          <Text style={styles.note}>
            Niniejszy dokument jest fakturą proforma i nie stanowi faktury VAT w rozumieniu ustawy z dnia 11 marca 2004 r.
            o podatku od towarów i usług. Nie jest podstawą do odliczenia podatku VAT.
          </Text>
        ) : null}

        <View style={styles.signatures}>
          <View style={styles.signCol}>
            <Text style={styles.signLine}>Osoba upoważniona do odbioru</Text>
          </View>
          <View style={styles.signCol}>
            <Text style={styles.signLine}>{pdfText(seller.legalName)} — osoba upoważniona do wystawienia</Text>
          </View>
        </View>

        <Text style={styles.footer} render={({ pageNumber, totalPages }) => `Strona ${pageNumber} z ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
