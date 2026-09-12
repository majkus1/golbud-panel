import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { amountInWordsPl } from "@/lib/amount-words-pl";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import type { PdfOfferLine } from "@/lib/offer-pdf-helpers";
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
  page: { padding: 32, paddingBottom: 40, fontSize: 9, fontFamily: PDF_FONT_FAMILY, color: C.ink },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  logo: { width: 140, height: 48, objectFit: "contain" as const },
  metaBox: { width: "52%", alignItems: "flex-end" },
  metaTitle: { fontSize: 13, fontWeight: "bold", color: C.brand, marginBottom: 6 },
  metaLine: { fontSize: 8, color: C.muted, marginBottom: 2, textAlign: "right" },
  parties: { flexDirection: "row", gap: 12, marginBottom: 12 },
  partyBox: { flex: 1, borderWidth: 0.5, borderColor: C.line, padding: 8, minHeight: 72 },
  partyTitle: { fontSize: 8, fontWeight: "bold", color: C.brand, marginBottom: 4, textTransform: "uppercase" },
  partyLine: { fontSize: 8, marginBottom: 2 },
  h1: { fontSize: 11, fontWeight: "bold", marginBottom: 4 },
  scope: { fontSize: 8, color: C.muted, marginBottom: 10, lineHeight: 1.35 },
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
  sectionRow: {
    flexDirection: "row",
    backgroundColor: C.panel,
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginTop: 4,
    fontWeight: "bold",
    fontSize: 8,
    color: C.brand
  },
  colLp: { width: "4%", textAlign: "center" },
  colName: { width: "26%" },
  colQty: { width: "7%", textAlign: "right" },
  colUnit: { width: "6%", textAlign: "center" },
  colRate: { width: "11%", textAlign: "right" },
  colNet: { width: "12%", textAlign: "right" },
  colVatPct: { width: "6%", textAlign: "center" },
  colVat: { width: "11%", textAlign: "right" },
  colGross: { width: "12%", textAlign: "right" },
  totalsWrap: { marginTop: 10, alignItems: "flex-end" },
  totalsBox: { width: "55%", borderWidth: 0.5, borderColor: C.line, padding: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3, fontSize: 8 },
  totalBold: { fontWeight: "bold", fontSize: 10, marginTop: 4 },
  words: { marginTop: 10, fontSize: 8, lineHeight: 1.4 },
  details: { marginTop: 10, padding: 8, backgroundColor: C.panel, fontSize: 8, lineHeight: 1.35 },
  signatures: { flexDirection: "row", marginTop: 24, gap: 24 },
  signCol: { flex: 1 },
  signLine: { borderTopWidth: 0.5, borderTopColor: C.ink, marginTop: 28, paddingTop: 4, fontSize: 7, color: C.muted },
  termsTitle: { fontSize: 12, fontWeight: "bold", color: C.brand, marginBottom: 10 },
  termsH: { fontSize: 9, fontWeight: "bold", marginTop: 8, marginBottom: 3 },
  termsP: { fontSize: 8, lineHeight: 1.45, color: C.ink, marginBottom: 4 },
  footer: { position: "absolute", bottom: 24, left: 32, right: 32, fontSize: 7, color: C.muted, textAlign: "center" }
});

type Buyer = {
  name: string;
  phone: string | null;
  email: string | null;
  location: string | null;
};

