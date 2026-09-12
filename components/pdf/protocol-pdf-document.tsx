import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ProtocolType } from "@/lib/types";
import { pdfText } from "@/lib/pdf-text";
import { PDF_FONT_FAMILY, registerPdfFonts } from "@/lib/register-pdf-fonts";

registerPdfFonts();

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: PDF_FONT_FAMILY, color: "#17201b" },
  brand: { fontSize: 18, fontWeight: "bold", marginBottom: 4, color: "#536b4d" },
  h1: { fontSize: 13, fontWeight: "bold", marginTop: 12, marginBottom: 8 },
  box: { padding: 10, borderWidth: 1, borderColor: "#d6d3d1", minHeight: 120, marginTop: 8 },
  line: { marginTop: 28, borderTopWidth: 0.5, borderTopColor: "#17201b", paddingTop: 6 },
  small: { fontSize: 8, color: "#5d6b66", marginTop: 16 },
  labelRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 4 }
});

type Props = {
  organizationName: string;
  clientName: string;
  location: string | null;
  protocolType: ProtocolType;
  notes: string;
  createdAt: string;
};

function LabeledRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.labelRow}>
      <Text style={{ fontWeight: "bold" }}>{label}</Text>
      <Text>{pdfText(value)}</Text>
    </View>
  );
}

export function ProtocolPdfDocument({ organizationName, clientName, location, protocolType, notes, createdAt }: Props) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>GolBud — protokół</Text>
        <Text style={{ fontSize: 9, color: "#5d6b66", marginBottom: 12 }}>{pdfText(organizationName)}</Text>
        <Text style={styles.h1}>{pdfText(protocolType)}</Text>
        <LabeledRow label="Inwestor: " value={clientName} />
        {location ? <LabeledRow label="Lokalizacja: " value={location} /> : null}
        <LabeledRow label="Data sporządzenia: " value={createdAt} />
        <Text style={{ ...styles.h1, marginTop: 16 }}>Opis / ustalenia</Text>
        <View style={styles.box}>
          <Text>{pdfText(notes) || "—"}</Text>
        </View>
        <View style={styles.line}>
          <Text>Podpis osoby sporządzającej: ___________________________</Text>
        </View>
        <View style={{ ...styles.line, marginTop: 20 }}>
          <Text>Podpis inwestora / przedstawiciela: ___________________________</Text>
        </View>
        <Text style={styles.small}>Protokół wygenerowany z panelu GolBud. Podpisy na wydruku.</Text>
      </Page>
    </Document>
  );
}
