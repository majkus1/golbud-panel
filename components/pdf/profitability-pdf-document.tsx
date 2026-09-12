import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type React from "react";
import type { CaseProfitabilityRow, CostStructureItem, MonthlyProfitability, ProfitabilityAlert, ProfitabilitySummary } from "@/lib/profitability-report";
import { pdfSafeText } from "@/lib/pdf-text";
import { PDF_FONT_FAMILY, registerPdfFonts } from "@/lib/register-pdf-fonts";

registerPdfFonts();

const money = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0
});

const C = {
  ink: "#17201b",
  muted: "#5d6b66",
  brand: "#536b4d",
  brandDark: "#3f5239",
  line: "#d8d5cf",
  panel: "#f4f3ef",
  panelAlt: "#e9efe5",
  white: "#ffffff",
  danger: "#991b1b",
  dangerBg: "#fee2e2",
  warning: "#92400e",
  warningBg: "#fef3c7",
  info: "#075985",
  infoBg: "#e0f2fe",
  success: "#166534",
  successBg: "#dcfce7"
};

const styles = StyleSheet.create({
  page: {
    padding: 30,
    paddingBottom: 42,
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
  },
  coverTitle: { fontSize: 19, fontWeight: "bold", color: C.brandDark, marginBottom: 4 },
  coverSubtitle: { fontSize: 9, color: C.muted, marginBottom: 14, lineHeight: 1.35 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginBottom: 14 },
  kpiCard: {
    width: "31.5%",
    minHeight: 62,
    borderWidth: 0.7,
    borderColor: C.line,
    backgroundColor: C.panel,
    padding: 10
  },
  kpiMain: { backgroundColor: C.panelAlt, borderColor: C.brand },
  kpiValue: { fontSize: 15, fontWeight: "bold", color: C.ink, marginBottom: 4 },
  kpiLabel: { fontSize: 7.5, color: C.muted, lineHeight: 1.25 },
  sectionTitle: { fontSize: 11.5, fontWeight: "bold", color: C.brandDark, marginBottom: 8 },
  sectionSub: { fontSize: 7.8, color: C.muted, marginBottom: 8, lineHeight: 1.35 },
  noteBox: { borderLeftWidth: 3, borderLeftColor: C.brand, backgroundColor: C.panel, padding: 10, marginBottom: 12 },
  noteText: { fontSize: 8.2, lineHeight: 1.45, color: C.ink },
  alertGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  alert: { width: "48.5%", minHeight: 58, borderWidth: 0.7, borderColor: C.line, padding: 8 },
  alertTitle: { fontSize: 8.5, fontWeight: "bold", marginBottom: 3 },
  alertText: { fontSize: 7.1, lineHeight: 1.28 },
  columns: { flexDirection: "row", gap: 12 },
  col: { flex: 1 },
  barWrap: { marginBottom: 8 },
  barLine: { height: 7, backgroundColor: "#ece9e2", marginTop: 3 },
  barFill: { height: 7, backgroundColor: C.brand },
  barRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  table: { borderWidth: 0.6, borderColor: C.line, marginBottom: 11 },
  trHead: { flexDirection: "row", backgroundColor: C.brandDark, color: C.white },
  tr: { flexDirection: "row", borderTopWidth: 0.5, borderTopColor: C.line, minHeight: 24 },
  th: { fontSize: 6.4, fontWeight: "bold", color: C.white, paddingHorizontal: 4, paddingVertical: 5 },
  td: { fontSize: 6.8, color: C.ink, paddingHorizontal: 4, paddingVertical: 5, lineHeight: 1.18 },
  tdStrong: { fontWeight: "bold" },
  empty: { padding: 8, borderWidth: 0.5, borderColor: C.line, backgroundColor: C.panel, color: C.muted },
  smallMuted: { fontSize: 7.1, color: C.muted, lineHeight: 1.25 }
});

type Props = {
  organizationName: string;
  logoPath: string | null;
  generatedAt: string;
  summary: ProfitabilitySummary;
};