type Props = {
  logoPath: string | null;
  offerNumber: string;
  issueDate: string;
  validUntil: string;
  seller: OfferSellerProfile;
  buyer: Buyer;
  variantName: string;
  workDescription: string;
  scopeNotes: string | null;
  pdfLines: PdfOfferLine[];
  netTotal: number;
  vatTotal: number;
  grossTotal: number;
  vatRate: number;
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

function TableHeader() {
  return (
    <View style={styles.tableHead} fixed>
      <Text style={styles.colLp}>Lp.</Text>
      <Text style={styles.colName}>Nazwa produktu / usługi</Text>
      <Text style={styles.colQty}>Ilość</Text>
      <Text style={styles.colUnit}>J.m.</Text>
      <Text style={styles.colRate}>Cena netto</Text>
      <Text style={styles.colNet}>Wartość netto</Text>
      <Text style={styles.colVatPct}>VAT %</Text>
      <Text style={styles.colVat}>Kwota VAT</Text>
      <Text style={styles.colGross}>Wartość brutto</Text>
    </View>
  );
}

function OfferTerms({ seller }: { seller: OfferSellerProfile }) {
  return (
    <>
      <Text style={styles.termsTitle}>Warunki realizacji oferty</Text>
      <Text style={styles.termsP}>
        Niniejszy dokument stanowi ofertę handlową. Realizacja robót następuje po pisemnym lub mailowym
        potwierdzeniu przyjęcia oferty oraz — jeśli ustalono — po wpłacie zaliczki na wskazane konto.
      </Text>
      <Text style={styles.termsH}>1. Ważność oferty</Text>
      <Text style={styles.termsP}>
        Oferta jest ważna do daty wskazanej na pierwszej stronie. Po tym terminie Sprzedawca zastrzega sobie prawo
        do zmiany cen i terminów z uwagi na koszty materiałów i robocizny.
      </Text>
      <Text style={styles.termsH}>2. Płatności</Text>
      <Text style={styles.termsP}>{pdfText(seller.paymentTerms)}</Text>
      {seller.bankAccount ? (
        <Text style={styles.termsP}>
          {`Numer konta: ${pdfText(seller.bankAccount)}${seller.bankName ? ` (${pdfText(seller.bankName)})` : ""}.`}
        </Text>
      ) : null}
      <Text style={styles.termsH}>3. Zakres robót</Text>
      <Text style={styles.termsP}>
        Zakres obejmuje pozycje wymienione w kosztorysie na stronie 1 oraz uzgodnienia dodatkowe opisane w polu
        „Szczegóły / uzgodnienia”. Prace spoza zakresu wyceniane są osobno jako prace dodatkowe.
      </Text>
      <Text style={styles.termsH}>4. Materiały i organizacja</Text>
      <Text style={styles.termsP}>
        O ile nie zaznaczono inaczej w ofercie, materiały podstawowe zapewnia Wykonawca zgodnie z kosztorysem;
        media i dostęp do obiektu zapewnia Nabywca. Terminy realizacji uzgadniane są po przyjęciu oferty.
      </Text>
      <Text style={styles.termsH}>5. Gwarancja</Text>
      <Text style={styles.termsP}>
        Na wykonane roboty budowlane udzielana jest gwarancja zgodnie z obowiązującymi przepisami oraz warunkami
        umowy. Gwarancja nie obejmuje uszkodzeń wynikających z niewłaściwego użytkowania lub prac wykonanych przez
        osoby trzecie bez wiedzy Wykonawcy.
      </Text>
      <Text style={styles.termsH}>6. Ochrona danych (RODO)</Text>
      <Text style={styles.termsP}>
        Dane osobowe przetwarzane są w celu przygotowania i realizacji oferty oraz kontaktu handlowego. Nabywca ma
        prawo dostępu do danych, ich sprostowania i usunięcia zgodnie z RODO.
      </Text>
      <Text style={styles.termsH}>7. Akceptacja</Text>
      <Text style={styles.termsP}>
        Akceptacja oferty następuje poprzez podpis na pierwszej stronie, odesłanie skanu/podpisu elektronicznego lub
        pisemną wiadomość e-mail z potwierdzeniem numeru oferty.
      </Text>
    </>
  );
}

export function OfferPdfDocument({
  logoPath,
  offerNumber,
  issueDate,
  validUntil,
  seller,
  buyer,
  variantName,
  workDescription,
  scopeNotes,
  pdfLines,
  netTotal,
  vatTotal,
  grossTotal,
  vatRate
}: Props) {
  const sellerLines = [
    seller.legalName,
    seller.nip ? `NIP: ${seller.nip}` : "",
    seller.addressLine,
    seller.postalCity,
    seller.phone ? `tel. ${seller.phone}` : "",
    seller.email,
    seller.website
  ];

  const buyerLines = [
    buyer.name,
    buyer.location || "",
    buyer.phone ? `tel. ${buyer.phone}` : "",
    buyer.email || ""
  ];

  const detailsParts = [
    scopeNotes?.trim() ? scopeNotes.trim() : null,
    workDescription?.trim() ? `Zakres: ${workDescription.trim()}` : null
  ].filter(Boolean) as string[];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={{ width: "44%" }}>
            {logoPath ? <Image src={logoPath} style={styles.logo} /> : <Text style={{ fontSize: 16, fontWeight: "bold", color: C.brand }}>GolBud</Text>}
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaTitle}>OFERTA / KOSZTORYS</Text>
            <Text style={styles.metaLine}>{`Numer: ${pdfText(offerNumber)}`}</Text>
            <Text style={styles.metaLine}>{`Data wystawienia: ${pdfText(issueDate)}`}</Text>
            <Text style={styles.metaLine}>{`Ważna do: ${pdfText(validUntil)}`}</Text>
            <Text style={styles.metaLine}>{`Stawka VAT: ${pdfFixed(vatRate, 0)}%`}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          <PartyBlock title="Sprzedawca" lines={sellerLines} />
          <PartyBlock title="Nabywca" lines={buyerLines} />
        </View>

        <Text style={styles.h1}>{`Wariant oferty: ${pdfText(variantName)}`}</Text>
        {workDescription ? <Text style={styles.scope}>{pdfText(workDescription)}</Text> : null}

        <TableHeader />
        {pdfLines.length === 0 ? (
          <View style={styles.tableRow}>
            <Text style={{ width: "100%", color: C.muted }}>Brak pozycji w kosztorysie.</Text>
          </View>
        ) : (
          pdfLines.map((row) =>
            row.isSectionHeader ? (
              <View key={row.id} style={styles.sectionRow}>
                <Text>{pdfText(row.label)}</Text>
              </View>
            ) : (
              <View key={row.id} style={styles.tableRow} wrap={false}>
                <Text style={styles.colLp}>{row.lp}</Text>
                <Text style={styles.colName}>{pdfText(row.label)}</Text>
                <Text style={styles.colQty}>{pdfFixed(row.quantity, 2)}</Text>
                <Text style={styles.colUnit}>{pdfText(row.unit)}</Text>
                <Text style={styles.colRate}>{pdfFixed(row.unitRateNet, 2)}</Text>
                <Text style={styles.colNet}>{pdfFixed(row.netTotal, 2)}</Text>
                <Text style={styles.colVatPct}>{pdfFixed(row.vatRate, 0)}</Text>
                <Text style={styles.colVat}>{pdfFixed(row.vatAmount, 2)}</Text>
                <Text style={styles.colGross}>{pdfFixed(row.grossTotal, 2)}</Text>
              </View>
            )
          )
        )}

        <View style={styles.totalsWrap}>
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text>Razem netto:</Text>
              <Text>{`${pdfFixed(netTotal, 2)} PLN`}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>{`Kwota VAT (${pdfFixed(vatRate, 0)}%):`}</Text>
              <Text>{`${pdfFixed(vatTotal, 2)} PLN`}</Text>
            </View>
            <View style={[styles.totalRow, styles.totalBold]}>
              <Text>Do zapłaty brutto:</Text>
              <Text>{`${pdfFixed(grossTotal, 2)} PLN`}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.words}>
          <Text style={{ fontWeight: "bold" }}>Słownie: </Text>
          {pdfText(amountInWordsPl(grossTotal))}
        </Text>

        {detailsParts.length > 0 ? (
          <View style={styles.details}>
            <Text style={{ fontWeight: "bold", marginBottom: 4 }}>Szczegóły / uzgodnienia</Text>
            {detailsParts.map((p, i) => (
              <Text key={`d-${i}`}>{pdfText(p)}</Text>
            ))}
          </View>
        ) : null}

        <View style={styles.signatures}>
          <View style={styles.signCol}>
            <Text style={{ fontSize: 8 }}>Nabywca — akceptuję ofertę</Text>
            <Text style={styles.signLine}>Data i podpis</Text>
          </View>
          <View style={styles.signCol}>
            <Text style={{ fontSize: 8 }}>Sprzedawca</Text>
            <Text style={styles.signLine}>{pdfText(seller.legalName)}</Text>
          </View>
        </View>

        <Text style={styles.footer} render={({ pageNumber, totalPages }) => `Strona ${pageNumber} z ${totalPages}`} fixed />
      </Page>

      <Page size="A4" style={styles.page}>
        <OfferTerms seller={seller} />
        <Text style={styles.footer} render={({ pageNumber, totalPages }) => `Strona ${pageNumber} z ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
