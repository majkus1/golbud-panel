import { Image, StyleSheet, Text as RawText, View } from "@react-pdf/renderer";
import { Text, pdfImageSource } from "@/components/pdf/pdf-primitives";
import { shortLegalName } from "@/lib/document-context";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import { pdfText } from "@/lib/pdf-text";

/**
 * Firmowy nagłówek i stopka dokumentów — jak we wzorach Dawida: logo po lewej,
 * dane spółki po prawej, na każdej stronie. Używany przez dokumenty z wzorów,
 * protokoły z listy i kosztorys powykonawczy, żeby wszystko wyglądało jednakowo.
 */

const C = { ink: "#17201b", muted: "#5d6b66", brand: "#8a7a4a", line: "#d6d3d1" };

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 8,
    marginBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: C.line
  },
  logo: { width: 120, height: 42, objectFit: "contain" as const },
  logoText: { fontSize: 16, fontWeight: "bold", color: C.brand },
  company: { alignItems: "flex-end" },
  companyName: { fontSize: 8.5, fontWeight: "bold", color: C.ink, textAlign: "right" },
  companyLine: { fontSize: 7.5, color: C.muted, textAlign: "right", lineHeight: 1.35 },
  footerRule: { position: "absolute", bottom: 34, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: C.line },
  footerLeft: { position: "absolute", bottom: 22, left: 40, right: 140, fontSize: 7, color: C.muted },
  // Od góry, nie od dołu: dla tekstu z `render` react-pdf liczy `bottom` od wysokości całej
  // treści i numer lądował kilka tysięcy punktów pod stroną. A4 ma 841,89 pt wysokości.
  footerRight: { position: "absolute", top: 841.89 - 22 - 12, left: 40, right: 40, fontSize: 7, color: C.muted, textAlign: "right" },
});

export function Letterhead({ seller, logoPath }: { seller: OfferSellerProfile; logoPath: string | null }) {
  const lines = [
    seller.phone,
    seller.phoneSecondary,
    seller.email,
    seller.addressLine,
    seller.postalCity,
    seller.krs ? `KRS ${seller.krs}` : "",
    seller.nip ? `NIP ${seller.nip}` : ""
  ].filter((l) => l && l.trim());

  return (
    <View style={styles.header} fixed>
      <View>
        {logoPath ? (
          // @react-pdf Image nie ma atrybutu alt — reguła jsx-a11y nie dotyczy PDF.
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={pdfImageSource(logoPath)} style={styles.logo} />
        ) : (
          <Text style={styles.logoText}>GolBud</Text>
        )}
      </View>
      <View style={styles.company}>
        <Text style={styles.companyName}>{pdfText(shortLegalName(seller.legalName))}</Text>
        {lines.map((line, i) => (
          <Text key={`lh-${i}`} style={styles.companyLine}>
            {pdfText(line)}
          </Text>
        ))}
      </View>
    </View>
  );
}

/**
 * Stopka na każdej stronie. Trzy osobne elementy z pozycją bezwzględną zamiast jednego
 * wiersza — wiersz (View z flexDirection) react-pdf ustawiał na długich dokumentach
 * na górze strony albo gubił. Stopkę wstawiamy na początku strony, przed treścią.
 */
export function DocFooter({ text }: { text?: string | null }) {
  return (
    <>
      <View style={styles.footerRule} fixed />
      <Text style={styles.footerLeft} fixed>
        {pdfText(text || "")}
      </Text>
    </>
  );
}

/**
 * Numer strony („Strona 2 z 7”) — osobny element na końcu strony, pozycjonowany od góry.
 */
export function PageNumber() {
  return <RawText style={styles.footerRight} fixed render={({ pageNumber, totalPages }) => `Strona ${pageNumber} z ${totalPages}`} />;
}
