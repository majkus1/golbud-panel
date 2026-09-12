import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AsBuiltLineSnapshot } from "@/lib/types";
import { pdfPlMoney, pdfPlUnitRate, AS_BUILT_ESTIMATE_TITLE } from "@/lib/as-built-estimate";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import { pdfText } from "@/lib/pdf-text";
import { PDF_FONT_FAMILY, registerPdfFonts } from "@/lib/register-pdf-fonts";

registerPdfFonts();

const C = {
  ink: "#252525",
  muted: "#6b6b6b",
  gold: "#b99b3a",
  line: "#d9d9d9",
  panel: "#f4f1e9",
  total: "#efe3b8"
};

const styles = StyleSheet.create({
  page: { padding: 28, paddingBottom: 54, fontSize: 9, fontFamily: PDF_FONT_FAMILY, color: C.ink },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  logo: { width: 118, height: 42, objectFit: "contain" as const },
  brandName: { fontSize: 24, fontWeight: "bold", color: C.gold, marginTop: 2 },
  companyBox: { width: "58%", alignItems: "flex-end" },
  companyLine: { fontSize: 7.5, color: C.ink, marginBottom: 1.5, textAlign: "right", lineHeight: 1.25 },
  goldRule: { marginTop: 7, marginBottom: 28, borderBottomWidth: 1.4, borderBottomColor: C.gold },
  docTitle: { fontSize: 20, fontWeight: "bold", color: C.ink, textAlign: "center", letterSpacing: 0.4 },
  docSubtitle: { fontSize: 11, color: C.muted, textAlign: "center", marginTop: 6, marginBottom: 10, lineHeight: 1.25 },
  metaTable: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: C.line, marginTop: 6, marginBottom: 24 },
  metaRow: { flexDirection: "row", minHeight: 34 },
  metaLabel: {
    width: "15.5%",
    backgroundColor: C.panel,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: C.line,
    padding: 6,
    fontSize: 7.5,
    fontWeight: "bold",
    lineHeight: 1.15
  },
  metaValue: {
    width: "34.5%",
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: C.line,
    padding: 6,
    fontSize: 8,
    lineHeight: 1.2
  },
  sectionTitle: { fontSize: 14, fontWeight: "bold", marginLeft: 24, marginBottom: 10, color: C.ink },
  tableHead: {
    flexDirection: "row",
    backgroundColor: C.gold,
    borderTopWidth: 0.5,
    borderLeftWidth: 0.5,
    borderColor: C.gold,
    fontWeight: "bold",
    fontSize: 7.5
  },
  tableHeadCell: { paddingVertical: 5, paddingHorizontal: 6, borderRightWidth: 0.5, borderRightColor: "#a78b32" },
  tableRow: {
    flexDirection: "row",
    borderLeftWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: C.line,
    fontSize: 7.5,
    minHeight: 30
  },
  tableCell: { paddingVertical: 6, paddingHorizontal: 6, borderRightWidth: 0.5, borderRightColor: C.line, lineHeight: 1.18 },
  colLp: { width: "5%", textAlign: "center" },
  colName: { width: "52%" },
  colQty: { width: "11%" },
  colRate: { width: "16%" },
  colNet: { width: "16%" },
  bottomRow: { marginTop: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  totalsBox: { width: "48%", borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: C.line },
  totalRow: { flexDirection: "row", minHeight: 26, fontSize: 8.5 },
  totalLabel: { width: "56%", padding: 7, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: C.line },
  totalValue: { width: "44%", padding: 7, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: C.line },
  totalBold: { backgroundColor: C.total, fontWeight: "bold" },
  footerNote: { width: "50%", paddingLeft: 8, fontSize: 8.5, lineHeight: 1.23, color: C.ink },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    paddingTop: 8,
    borderTopWidth: 0.6,
    borderTopColor: C.line,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: C.muted
  },
  footerSpacer: { height: 42 }
});

type Props = {
  logoPath: string | null;
  issueDate: string;
  seller: OfferSellerProfile;
  investorName: string;
  investmentAddress: string | null;
  contractReference: string | null;
  settlementBasis: string;
  workDescription: string;
  lines: AsBuiltLineSnapshot[];
  netTotal: number;
  advancesPaid: number;
  /** Saldo netto — używane tylko przy odtwarzaniu starszych rekordów bez kwot brutto. */
  balanceDue: number;
  /** Kwoty brutto rozliczenia; `null` = starszy rekord, dokument odtwarza się w dawnym układzie. */
  gross: { vatRate: number; vatTotal: number; grossTotal: number; balanceDueGross: number } | null;
  footerNote: string;
};

function MetaPair({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue
}: {
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
}) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{leftLabel}</Text>
      <Text style={styles.metaValue}>{pdfText(leftValue) || "—"}</Text>
      <Text style={styles.metaLabel}>{rightLabel}</Text>
      <Text style={styles.metaValue}>{pdfText(rightValue) || "—"}</Text>
    </View>
  );
}

