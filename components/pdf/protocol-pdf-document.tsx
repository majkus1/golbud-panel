import { Document, Page, StyleSheet, View } from "@react-pdf/renderer";
import { Text } from "@/components/pdf/pdf-primitives";
import { DocFooter, Letterhead, PageNumber } from "@/components/pdf/letterhead";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import type { ProtocolType } from "@/lib/types";
import { pdfText } from "@/lib/pdf-text";
import { PDF_FONT_FAMILY, registerPdfFonts } from "@/lib/register-pdf-fonts";

registerPdfFonts();

/**
 * Protokół odbioru etapu z listy protokołów sprawy („po ociepleniu”, „po siatce”…).
 * Ten sam firmowy nagłówek co umowy i protokoły z wzorów — wcześniej miał tylko napis
 * „GolBud — protokół” i nazwę z panelu.
 */

const C = { ink: "#17201b", muted: "#5d6b66", line: "#bdb8b3", headerBg: "#f3f1ee" };

const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingHorizontal: 40, paddingBottom: 50, fontSize: 9.5, fontFamily: PDF_FONT_FAMILY, color: C.ink, lineHeight: 1.45 },
  title: { fontSize: 12.5, fontWeight: "bold", textAlign: "center", marginTop: 4 },
  subtitle: { fontSize: 10.5, fontWeight: "bold", textAlign: "center", marginBottom: 12, textTransform: "uppercase" },
  table: { borderTopWidth: 0.6, borderLeftWidth: 0.6, borderColor: C.line, marginBottom: 12 },
  row: { flexDirection: "row" },
  label: { width: 150, borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: C.line, padding: 4, fontSize: 8.5, fontWeight: "bold", backgroundColor: C.headerBg },
  value: { flex: 1, borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: C.line, padding: 4, fontSize: 8.5 },
  h2: { fontSize: 10.5, fontWeight: "bold", marginTop: 6, marginBottom: 4 },
  box: { padding: 8, borderWidth: 0.6, borderColor: C.line, minHeight: 140 },
  signatures: { flexDirection: "row", marginTop: 40, gap: 32 },
  signCol: { flex: 1 },
  signLine: { borderTopWidth: 0.6, borderTopColor: C.ink, marginTop: 30, paddingTop: 4, fontSize: 8, color: C.muted, textAlign: "center" }
});

type Props = {
  seller: OfferSellerProfile;
  logoPath: string | null;
  clientName: string;
  location: string | null;
  contractNumber: string | null;
  contractDate: string | null;
  protocolType: ProtocolType;
  notes: string;
  createdAt: string;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{pdfText(value) || "—"}</Text>
    </View>
  );
}

export function ProtocolPdfDocument({ seller, logoPath, clientName, location, contractNumber, contractDate, protocolType, notes, createdAt }: Props) {
  return (
    <Document title={`Protokół — ${protocolType}`}>
      <Page size="A4" style={styles.page}>
        <Letterhead seller={seller} logoPath={logoPath} />
        <DocFooter text={`Protokół odbioru robót — ${protocolType}`} />
        <Text style={styles.title}>PROTOKÓŁ ODBIORU ROBÓT</Text>
        <Text style={styles.subtitle}>{pdfText(protocolType)}</Text>

        <View style={styles.table}>
          <Row label="Data sporządzenia" value={createdAt} />
          <Row label="Inwestor" value={clientName} />
          <Row label="Adres budowy" value={location || ""} />
          <Row label="Umowa" value={contractNumber ? `nr ${contractNumber}${contractDate ? ` z dnia ${contractDate}` : ""}` : ""} />
          <Row label="Wykonawca" value={seller.legalName} />
        </View>

        <Text style={styles.h2}>Opis wykonanych robót, uwagi i ustalenia</Text>
        <View style={styles.box}>
          <Text>{pdfText(notes) || " "}</Text>
        </View>

        <View style={styles.signatures} wrap={false}>
          <View style={styles.signCol}>
            <Text style={styles.signLine}>INWESTOR / PRZEDSTAWICIEL INWESTORA</Text>
          </View>
          <View style={styles.signCol}>
            <Text style={styles.signLine}>WYKONAWCA / PRZEDSTAWICIEL WYKONAWCY</Text>
          </View>
        </View>

        <PageNumber />
      </Page>
    </Document>
  );
}
