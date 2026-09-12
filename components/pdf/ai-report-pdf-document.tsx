import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { pdfSafeText } from "@/lib/pdf-text";
import { PDF_FONT_FAMILY, registerPdfFonts } from "@/lib/register-pdf-fonts";

registerPdfFonts();

const C = {
  ink: "#17201B",
  muted: "#5D6B66",
  brand: "#536B4D",
  brandDark: "#3F5239",
  line: "#D8D5CF",
  panel: "#F4F3EF",
  panelAlt: "#EAF0E7",
  white: "#FFFFFF",
  warning: "#92400E",
  warningBg: "#FEF3C7"
};

const styles = StyleSheet.create({
  page: {
    padding: 30,
    paddingBottom: 44,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 8.4,
    color: C.ink,
    backgroundColor: C.white
  },
  topHeader: {
    marginHorizontal: -30,
    marginTop: -30,
    marginBottom: 16,
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    backgroundColor: C.panel
  },
  topHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  logo: { width: 92, height: 32, objectFit: "contain" },
  brandWord: { fontSize: 18, fontWeight: 700, color: C.brandDark },
  headerText: { alignItems: "flex-end", flex: 1 },
  eyebrow: { fontSize: 7.2, textTransform: "uppercase", letterSpacing: 1.6, color: C.muted, marginBottom: 3 },
  headerTitle: { fontSize: 15, fontWeight: 700, color: C.ink, textAlign: "right", marginBottom: 3 },
  headerSub: { fontSize: 7.5, color: C.muted, textAlign: "right", lineHeight: 1.25 },
  cover: {
    borderWidth: 0.8,
    borderColor: C.line,
    backgroundColor: C.panelAlt,
    padding: 14,
    marginBottom: 12
  },
  coverTitle: { fontSize: 18, fontWeight: 700, color: C.brandDark, marginBottom: 5 },
  coverMeta: { fontSize: 8, color: C.muted, lineHeight: 1.35 },
  noteBox: {
    borderLeftWidth: 3,
    borderLeftColor: C.brand,
    backgroundColor: C.panel,
    padding: 10,
    marginBottom: 12
  },
  section: {
    borderWidth: 0.7,
    borderColor: C.line,
    backgroundColor: "#FBFAF7",
    padding: 11,
    marginBottom: 10
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 7,
    paddingBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.line
  },
  sectionTitle: { flex: 1, fontSize: 11.4, fontWeight: 700, color: C.brandDark, lineHeight: 1.25 },
  paragraph: { fontSize: 8.3, lineHeight: 1.42, marginBottom: 4 },
  bulletRow: { flexDirection: "row", gap: 6, marginBottom: 4 },
  bulletDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.brand, marginTop: 5 },
  bulletText: { flex: 1, fontSize: 8.2, lineHeight: 1.38 },
  warningBox: {
    borderWidth: 0.6,
    borderColor: "#F3D48A",
    backgroundColor: C.warningBg,
    padding: 8,
    marginBottom: 8
  },
  warningText: { color: C.warning, fontSize: 8, lineHeight: 1.35 },
  strong: { fontWeight: 700 },
  footer: {
    position: "absolute",
    left: 30,
    right: 30,
    bottom: 18,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: C.line,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: C.muted
  }
});

type ReportLine = { type: "paragraph" | "bullet" | "warning"; text: string };
type ReportSection = { title: string; lines: ReportLine[] };

