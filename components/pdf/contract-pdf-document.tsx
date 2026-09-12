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
  page: { padding: 36, paddingBottom: 44, fontSize: 9, fontFamily: PDF_FONT_FAMILY, color: C.ink, lineHeight: 1.4 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  logo: { width: 130, height: 44, objectFit: "contain" as const },
  metaBox: { width: "52%", alignItems: "flex-end" },
  title: { fontSize: 15, fontWeight: "bold", color: C.brand, textAlign: "right" },
  metaLine: { fontSize: 8, color: C.muted, textAlign: "right", marginTop: 2 },
  intro: { fontSize: 8.5, marginBottom: 10 },
  parties: { flexDirection: "row", gap: 12, marginBottom: 12 },
  partyBox: { flex: 1, borderWidth: 0.5, borderColor: C.line, padding: 8, minHeight: 76 },
  partyTitle: { fontSize: 8, fontWeight: "bold", color: C.brand, marginBottom: 4, textTransform: "uppercase" },
  partyLine: { fontSize: 8, marginBottom: 2 },
  h: { fontSize: 9.5, fontWeight: "bold", marginTop: 10, marginBottom: 3 },
  p: { fontSize: 8.5, marginBottom: 4 },
  tableHead: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.ink,
    paddingVertical: 3,
    fontWeight: "bold",
    fontSize: 7,
    marginTop: 4
  },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 3, fontSize: 7 },
  sectionRow: { flexDirection: "row", backgroundColor: C.panel, paddingVertical: 3, paddingHorizontal: 3, marginTop: 3, fontWeight: "bold", fontSize: 7.5, color: C.brand },
  colLp: { width: "5%", textAlign: "center" },
  colName: { width: "45%" },
  colQty: { width: "12%", textAlign: "right" },
  colUnit: { width: "10%", textAlign: "center" },
  colRate: { width: "13%", textAlign: "right" },
  colNet: { width: "15%", textAlign: "right" },
  totalsBox: { marginTop: 8, alignSelf: "flex-end", width: "55%", borderWidth: 0.5, borderColor: C.line, padding: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2, fontSize: 8 },
  totalBold: { fontWeight: "bold", fontSize: 10, marginTop: 3, color: C.brand },
  payRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2, fontSize: 8.5 },
  signatures: { flexDirection: "row", marginTop: 30, gap: 28 },
  signCol: { flex: 1 },
  signLine: { borderTopWidth: 0.5, borderTopColor: C.ink, marginTop: 30, paddingTop: 4, fontSize: 7.5, color: C.muted, textAlign: "center" },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 7, color: C.muted, textAlign: "center" }
});

type Party = {
  name: string;
  nip: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
};