function Header({ organizationName, logoPath, page }: { organizationName: string; logoPath: string | null; page: string }) {
  return (
    <>
      <View style={styles.topHeader} fixed>
        <View style={styles.topHeaderRow}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image nie obsluguje atrybutu alt. */}
          {logoPath ? <Image src={logoPath} style={styles.logo} /> : <Text style={styles.brandWord}>GOLBUD</Text>}
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Raport zarządczy rentowności budów</Text>
            <Text style={styles.headerSub}>Zysk, strata, struktura kosztów, zaległości i alerty właścicielskie</Text>
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

function Kpi({ label, value, main }: { label: string; value: string; main?: boolean }) {
  return (
    <View style={[styles.kpiCard, main ? styles.kpiMain : {}]}>
      <Text style={styles.kpiValue}>{pdfSafeText(value)}</Text>
      <Text style={styles.kpiLabel}>{pdfSafeText(label)}</Text>
    </View>
  );
}

function AlertBox({ alert }: { alert: ProfitabilityAlert }) {
  const color =
    alert.severity === "critical"
      ? { backgroundColor: C.dangerBg, borderColor: C.danger, color: C.danger }
      : alert.severity === "warning"
        ? { backgroundColor: C.warningBg, borderColor: C.warning, color: C.warning }
        : alert.severity === "success"
          ? { backgroundColor: C.successBg, borderColor: C.success, color: C.success }
          : { backgroundColor: C.infoBg, borderColor: C.info, color: C.info };

  return (
    <View style={[styles.alert, { backgroundColor: color.backgroundColor, borderColor: color.borderColor }]}>
      <Text style={[styles.alertTitle, { color: color.color }]}>{pdfSafeText(alert.title)}</Text>
      <Text style={[styles.alertText, { color: C.ink }]}>{pdfSafeText(alert.description)}</Text>
    </View>
  );
}

function Cell({
  children,
  width,
  strong,
  align = "left",
  color
}: {
  children: unknown;
  width: string;
  strong?: boolean;
  align?: "left" | "right";
  color?: string;
}) {
  return (
    <Text style={[styles.td, strong ? styles.tdStrong : {}, { width, textAlign: align, color: color || C.ink }]}>
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

function ProgressBar({ label, value, percent }: { label: string; value: number; percent: number }) {
  return (
    <View style={styles.barWrap}>
      <View style={styles.barRow}>
        <Text style={{ fontSize: 8, fontWeight: "bold" }}>{pdfSafeText(label)}</Text>
        <Text style={{ fontSize: 8 }}>{pdfSafeText(`${money.format(value)} · ${percent.toFixed(1)}%`)}</Text>
      </View>
      <View style={styles.barLine}>
        <View style={[styles.barFill, { width: `${Math.min(100, percent)}%` }]} />
      </View>
    </View>
  );
}

function CostStructure({ items }: { items: CostStructureItem[] }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>Struktura kosztów</Text>
      <Text style={styles.sectionSub}>Kategorie, które najmocniej obciążają marżę.</Text>
      {items.length === 0 ? (
        <Text style={styles.empty}>Brak kosztów do analizy.</Text>
      ) : (
        items.map((item) => <ProgressBar key={item.key} label={item.label} value={item.value} percent={item.percent} />)
      )}
    </View>
  );
}

function MonthlyTrend({ rows }: { rows: MonthlyProfitability[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.revenue, r.cost, Math.abs(r.profit))));
  return (
    <View>
      <Text style={styles.sectionTitle}>Trend miesięczny</Text>
      <Text style={styles.sectionSub}>Faktury sprzedażowe i koszty według dat dokumentów, pracy oraz rozliczeń.</Text>
      {rows.length === 0 ? (
        <Text style={styles.empty}>Brak danych miesięcznych.</Text>
      ) : (
        rows.slice(-8).map((r) => (
          <View key={r.month} style={{ marginBottom: 7 }}>
            <View style={styles.barRow}>
              <Text style={{ fontSize: 8, fontWeight: "bold" }}>{pdfSafeText(r.label)}</Text>
              <Text style={{ fontSize: 8, color: r.profit < 0 ? C.danger : C.success }}>{pdfSafeText(`${money.format(r.profit)} · ${r.marginPct.toFixed(1)}%`)}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 4, marginTop: 3 }}>
              <View style={{ width: `${Math.max(3, (r.revenue / max) * 100)}%`, height: 6, backgroundColor: C.brand }} />
              <View style={{ width: `${Math.max(3, (r.cost / max) * 100)}%`, height: 6, backgroundColor: "#d97706" }} />
              <View style={{ width: `${Math.max(3, (Math.abs(r.profit) / max) * 100)}%`, height: 6, backgroundColor: r.profit < 0 ? C.danger : C.success }} />
            </View>
            <Text style={styles.smallMuted}>Przychód {money.format(r.revenue)} / koszt {money.format(r.cost)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function ProfitabilityTable({ rows }: { rows: CaseProfitabilityRow[] }) {
  return (
    <View style={styles.table}>
      <Head labels={["Budowa", "Plan koszt", "Koszt", "Prognoza", "Pewność", "Marża", "Odchyl."]} widths={["27%", "13%", "13%", "15%", "10%", "9%", "13%"]} />
      {rows.map((row) => (
        <View key={row.caseId} style={styles.tr} wrap={false}>
          <Cell width="27%" strong>{`${row.clientName}${row.location ? `, ${row.location}` : ""}`}</Cell>
          <Cell width="13%" align="right">{row.plannedCost > 0 ? money.format(row.plannedCost) : "-"}</Cell>
          <Cell width="13%" align="right">{money.format(row.totalCost)}</Cell>
          <Cell width="15%" align="right" strong color={row.forecastProfit < 0 ? C.danger : C.success}>{money.format(row.forecastProfit)}</Cell>
          <Cell width="10%">{row.forecastConfidence === "high" ? "wysoka" : row.forecastConfidence === "medium" ? "średnia" : "niska"}</Cell>
          <Cell width="9%" align="right">{`${row.marginPct.toFixed(1)}%`}</Cell>
          <Cell width="13%" align="right" color={row.costVariance > 0 ? C.warning : C.success}>{row.plannedCost > 0 ? money.format(row.costVariance) : "-"}</Cell>
        </View>
      ))}
    </View>
  );
}

function RiskTable({ title, rows, valueLabel, value }: { title: string; rows: CaseProfitabilityRow[]; valueLabel: string; value: (row: CaseProfitabilityRow) => string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.sectionTitle}>{pdfSafeText(title)}</Text>
      {rows.length === 0 ? (
        <Text style={styles.empty}>Brak pozycji.</Text>
      ) : (
        <View style={styles.table}>
          <Head labels={["Budowa", "Status", valueLabel, "Co sprawdzić"]} widths={["34%", "18%", "18%", "30%"]} />
          {rows.map((row) => (
            <View key={`${title}-${row.caseId}`} style={styles.tr} wrap={false}>
              <Cell width="34%" strong>{`${row.clientName}${row.location ? `, ${row.location}` : ""}`}</Cell>
              <Cell width="18%">{row.status}</Cell>
              <Cell width="18%" strong align="right">{value(row)}</Cell>
              <Cell width="30%">{row.profit < 0 ? "koszty, zakres, dopłaty" : row.unpaidRevenue > 0 ? "harmonogram płatności" : "wycena i faktury materiałowe"}</Cell>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function ProfitabilityPdfDocument({ organizationName, logoPath, generatedAt, summary }: Props) {
  const sortedRows = [...summary.rows].sort((a, b) => a.profit - b.profit);
  const executiveNote =
    summary.profit < 0
      ? "Łączny wynik jest ujemny. Priorytetem powinno być domknięcie dopłat od klientów, kontrola kosztów materiałowych i weryfikacja budów ze stratą."
      : summary.marginPct < 15
        ? "Firma jest na plusie, ale marża jest niska. Warto sprawdzić budowy z dużym udziałem materiałów i niską marżą przed kolejnymi wycenami."
        : "Firma jest na plusie. Raport wskazuje, które budowy powielać jako model wyceny oraz gdzie odzyskać gotówkę z harmonogramów.";

  return (
    <Document title="Raport zarządczy rentowności budów GOLBUD" author={organizationName}>
      <Page size="A4" style={styles.page}>
        <Header organizationName={organizationName} logoPath={logoPath} page="1 / 4" />
        <Text style={styles.coverTitle}>Raport zarządczy rentowności budów</Text>
        <Text style={styles.coverSubtitle}>Wygenerowano: {pdfSafeText(generatedAt)}. Dokument pokazuje, gdzie firma zarabia, gdzie traci i gdzie jest zamrożona gotówka.</Text>
        <View style={styles.kpiGrid}>
          <Kpi main label="Wynik na wartości umownej" value={money.format(summary.profit)} />
          <Kpi main label="Marża łączna" value={`${summary.marginPct.toFixed(1)}%`} />
          <Kpi label="Wartość umowna / plan" value={money.format(summary.revenuePlanned)} />
          <Kpi label="Wystawione faktury" value={money.format(summary.revenueInvoiced)} />
          <Kpi label="Należności powstałe" value={money.format(summary.revenueDue)} />
          <Kpi label="Wpłacone od klientów" value={money.format(summary.revenuePaid)} />
          <Kpi label="Koszty łącznie" value={money.format(summary.totalCost)} />
          <Kpi label="Budżet kosztów z planów" value={money.format(summary.plannedCost)} />
          <Kpi main label="Prognoza końcowego zysku" value={money.format(summary.forecastProfit)} />
          <Kpi label="Prognozowana marża" value={`${summary.forecastMarginPct.toFixed(1)}%`} />
          <Kpi label="Otwarte należności" value={money.format(summary.unpaidRevenue)} />
          <Kpi label="Należności po terminie" value={money.format(summary.overdueRevenue)} />
          <Kpi label="Niezapłacone koszty" value={money.format(summary.costUnpaid)} />
          <Kpi label="Budowy na minusie" value={String(summary.lossMakers.length)} />
          <Kpi label="Budowy z niską marżą" value={String(summary.lowMarginRows.length)} />
        </View>
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>{pdfSafeText(executiveNote)}</Text>
        </View>
        <Text style={styles.sectionTitle}>Najważniejsze alerty</Text>
        <View style={styles.alertGrid}>
          {summary.alerts.slice(0, 10).map((alert) => <AlertBox key={alert.id} alert={alert} />)}
          {summary.alerts.length === 0 && <Text style={styles.empty}>Brak alertów w obecnych danych.</Text>}
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Header organizationName={organizationName} logoPath={logoPath} page="2 / 4" />
        <View style={styles.columns}>
          <View style={styles.col}>
            <CostStructure items={summary.costStructure} />
          </View>
          <View style={styles.col}>
            <MonthlyTrend rows={summary.monthly} />
          </View>
        </View>
        <View style={{ marginTop: 16 }}>
          <Text style={styles.sectionTitle}>Najbardziej rentowne budowy</Text>
          <ProfitabilityTable rows={summary.topProfitable} />
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Header organizationName={organizationName} logoPath={logoPath} page="3 / 4" />
        <Text style={styles.sectionTitle}>Rentowność według budów</Text>
        <Text style={styles.sectionSub}>Tabela posortowana od najsłabszego wyniku do najlepszego, aby najpierw widzieć miejsca wymagające decyzji.</Text>
        <ProfitabilityTable rows={sortedRows} />
      </Page>

      <Page size="A4" style={styles.page}>
        <Header organizationName={organizationName} logoPath={logoPath} page="4 / 4" />
        <RiskTable title="Budowy ze stratą" rows={summary.lossMakers} valueLabel="Wynik" value={(row) => money.format(row.profit)} />
        <RiskTable title="Największe zaległości klientów" rows={summary.unpaidRows} valueLabel="Do zapłaty" value={(row) => money.format(row.unpaidRevenue)} />
        <RiskTable title="Niska marża" rows={summary.lowMarginRows} valueLabel="Marża" value={(row) => `${row.marginPct.toFixed(1)}%`} />
        <RiskTable title="Materiały ponad normę" rows={summary.highMaterialRows} valueLabel="Materiały" value={(row) => `${((row.materialCost / Math.max(1, row.revenuePlanned)) * 100).toFixed(1)}%`} />
      </Page>
    </Document>
  );
}
