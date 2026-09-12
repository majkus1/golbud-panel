import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type React from "react";
import type { FinancialControlReport, FinancialControlReportRow, FinancialControlReportSection } from "@/lib/financial-control-report";
import { formatFinancialMoney } from "@/lib/financial-control-report";
import { pdfSafeText } from "@/lib/pdf-text";
import { PDF_FONT_FAMILY, registerPdfFonts } from "@/lib/register-pdf-fonts";

registerPdfFonts();

const C = {
  ink: "#17201b",
  muted: "#5d6b66",
  brand: "#536b4d",
  brandDark: "#3f5239",
  line: "#d8d5cf",
  panel: "#f4f3ef",
  panelAlt: "#e9efe5",
  white: "#ffffff",
  warning: "#92400e",
  danger: "#991b1b"
};

const styles = StyleSheet.create({
  page: {
    padding: 30,
    paddingBottom: 40,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 8.2,
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
  logo: { width: 82, height: 30, objectFit: "contain" as const },
  brandWord: { fontSize: 18, fontWeight: "bold", color: C.brandDark },
  headerText: { alignItems: "flex-end", flex: 1 },
  headerTitle: { fontSize: 11, fontWeight: "bold", color: C.ink, marginBottom: 2, textAlign: "right" },
  headerSub: { fontSize: 7.5, color: C.muted, textAlign: "right" },
  coverTitle: { fontSize: 18, fontWeight: "bold", color: C.brandDark, marginBottom: 4 },
  coverSubtitle: { fontSize: 9, color: C.muted, marginBottom: 16 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  kpiCard: {
    width: "47.5%",
    borderWidth: 0.7,
    borderColor: C.line,
    backgroundColor: C.panel,
    padding: 12,
    minHeight: 70
  },
  kpiCardMain: { backgroundColor: C.panelAlt, borderColor: C.brand },
  kpiValue: { fontSize: 19, fontWeight: "bold", color: C.ink, marginBottom: 4 },
  kpiLabel: { fontSize: 8, color: C.muted, lineHeight: 1.3 },
  noteBox: {
    borderLeftWidth: 3,
    borderLeftColor: C.brand,
    backgroundColor: C.panel,
    padding: 10,
    marginTop: 8
  },
  noteText: { fontSize: 8.2, lineHeight: 1.45, color: C.ink },
  sectionTitle: { fontSize: 11, fontWeight: "bold", color: C.brandDark, marginTop: 4, marginBottom: 8 },
  sectionTotal: { fontSize: 8, color: C.muted, marginBottom: 4 },
  empty: { padding: 8, borderWidth: 0.5, borderColor: C.line, backgroundColor: C.panel, color: C.muted },
  table: { borderWidth: 0.6, borderColor: C.line, marginBottom: 12 },
  trHead: { flexDirection: "row", backgroundColor: C.brandDark, color: C.white },
  tr: { flexDirection: "row", borderTopWidth: 0.5, borderTopColor: C.line, minHeight: 25 },
  th: { fontSize: 6.6, fontWeight: "bold", color: C.white, paddingHorizontal: 4, paddingVertical: 5 },
  td: { fontSize: 7.1, color: C.ink, paddingHorizontal: 4, paddingVertical: 5, lineHeight: 1.22 },
  tdStrong: { fontWeight: "bold" },
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

type Props = {
  organizationName: string;
  logoPath: string | null;
  generatedAt: string;
  report: FinancialControlReport;
};

function Header({
  organizationName,
  logoPath,
  page
}: {
  organizationName: string;
  logoPath: string | null;
  page: string;
}) {
  return (
    <>
      <View style={styles.topHeader} fixed>
        <View style={styles.topHeaderRow}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image nie obsluguje atrybutu alt. */}
          {logoPath ? <Image src={logoPath} style={styles.logo} /> : <Text style={styles.brandWord}>GOLBUD</Text>}
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Rejestr należności i harmonogram budów</Text>
            <Text style={styles.headerSub}>Dokument roboczy - do kontroli płatności, odbiorów i wejść ekip</Text>
          </View>
        </View>
      </View>
      <View style={styles.footer} fixed>
        <Text>{pdfSafeText(organizationName)} - dokument wewnętrzny</Text>
        <Text>{page}</Text>
      </View>
    </>
  );
}

function Cell({
  children,
  width,
  strong,
  align = "left"
}: {
  children: unknown;
  width: string;
  strong?: boolean;
  align?: "left" | "right";
}) {
  return (
    <Text style={[styles.td, strong ? styles.tdStrong : {}, { width, textAlign: align }]}>
      {pdfSafeText(children)}
    </Text>
  );
}

function Head({ labels, widths }: { labels: string[]; widths: string[] }) {
  return (
    <View style={styles.trHead}>
      {labels.map((label, i) => (
        <Text key={label} style={[styles.th, { width: widths[i] }]}>
          {pdfSafeText(label)}
        </Text>
      ))}
    </View>
  );
}

function SectionShell({
  section,
  children,
  showTotal = true
}: {
  section: FinancialControlReportSection;
  children: React.ReactNode;
  showTotal?: boolean;
}) {
  return (
    <View>
      <Text style={styles.sectionTitle}>
        {section.number}. {pdfSafeText(section.title)}
      </Text>
      {showTotal && section.rows.length > 0 && (
        <Text style={styles.sectionTotal}>Suma pozycji: {formatFinancialMoney(section.total)}</Text>
      )}
      {section.rows.length === 0 ? <Text style={styles.empty}>Brak pozycji w tej sekcji.</Text> : children}
    </View>
  );
}

function ReceivablesTable({ section }: { section: FinancialControlReportSection }) {
  if (section.rows.length === 0) return null;
  return (
    <View style={styles.table}>
      <Head labels={["Lokalizacja", "Adres", "Tytuł / zakres", "Kwota", "Kto płaci", "Status / działanie"]} widths={["16%", "18%", "22%", "13%", "12%", "19%"]} />
      {section.rows.map((r) => (
        <View key={r.id} style={styles.tr}>
          <Cell width="16%" strong>{r.location}</Cell>
          <Cell width="18%">{r.address || r.clientLabel}</Cell>
          <Cell width="22%">{r.title || r.scope}</Cell>
          <Cell width="13%" strong align="right">{r.amountLabel}</Cell>
          <Cell width="12%">{r.payer}</Cell>
          <Cell width="19%">{r.statusAction || r.notes}</Cell>
        </View>
      ))}
    </View>
  );
}

function PotentialTable({ section }: { section: FinancialControlReportSection }) {
  if (section.rows.length === 0) return null;
  return (
    <View style={styles.table}>
      <Head labels={["Lokalizacja", "Zakres", "Kwota / stawka", "Warunek"]} widths={["22%", "32%", "20%", "26%"]} />
      {section.rows.map((r) => (
        <View key={r.id} style={styles.tr}>
          <Cell width="22%" strong>{r.location}</Cell>
          <Cell width="32%">{r.scope || r.title}</Cell>
          <Cell width="20%" strong>{r.amountLabel}</Cell>
          <Cell width="26%">{r.conditionLabel || r.statusAction}</Cell>
        </View>
      ))}
    </View>
  );
}

function CashTable({ section }: { section: FinancialControlReportSection }) {
  if (section.rows.length === 0) return null;
  return (
    <View style={styles.table}>
      <Head labels={["Lokalizacja", "Adres", "Kwota", "Tryb", "Status / działanie"]} widths={["21%", "21%", "15%", "16%", "27%"]} />
      {section.rows.map((r) => (
        <View key={r.id} style={styles.tr}>
          <Cell width="21%" strong>{r.location}</Cell>
          <Cell width="21%">{r.address || r.clientLabel}</Cell>
          <Cell width="15%" strong align="right">{r.amountLabel}</Cell>
          <Cell width="16%">{r.payer || "gotówka"}</Cell>
          <Cell width="27%">{r.statusAction || r.conditionLabel}</Cell>
        </View>
      ))}
    </View>
  );
}

function DisputesTable({ section }: { section: FinancialControlReportSection }) {
  if (section.rows.length === 0) return null;
  return (
    <View style={styles.table}>
      <Head labels={["Lokalizacja", "Adres / temat", "Etap", "Uwagi operacyjne"]} widths={["22%", "26%", "14%", "38%"]} />
      {section.rows.map((r) => (
        <View key={r.id} style={styles.tr}>
          <Cell width="22%" strong>{r.location}</Cell>
          <Cell width="26%">{r.address || r.title}</Cell>
          <Cell width="14%">{r.statusAction || "spór"}</Cell>
          <Cell width="38%">{r.notes || r.conditionLabel || "prowadzić oddzielny rejestr dokumentów"}</Cell>
        </View>
      ))}
    </View>
  );
}

function CompletionTable({ section }: { section: FinancialControlReportSection }) {
  if (section.rows.length === 0) return null;
  return (
    <View style={styles.table}>
      <Head labels={["Lokalizacja / klient", "Zakres", "Kwota", "Warunek odbioru"]} widths={["24%", "28%", "18%", "30%"]} />
      {section.rows.map((r) => (
        <View key={r.id} style={styles.tr}>
          <Cell width="24%" strong>{r.location || r.clientLabel}</Cell>
          <Cell width="28%">{r.scope || r.title}</Cell>
          <Cell width="18%" strong>{r.amountLabel}</Cell>
          <Cell width="30%">{r.conditionLabel || r.statusAction}</Cell>
        </View>
      ))}
    </View>
  );
}

function ScheduledTable({ section }: { section: FinancialControlReportSection }) {
  if (section.rows.length === 0) return null;
  return (
    <View style={styles.table}>
      <Head labels={["Lokalizacja", "Adres", "Telefon", "Termin", "Ekipa", "Zakres robót / uwagi"]} widths={["14%", "17%", "13%", "14%", "12%", "30%"]} />
      {section.rows.map((r) => (
        <View key={r.id} style={styles.tr}>
          <Cell width="14%" strong>{r.location}</Cell>
          <Cell width="17%">{r.address || r.clientLabel}</Cell>
          <Cell width="13%">{r.phone}</Cell>
          <Cell width="14%">{r.termLabel}</Cell>
          <Cell width="12%">{r.crewLabel}</Cell>
          <Cell width="30%">{r.scope || r.statusAction}</Cell>
        </View>
      ))}
    </View>
  );
}

function SettlementsTable({ sections }: { sections: FinancialControlReportSection[] }) {
  const rows: FinancialControlReportRow[] = sections.flatMap((s) => s.rows);
  if (rows.length === 0) return null;
  return (
    <View>
      <Text style={styles.sectionTitle}>7. Rozrachunki z ekipami / pracownikami / podwykonawcami</Text>
      <View style={styles.table}>
        <Head labels={["Typ", "Osoba / ekipa", "Budowa", "Kwota", "Status / rozliczenie"]} widths={["16%", "22%", "22%", "15%", "25%"]} />
        {rows.map((r) => (
          <View key={r.id} style={styles.tr}>
            <Cell width="16%">{r.section === "employee_settlement" ? "pracownik" : r.section === "subcontractor_settlement" ? "podwykonawca" : "ekipa"}</Cell>
            <Cell width="22%" strong>{r.crewLabel || r.clientLabel || r.title}</Cell>
            <Cell width="22%">{r.location}</Cell>
            <Cell width="15%" strong align="right">{r.amountLabel}</Cell>
            <Cell width="25%">{r.statusAction || r.notes}</Cell>
          </View>
        ))}
      </View>
    </View>
  );
}

function byId(report: FinancialControlReport, id: FinancialControlReportSection["id"]) {
  return report.sections.find((s) => s.id === id) ?? report.sections[0];
}

export function FinancialControlPdfDocument({ organizationName, logoPath, generatedAt, report }: Props) {
  const receivables = byId(report, "confirmed_receivable");
  const potential = byId(report, "potential_scope");
  const cash = byId(report, "cash_outside_transfer");
  const disputes = byId(report, "dispute");
  const completion = byId(report, "completion_receivable");
  const scheduled = byId(report, "scheduled_build");
  const settlementSections = report.sections.filter((s) =>
    ["crew_settlement", "employee_settlement", "subcontractor_settlement"].includes(s.id)
  );

  return (
    <Document title="Rejestr należności i harmonogram budów" author={organizationName} language="pl">
      <Page size="A4" style={styles.page}>
        <Header organizationName={organizationName} logoPath={logoPath} page="Strona 1" />
        <Text style={styles.coverTitle}>{pdfSafeText(organizationName)}</Text>
        <Text style={styles.coverSubtitle}>
          Rejestr należności, sporów i harmonogram budów - stan na {pdfSafeText(report.asOfDate)} - dokument wewnętrzny do kontroli płatności, odbiorów i wejść ekip
        </Text>
        <View style={styles.kpiGrid}>
          <View style={[styles.kpiCard, styles.kpiCardMain]}>
            <Text style={styles.kpiValue}>{formatFinancialMoney(report.confirmedTotal)}</Text>
            <Text style={styles.kpiLabel}>należności potwierdzone bez rat i pozycji warunkowych</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{formatFinancialMoney(report.potentialTotal)}</Text>
            <Text style={styles.kpiLabel}>potencjalne zakresy / do decyzji klienta</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{formatFinancialMoney(report.cashTotal)}</Text>
            <Text style={styles.kpiLabel}>gotówka / poza przelewem, część warunkowa po etapach</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={[styles.kpiValue, { color: C.danger }]}>{String(report.disputeCount)}</Text>
            <Text style={styles.kpiLabel}>spory sądowe / tematy do prowadzenia oddzielnie</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{formatFinancialMoney(report.completionTotal)}</Text>
            <Text style={styles.kpiLabel}>pieniądze do odbioru po zakończeniu zakresu</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{String(report.scheduledCount)}</Text>
            <Text style={styles.kpiLabel}>budowy podpisane / w realizacji / do obsadzenia ekipą</Text>
          </View>
        </View>
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>
            Uwagi operacyjne: raport łączy automatyczne salda płatności z ręcznymi pozycjami kontrolnymi właściciela. Kwoty warunkowe, gotówkowe, sporne i rozrachunkowe należy aktualizować ręcznie w zakładce raportu, bo nie zawsze wynikają z faktury lub harmonogramu.
          </Text>
          <Text style={[styles.noteText, { marginTop: 6 }]}>Wygenerowano: {pdfSafeText(generatedAt)}</Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Header organizationName={organizationName} logoPath={logoPath} page="Strona 2" />
        <SectionShell section={receivables}>
          <ReceivablesTable section={receivables} />
        </SectionShell>
        <SectionShell section={potential}>
          <PotentialTable section={potential} />
        </SectionShell>
        <SectionShell section={cash}>
          <CashTable section={cash} />
        </SectionShell>
      </Page>

      <Page size="A4" style={styles.page}>
        <Header organizationName={organizationName} logoPath={logoPath} page="Strona 3" />
        <SectionShell section={disputes} showTotal={false}>
          <DisputesTable section={disputes} />
        </SectionShell>
        <SectionShell section={completion}>
          <CompletionTable section={completion} />
        </SectionShell>
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>
            Te pozycje nie zawsze są klasyczną zaległością. Trzeba pilnować zakończenia zakresu, protokołu odbioru i faktury / rozliczenia końcowego.
          </Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Header organizationName={organizationName} logoPath={logoPath} page="Strona 4" />
        <SectionShell section={scheduled} showTotal={false}>
          <ScheduledTable section={scheduled} />
        </SectionShell>
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>{pdfSafeText(report.operationalNotes[2])}</Text>
        </View>
        <SettlementsTable sections={settlementSections} />
      </Page>
    </Document>
  );
}