type Props = {
  logoPath: string | null;
  contractNumber: string;
  contractDate: string;
  seller: OfferSellerProfile;
  buyer: Party;
  subject: string;
  scopeNotes: string | null;
  variantName: string;
  pdfLines: PdfOfferLine[];
  netTotal: number;
  vatTotal: number;
  grossTotal: number;
  vatRate: number;
  advancePct: number;
  advanceAmount: number;
  remainderAmount: number;
  startDate: string | null;
  endDate: string | null;
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

export function ContractPdfDocument({
  logoPath,
  contractNumber,
  contractDate,
  seller,
  buyer,
  subject,
  scopeNotes,
  variantName,
  pdfLines,
  netTotal,
  vatTotal,
  grossTotal,
  vatRate,
  advancePct,
  advanceAmount,
  remainderAmount,
  startDate,
  endDate
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
    buyer.phone ? `tel. ${buyer.phone}` : "",
    buyer.email || ""
  ];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            {logoPath ? (
              <Image src={logoPath} style={styles.logo} />
            ) : (
              <Text style={{ fontSize: 16, fontWeight: "bold", color: C.brand }}>GolBud</Text>
            )}
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.title}>UMOWA O ROBOTY BUDOWLANE</Text>
            <Text style={styles.metaLine}>{`Nr ${pdfText(contractNumber)}`}</Text>
            <Text style={styles.metaLine}>{`Data zawarcia: ${pdfText(contractDate)}`}</Text>
          </View>
        </View>

        <Text style={styles.intro}>
          Zawarta w dniu {pdfText(contractDate)} pomiędzy Wykonawcą a Zamawiającym, zwanymi dalej łącznie „Stronami”.
        </Text>

        <View style={styles.parties}>
          <PartyBlock title="Wykonawca" lines={sellerLines} />
          <PartyBlock title="Zamawiający" lines={buyerLines} />
        </View>

        <Text style={styles.h}>§ 1. Przedmiot umowy</Text>
        <Text style={styles.p}>
          {pdfText(
            subject?.trim()
              ? `Przedmiotem umowy jest wykonanie robót budowlanych w zakresie: ${subject.trim()}.`
              : "Przedmiotem umowy jest wykonanie robót budowlanych zgodnie z poniższym kosztorysem."
          )}
        </Text>
        {scopeNotes?.trim() ? <Text style={styles.p}>{pdfText(scopeNotes.trim())}</Text> : null}
        <Text style={styles.p}>{`Wariant / zakres: ${pdfText(variantName)}.`}</Text>

        <Text style={styles.h}>§ 2. Kosztorys i wynagrodzenie</Text>
        <View style={styles.tableHead}>
          <Text style={styles.colLp}>Lp.</Text>
          <Text style={styles.colName}>Nazwa</Text>
          <Text style={styles.colQty}>Ilość</Text>
          <Text style={styles.colUnit}>J.m.</Text>
          <Text style={styles.colRate}>Cena netto</Text>
          <Text style={styles.colNet}>Wartość netto</Text>
        </View>
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
              </View>
            )
          )
        )}

        <View style={styles.totalsBox}>
          <View style={styles.totalRow}>
            <Text>Razem netto:</Text>
            <Text>{`${pdfFixed(netTotal, 2)} PLN`}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>{`VAT (${pdfFixed(vatRate, 0)}%):`}</Text>
            <Text>{`${pdfFixed(vatTotal, 2)} PLN`}</Text>
          </View>
          <View style={[styles.totalRow, styles.totalBold]}>
            <Text>Wynagrodzenie brutto:</Text>
            <Text>{`${pdfFixed(grossTotal, 2)} PLN`}</Text>
          </View>
        </View>
        <Text style={[styles.p, { marginTop: 6 }]}>
          <Text style={{ fontWeight: "bold" }}>Słownie brutto: </Text>
          {pdfText(amountInWordsPl(grossTotal))}
        </Text>

        <Text style={styles.h}>§ 3. Warunki płatności</Text>
        <View style={styles.payRow}>
          <Text>{`Zaliczka (${pdfFixed(advancePct, 0)}%) płatna przed rozpoczęciem prac:`}</Text>
          <Text>{`${pdfFixed(advanceAmount, 2)} PLN`}</Text>
        </View>
        <View style={styles.payRow}>
          <Text>Pozostała część płatna po odbiorze końcowym:</Text>
          <Text>{`${pdfFixed(remainderAmount, 2)} PLN`}</Text>
        </View>
        <Text style={styles.p}>{pdfText(seller.paymentTerms)}</Text>
        {seller.bankAccount ? (
          <Text style={styles.p}>{`Numer konta: ${pdfText(seller.bankAccount)}${seller.bankName ? ` (${pdfText(seller.bankName)})` : ""}.`}</Text>
        ) : null}

        <Text style={styles.h}>§ 4. Termin realizacji</Text>
        <Text style={styles.p}>
          {pdfText(
            startDate || endDate
              ? `Rozpoczęcie prac: ${startDate || "do uzgodnienia"}. Planowane zakończenie: ${endDate || "do uzgodnienia"}.`
              : "Terminy rozpoczęcia i zakończenia robót Strony ustalą po wpłacie zaliczki, w formie pisemnej lub mailowej."
          )}
        </Text>

        <Text style={styles.h}>§ 5. Postanowienia końcowe</Text>
        <Text style={styles.p}>
          Prace spoza zakresu kosztorysu (prace dodatkowe) wymagają odrębnego ustalenia i wyceny. Na wykonane roboty
          Wykonawca udziela gwarancji zgodnie z obowiązującymi przepisami. W sprawach nieuregulowanych stosuje się
          przepisy Kodeksu cywilnego. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze Stron.
        </Text>

        <View style={styles.signatures} wrap={false}>
          <View style={styles.signCol}>
            <Text style={styles.signLine}>Zamawiający</Text>
          </View>
          <View style={styles.signCol}>
            <Text style={styles.signLine}>{`Wykonawca — ${pdfText(seller.legalName)}`}</Text>
          </View>
        </View>

        <Text style={styles.footer} render={({ pageNumber, totalPages }) => `Strona ${pageNumber} z ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