export function AsBuiltEstimatePdfDocument({
  logoPath,
  issueDate,
  seller,
  investorName,
  investmentAddress,
  contractReference,
  settlementBasis,
  workDescription,
  lines,
  netTotal,
  advancesPaid,
  gross,
  balanceDue,
  footerNote
}: Props) {
  const companyLines = [
    seller.legalName,
    [seller.addressLine, seller.postalCity].filter(Boolean).join(", "),
    seller.nip ? `NIP ${seller.nip}` : "",
    [seller.email, seller.phone ? `tel. ${seller.phone}` : ""].filter(Boolean).join(" | ")
  ].filter(Boolean);

  const basisLabel = gross ? "pozycje netto, rozliczenie brutto" : "wartości netto";
  const subtitle = workDescription.trim()
    ? `Rozliczenie końcowe wykonanych robót ${workDescription.trim()} - ${basisLabel}`
    : `Rozliczenie końcowe wykonanych robót — ${basisLabel}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.topRow}>
          <View style={{ width: "34%" }}>
            {logoPath ? (
              <Image src={logoPath} style={styles.logo} />
            ) : (
              <Text style={styles.brandName}>GolBud</Text>
            )}
          </View>
          <View style={styles.companyBox}>
            {companyLines.map((line, i) => (
              <Text key={`co-${i}`} style={styles.companyLine}>
                {pdfText(line)}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.goldRule} />

        <Text style={styles.docTitle}>{AS_BUILT_ESTIMATE_TITLE}</Text>
        <Text style={styles.docSubtitle}>{pdfText(subtitle)}</Text>

        <View style={styles.metaTable}>
          <MetaPair leftLabel="Inwestor" leftValue={investorName} rightLabel="Wykonawca" rightValue={seller.legalName} />
          <MetaPair leftLabel="Adres inwestycji" leftValue={investmentAddress || "—"} rightLabel="Umowa" rightValue={contractReference || "—"} />
          <MetaPair leftLabel="Podstawa rozliczenia" leftValue={settlementBasis} rightLabel="Rodzaj rozliczenia" rightValue={basisLabel} />
        </View>

        <Text style={styles.sectionTitle}>Zakres wykonanych robót i rozliczenie ilościowe</Text>

        <View style={styles.tableHead} fixed>
          <Text style={[styles.tableHeadCell, styles.colLp]}>Lp.</Text>
          <Text style={[styles.tableHeadCell, styles.colName]}>Opis wykonanych prac</Text>
          <Text style={[styles.tableHeadCell, styles.colQty]}>Ilość</Text>
          <Text style={[styles.tableHeadCell, styles.colRate]}>Cena jedn. netto</Text>
          <Text style={[styles.tableHeadCell, styles.colNet]}>Wartość netto</Text>
        </View>

        {lines.length === 0 ? (
          <View style={styles.tableRow}>
            <Text style={{ width: "100%", color: C.muted }}>Brak pozycji w kosztorysie.</Text>
          </View>
        ) : (
          lines.map((row) => (
            <View key={row.lp} style={styles.tableRow} wrap={false}>
              <Text style={[styles.tableCell, styles.colLp]}>{row.lp}</Text>
              <Text style={[styles.tableCell, styles.colName]}>{pdfText(row.label)}</Text>
              <Text style={[styles.tableCell, styles.colQty]}>{`${row.quantity} ${row.unit}`}</Text>
              <Text style={[styles.tableCell, styles.colRate]}>{pdfPlUnitRate(row.unit_rate, row.unit)}</Text>
              <Text style={[styles.tableCell, styles.colNet]}>{pdfPlMoney(row.line_total)}</Text>
            </View>
          ))
        )}

        <View style={styles.bottomRow}>
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Wartość robót netto</Text>
              <Text style={styles.totalValue}>{pdfPlMoney(netTotal)}</Text>
            </View>
            {gross ? (
              // Wpłaty klienta są brutto, więc potrącamy je od wartości brutto — nie od netto.
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>{`VAT ${pdfText(String(gross.vatRate))} %`}</Text>
                  <Text style={styles.totalValue}>{pdfPlMoney(gross.vatTotal)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Wartość robót brutto</Text>
                  <Text style={styles.totalValue}>{pdfPlMoney(gross.grossTotal)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Otrzymane wpłaty (brutto)</Text>
                  <Text style={styles.totalValue}>{advancesPaid > 0 ? `- ${pdfPlMoney(advancesPaid)}` : pdfPlMoney(0)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, styles.totalBold]}>Pozostało do zapłaty brutto</Text>
                  <Text style={[styles.totalValue, styles.totalBold]}>{pdfPlMoney(gross.balanceDueGross)}</Text>
                </View>
              </>
            ) : (
              // Starszy rekord bez kwot brutto — odtwarzamy dokładnie to, co było wystawione.
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Wpłacone zaliczki</Text>
                  <Text style={styles.totalValue}>{advancesPaid > 0 ? `- ${pdfPlMoney(advancesPaid)}` : pdfPlMoney(0)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, styles.totalBold]}>Pozostało do dopłaty netto</Text>
                  <Text style={[styles.totalValue, styles.totalBold]}>{pdfPlMoney(balanceDue)}</Text>
                </View>
              </>
            )}
          </View>
          {footerNote.trim() ? <Text style={styles.footerNote}>{pdfText(footerNote)}</Text> : <Text style={styles.footerNote}> </Text>}
        </View>

        <View style={styles.footerSpacer} />

        <View style={styles.footer} fixed>
          <Text>{gross ? "Kosztorys powykonawczy - rozliczenie końcowe brutto" : "Kosztorys powykonawczy - rozliczenie końcowe netto"}</Text>
          <Text render={({ pageNumber, totalPages }) => `Strona ${pageNumber} z ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