function cleanInline(value: string): string {
  return pdfSafeText(value)
    .replace(/`/g, "")
    .replace(/_{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHeading(value: string): string {
  return cleanInline(value)
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^[-•]\s*/, "")
    .trim();
}

function cleanBodyLine(value: string): string {
  return cleanInline(value)
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-•]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\s+--\s*$/g, "")
    .trim();
}

function isSectionHeading(line: string): boolean {
  const clean = line.trim();
  return /^#{1,3}\s+\S/.test(clean) || /^\d+[.)]\s+\S/.test(clean);
}

function splitReport(content: string): ReportSection[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [{ title: "Raport", lines: [{ type: "paragraph", text: "Brak treści raportu." }] }];

  const sections: ReportSection[] = [];
  let current: ReportSection | null = null;

  for (const raw of normalized.split("\n")) {
    const line = raw.trim();
    if (!line || line === "---" || line === "--") continue;

    if (isSectionHeading(line)) {
      const title = cleanHeading(line);
      if (!current || current.lines.length > 0) {
        current = { title: title || `Sekcja ${sections.length + 1}`, lines: [] };
        sections.push(current);
      } else {
        current.title = title || current.title;
      }
      continue;
    }

    if (!current) {
      current = { title: "Podsumowanie właścicielskie", lines: [] };
      sections.push(current);
    }

    const type: ReportLine["type"] = /ryzyk|pilne|ważne|uwaga|zaleg/i.test(line) ? "warning" : /^[-*•]\s+/.test(line) ? "bullet" : "paragraph";
    const text = cleanBodyLine(line);
    if (!text || text === cleanHeading(current.title)) continue;
    current.lines.push({ type, text });
  }

  return sections
    .map((section) => ({
      title: section.title.replace(/\*\*/g, "").trim(),
      lines: section.lines.filter((line, index, arr) => line.text && arr.findIndex((other) => other.text === line.text) === index)
    }))
    .filter((section) => section.title || section.lines.length);
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text>
      {parts.map((part, index) => {
        const strong = part.startsWith("**") && part.endsWith("**");
        return (
          <Text key={`${part}-${index}`} style={strong ? styles.strong : undefined}>
            {cleanInline(strong ? part.slice(2, -2) : part)}
          </Text>
        );
      })}
    </Text>
  );
}

function ReportLineView({ line }: { line: ReportLine }) {
  if (line.type === "warning") {
    return (
      <View style={styles.warningBox}>
        <Text style={styles.warningText}>
          <InlineText text={line.text} />
        </Text>
      </View>
    );
  }
  if (line.type === "bullet") {
    return (
      <View style={styles.bulletRow}>
        <View style={styles.bulletDot} />
        <Text style={styles.bulletText}>
          <InlineText text={line.text} />
        </Text>
      </View>
    );
  }
  return (
    <Text style={styles.paragraph}>
      <InlineText text={line.text} />
    </Text>
  );
}

export function AiReportPdfDocument({
  organizationName,
  logoPath,
  title,
  subtitle,
  generatedAt,
  generatedBy,
  content
}: {
  organizationName: string;
  logoPath: string | null;
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy: string;
  content: string;
}) {
  const sections = splitReport(content);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.topHeader} fixed>
          <View style={styles.topHeaderRow}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image nie renderuje HTML img. */}
            {logoPath ? <Image src={logoPath} style={styles.logo} /> : <Text style={styles.brandWord}>GOLBUD</Text>}
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>GolBud AI</Text>
              <Text style={styles.headerTitle}>{pdfSafeText(title)}</Text>
              <Text style={styles.headerSub}>{pdfSafeText(subtitle.replace(/_/g, " "))}</Text>
            </View>
          </View>
        </View>

        <View style={styles.cover}>
          <Text style={styles.coverTitle}>{pdfSafeText(title)}</Text>
          <Text style={styles.coverMeta}>Wygenerowano: {pdfSafeText(generatedAt)} · Autor: {pdfSafeText(generatedBy)}</Text>
          <Text style={styles.coverMeta}>Organizacja: {pdfSafeText(organizationName)} · dokument właścicielski</Text>
        </View>

        <View style={styles.noteBox}>
          <Text style={styles.paragraph}>
            Dokument przygotowany jako syntetyczny raport właścicielski: najpierw decyzje i ryzyka, dalej liczby oraz rekomendowane działania.
          </Text>
        </View>

        {sections.map((section, index) => (
          <View key={`${section.title}-${index}`} style={styles.section}>
            {/* Bez numeracji — sekcje raportu nie mają ustalonej kolejności ani zależności,
                a numery sugerowały porządek, którego nie ma. */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{pdfSafeText(cleanHeading(section.title))}</Text>
            </View>
            {section.lines.length > 0 ? (
              section.lines.map((line, lineIndex) => <ReportLineView key={`${line.text}-${lineIndex}`} line={line} />)
            ) : (
              <Text style={styles.paragraph}>Brak szczegółowych danych w tej sekcji.</Text>
            )}
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>{pdfSafeText(organizationName)} - raport wewnętrzny</Text>
          <Text>GolBud AI · weryfikuj decyzje z dokumentami źródłowymi</Text>
        </View>
      </Page>
    </Document>
  );
}
