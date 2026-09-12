import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import { pdfText } from "@/lib/pdf-text";
import { PDF_FONT_FAMILY, registerPdfFonts } from "@/lib/register-pdf-fonts";

registerPdfFonts();

const C = {
  ink: "#17201b",
  muted: "#5d6b66",
  brand: "#536b4d",
  line: "#d6d3d1"
};

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 48, fontSize: 10, fontFamily: PDF_FONT_FAMILY, color: C.ink, lineHeight: 1.5 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  logo: { width: 130, height: 44, objectFit: "contain" as const },
  metaBox: { width: "52%", alignItems: "flex-end" },
  title: { fontSize: 14, fontWeight: "bold", color: C.brand, textAlign: "right" },
  metaLine: { fontSize: 8, color: C.muted, textAlign: "right", marginTop: 2 },
  parties: { flexDirection: "row", gap: 12, marginBottom: 14 },
  partyBox: { flex: 1, borderWidth: 0.5, borderColor: C.line, padding: 8, minHeight: 72 },
  partyTitle: { fontSize: 8, fontWeight: "bold", color: C.brand, marginBottom: 4, textTransform: "uppercase" },
  partyLine: { fontSize: 8.5, marginBottom: 2 },
  heading: { fontSize: 10.5, fontWeight: "bold", color: C.ink, marginTop: 9, marginBottom: 2 },
  para: { fontSize: 9.5, marginBottom: 3, textAlign: "justify" },
  spacer: { height: 5 },
  signatures: { flexDirection: "row", marginTop: 42, gap: 28 },
  signCol: { flex: 1 },
  signLine: { borderTopWidth: 0.5, borderTopColor: C.ink, marginTop: 26, paddingTop: 4, fontSize: 8, color: C.muted, textAlign: "center" },
  footer: { position: "absolute", bottom: 26, left: 40, right: 40, fontSize: 7, color: C.muted, textAlign: "center" }
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
  title: string;
  docNumber: string | null;
  docDate: string;
  seller: OfferSellerProfile;
  showParties: boolean;
  buyer: Party;
  body: string;
  showSignatures: boolean;
  signLeft: string;
  signRight: string;
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

function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return /^§/.test(t) || (/^[\dIVX]+\.\s/.test(t) && t.length < 60);
}

export function DocumentPdfDocument({
  logoPath,
  title,
  docNumber,
  docDate,
  seller,
  showParties,
  buyer,
  body,
  showSignatures,
  signLeft,
  signRight
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

  const lines = body.split("\n");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            {logoPath ? (
              // @react-pdf Image nie wspiera alt; reguła jsx-a11y nie ma zastosowania w PDF.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoPath} style={styles.logo} />
            ) : (
              <Text style={{ fontSize: 16, fontWeight: "bold", color: C.brand }}>GolBud</Text>
            )}
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.title}>{pdfText(title)}</Text>
            {docNumber ? <Text style={styles.metaLine}>{`Nr ${pdfText(docNumber)}`}</Text> : null}
            <Text style={styles.metaLine}>{`Data: ${pdfText(docDate)}`}</Text>
          </View>
        </View>

        {showParties ? (
          <View style={styles.parties}>
            <PartyBlock title="Wykonawca" lines={sellerLines} />
            <PartyBlock title="Zamawiający" lines={buyerLines} />
          </View>
        ) : null}

        {lines.map((line, i) => {
          if (!line.trim()) return <View key={`l-${i}`} style={styles.spacer} />;
          if (isHeading(line)) {
            return (
              <Text key={`l-${i}`} style={styles.heading}>
                {pdfText(line.trim())}
              </Text>
            );
          }
          return (
            <Text key={`l-${i}`} style={styles.para}>
              {pdfText(line.trim())}
            </Text>
          );
        })}

        {showSignatures ? (
          <View style={styles.signatures} wrap={false}>
            <View style={styles.signCol}>
              <Text style={styles.signLine}>{pdfText(signLeft || "Podpis")}</Text>
            </View>
            <View style={styles.signCol}>
              <Text style={styles.signLine}>{pdfText(signRight || `${seller.legalName}`)}</Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.footer} render={({ pageNumber, totalPages }) => `Strona ${pageNumber} z ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
