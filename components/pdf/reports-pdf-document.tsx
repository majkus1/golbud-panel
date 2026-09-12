import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReportMetrics, SourceMetrics, StatusMetrics } from "@/lib/reports-metrics";
import { formatReportMoney, formatReportPercent } from "@/lib/reports-metrics";
import { pdfSafeText, pdfText } from "@/lib/pdf-text";
import { PDF_FONT_FAMILY, registerPdfFonts } from "@/lib/register-pdf-fonts";

registerPdfFonts();

const C = {
  ink: "#17201b",
  muted: "#5d6b66",
  brand: "#536b4d",
  brandDark: "#3f5239",
  line: "#d6d3d1",
  panel: "#f3f2ee",
  panelAlt: "#e7ede3",
  white: "#ffffff",
  amber: "#b45309",
  emerald: "#047857",
  rose: "#be123c"
};

const styles = StyleSheet.create({
  page: { padding: 36, paddingBottom: 48, fontSize: 9, fontFamily: PDF_FONT_FAMILY, color: C.ink, backgroundColor: C.white },
  headerBand: {
    backgroundColor: C.brandDark,
    marginHorizontal: -36,
    marginTop: -36,
    paddingHorizontal: 36,
    paddingVertical: 22,
    marginBottom: 18
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logo: { width: 120, height: 40, objectFit: "contain" as const },
  headerMeta: { alignItems: "flex-end", maxWidth: "55%" },
  headerTitle: { fontSize: 18, fontWeight: "bold", color: C.white, marginBottom: 4 },
  headerSub: { fontSize: 8.5, color: "#d8e5d4", marginBottom: 2, textAlign: "right" },
  sectionTitle: { fontSize: 11, fontWeight: "bold", color: C.brandDark, marginBottom: 8, marginTop: 4 },
  sectionHint: { fontSize: 7.5, color: C.muted, marginBottom: 10, lineHeight: 1.35 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  kpiCard: {
    width: "23%",
    minWidth: 110,
    borderWidth: 0.5,
    borderColor: C.line,
    backgroundColor: C.panel,
    padding: 10,
    borderRadius: 4
  },
  kpiCardAccent: { backgroundColor: C.panelAlt, borderColor: C.brand },
  kpiLabel: { fontSize: 7, color: C.muted, marginBottom: 4, lineHeight: 1.35 },
  kpiValue: { fontSize: 16, fontWeight: "bold", color: C.ink },
  kpiSub: { fontSize: 7, color: C.muted, marginTop: 3 },
  twoCol: { flexDirection: "row", gap: 12, marginBottom: 12 },
  col: { flex: 1 },
  panel: { borderWidth: 0.5, borderColor: C.line, padding: 10, borderRadius: 4, marginBottom: 10 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: C.brandDark,
    paddingBottom: 4,
    marginBottom: 2
  },
  tableRow: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: C.line },
  th: { fontSize: 7, fontWeight: "bold", color: C.muted, textTransform: "uppercase" },
  td: { fontSize: 8, color: C.ink },
  barRow: { marginBottom: 7 },
  barLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  barLabel: { fontSize: 7.5, color: C.ink },
  barValue: { fontSize: 7.5, fontWeight: "bold", color: C.brandDark },
  barTrack: { height: 8, backgroundColor: C.panel, borderRadius: 4, overflow: "hidden" },
  barFill: { height: 8, backgroundColor: C.brand, borderRadius: 4 },
  barFillAlt: { height: 8, backgroundColor: C.brandDark, borderRadius: 4 },
  funnelStep: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  funnelLabel: { width: 88, fontSize: 8, color: C.ink },
  funnelTrack: { flex: 1, height: 14, backgroundColor: C.panel, borderRadius: 3, overflow: "hidden" },
  funnelFill: { height: 14, backgroundColor: C.brand, borderRadius: 3 },
  funnelCount: { width: 36, fontSize: 9, fontWeight: "bold", textAlign: "right", color: C.brandDark },
  payGrid: { flexDirection: "row", gap: 10 },
  payCard: { flex: 1, padding: 10, borderWidth: 0.5, borderColor: C.line, backgroundColor: C.panel, borderRadius: 4 },
  payLabel: { fontSize: 7, color: C.muted, textTransform: "uppercase", marginBottom: 4 },
  payValue: { fontSize: 13, fontWeight: "bold" },
  insightBox: {
    padding: 10,
    backgroundColor: C.panelAlt,
    borderLeftWidth: 3,
    borderLeftColor: C.brand,
    marginBottom: 12
  },
  insightTitle: { fontSize: 8, fontWeight: "bold", color: C.brandDark, marginBottom: 4 },
  insightText: { fontSize: 8, lineHeight: 1.45, color: C.ink },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: C.line,
    paddingTop: 8,
    fontSize: 7,
    color: C.muted
  }
});

type Props = {
  organizationName: string;
  logoPath: string | null;
  generatedAt: string;
  metrics: ReportMetrics;
};

function HorizontalBars({
  items,
  maxValue,
  valueKey,
  labelKey,
  formatValue
}: {
  items: { label: string; value: number }[];
  maxValue: number;
  valueKey?: never;
  labelKey?: never;
  formatValue?: (n: number) => string;
}) {
  const max = maxValue || 1;
  const fmt = formatValue ?? ((n: number) => String(n));
  const visible = items.filter((i) => i.value > 0).slice(0, 8);
  if (visible.length === 0) {
    return <Text style={{ fontSize: 8, color: C.muted }}>Brak danych w wybranym okresie.</Text>;
  }
  return (
    <View>
      {visible.map((item, idx) => {
        const pct = Math.max(4, (item.value / max) * 100);
        return (
          <View key={item.label} style={styles.barRow}>
            <View style={styles.barLabelRow}>
              <Text style={styles.barLabel}>{pdfSafeText(item.label)}</Text>
              <Text style={styles.barValue}>{fmt(item.value)}</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[idx % 2 === 0 ? styles.barFill : styles.barFillAlt, { width: `${pct}%` }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SourceTable({ rows }: { rows: SourceMetrics[] }) {
  const active = rows.filter((r) => r.total > 0);
  if (active.length === 0) {
    return <Text style={{ fontSize: 8, color: C.muted }}>Brak zapytań w wybranym okresie.</Text>;
  }
  return (
    <View>
      <View style={styles.tableHead}>
        <Text style={[styles.th, { width: "34%" }]}>Źródło</Text>
        <Text style={[styles.th, { width: "16%", textAlign: "right" }]}>Zapyt.</Text>
        <Text style={[styles.th, { width: "16%", textAlign: "right" }]}>Wygrane</Text>
        <Text style={[styles.th, { width: "18%", textAlign: "right" }]}>Konwersja</Text>
        <Text style={[styles.th, { width: "16%", textAlign: "right" }]}>Wartość</Text>
      </View>
      {active.map((r) => (
        <View key={r.source} style={styles.tableRow}>
          <Text style={[styles.td, { width: "34%" }]}>{pdfSafeText(r.source)}</Text>
          <Text style={[styles.td, { width: "16%", textAlign: "right" }]}>{r.total}</Text>
          <Text style={[styles.td, { width: "16%", textAlign: "right" }]}>{r.won}</Text>
          <Text style={[styles.td, { width: "18%", textAlign: "right" }]}>{formatReportPercent(r.conversion)}</Text>
          <Text style={[styles.td, { width: "16%", textAlign: "right" }]}>
            {r.value > 0 ? formatReportMoney(r.value) : "-"}
          </Text>
        </View>
      ))}
    </View>
  );
}

function StatusTable({ rows }: { rows: StatusMetrics[] }) {
  if (rows.length === 0) {
    return <Text style={{ fontSize: 8, color: C.muted }}>Brak spraw w wybranym okresie.</Text>;
  }
  return (
    <View>
      <View style={styles.tableHead}>
        <Text style={[styles.th, { width: "72%" }]}>Status</Text>
        <Text style={[styles.th, { width: "28%", textAlign: "right" }]}>Liczba</Text>
      </View>
      {rows.map((r) => (
        <View key={r.status} style={styles.tableRow}>
          <Text style={[styles.td, { width: "72%" }]}>{pdfSafeText(r.status)}</Text>
          <Text style={[styles.td, { width: "28%", textAlign: "right", fontWeight: "bold" }]}>{r.count}</Text>
        </View>
      ))}
    </View>
  );
}

function PageFooter({ org, page }: { org: string; page: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{pdfSafeText(org)} · Raport operacyjny GolBud</Text>
      <Text>{page}</Text>
    </View>
  );
}

export function ReportsPdfDocument({ organizationName, logoPath, generatedAt, metrics }: Props) {
  const m = metrics;
  const maxFunnel = Math.max(...m.funnel.map((f) => f.value), 1);
  const maxSource = Math.max(...m.bySource.map((s) => s.total), 1);
  const maxStatus = Math.max(...m.activeStatuses.map((s) => s.count), 1);

  const sourceBars = m.bySource
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((s) => ({ label: s.source, value: s.total }));

  const statusBars = m.activeStatuses.map((s) => ({ label: s.status, value: s.count }));

  const topSource = [...m.bySource].filter((s) => s.total > 0).sort((a, b) => b.total - a.total)[0];
  const topSourceWon = [...m.bySource].filter((s) => s.won > 0).sort((a, b) => b.won - a.won)[0];

  const kpis = [
    { label: "Zapytania", value: String(m.inquiries), sub: "wpłynęło w okresie" },
    { label: "Oferty wysłane", value: String(m.offered), sub: "etap ofertowy" },
    { label: "Wygrane", value: String(m.won), sub: "zamknięte sukcesem", accent: true },
    { label: "Utracone", value: String(m.lost), sub: "status utracone" },
    { label: "Wartość ofert", value: formatReportMoney(m.offeredValue), sub: "szacowana łącznie" },
    { label: "Wartość wygranych", value: formatReportMoney(m.wonValue), sub: "przyjęte zlecenia", accent: true },
    { label: "Konwersja oferty na wygraną", value: formatReportPercent(m.conversionOfferToWon), sub: "skuteczność ofert" },
    { label: "Konwersja zapytań na wygraną", value: formatReportPercent(m.conversionInquiryToWon), sub: "cały lejek" }
  ];

  return (
    <Document title="Raport sprzedaży i realizacji" author={organizationName} language="pl">
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          <View style={styles.headerRow}>
            {logoPath ? <Image src={logoPath} style={styles.logo} /> : <View style={{ width: 120 }} />}
            <View style={styles.headerMeta}>
              <Text style={styles.headerTitle}>Raport sprzedaży i realizacji</Text>
              <Text style={styles.headerSub}>{pdfSafeText(organizationName)}</Text>
              <Text style={styles.headerSub}>{pdfSafeText(m.periodLabel)}</Text>
              <Text style={styles.headerSub}>Wygenerowano: {pdfSafeText(generatedAt)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.insightBox}>
          <Text style={styles.insightTitle}>Podsumowanie zarządcze</Text>
          <Text style={styles.insightText}>
            {pdfSafeText(
              `W analizowanym okresie wpłynęło ${m.inquiries} zapytań, z czego ${m.offered} przeszło do etapu oferty, a ${m.won} zakończyło się wygraną o łącznej wartości ${formatReportMoney(m.wonValue)}.` +
                (m.won > 0 ? ` Średnia wartość wygranego zlecenia: ${formatReportMoney(m.avgWonValue)}.` : "") +
                (topSource ? ` Najwięcej zapytań pochodzi ze źródła "${topSource.source}" (${topSource.total}).` : "") +
                (topSourceWon
                  ? ` Najwyższa konwersja na wygrane: "${topSourceWon.source}" (${topSourceWon.won} z ${topSourceWon.total}).`
                  : "")
            )}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Kluczowe wskaźniki</Text>
        <Text style={styles.sectionHint}>Metryki liczone według daty wpłynięcia zapytania (filtr raportu).</Text>
        <View style={styles.kpiGrid}>
          {kpis.map((k) => (
            <View key={k.label} style={[styles.kpiCard, k.accent ? styles.kpiCardAccent : {}]}>
              <Text style={styles.kpiLabel}>{pdfSafeText(k.label)}</Text>
              <Text style={styles.kpiValue}>{pdfSafeText(k.value)}</Text>
              <Text style={styles.kpiSub}>{pdfSafeText(k.sub)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Lejek sprzedaży</Text>
            <View style={styles.panel}>
              {m.funnel.map((step) => {
                const pct = Math.max(step.value > 0 ? 8 : 0, (step.value / maxFunnel) * 100);
                return (
                  <View key={step.label} style={styles.funnelStep}>
                    <Text style={styles.funnelLabel}>{pdfSafeText(step.label)}</Text>
                    <View style={styles.funnelTrack}>
                      <View style={[styles.funnelFill, { width: `${pct}%` }]} />
                    </View>
                    <Text style={styles.funnelCount}>{step.value}</Text>
                  </View>
                );
              })}
            </View>
          </View>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Źródła zapytań — wykres</Text>
            <View style={styles.panel}>
              <HorizontalBars items={sourceBars} maxValue={maxSource} />
            </View>
          </View>
        </View>

        <PageFooter org={organizationName} page="Strona 1 z 2" />
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>Źródła zapytań — szczegóły</Text>
        <View style={styles.panel}>
          <SourceTable rows={m.bySource} />
        </View>

        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Statusy spraw</Text>
            <View style={styles.panel}>
              <StatusTable rows={m.activeStatuses} />
            </View>
          </View>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Rozkład statusów — wykres</Text>
            <View style={styles.panel}>
              <HorizontalBars items={statusBars} maxValue={maxStatus} />
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Płatności (cała baza — bez filtra daty)</Text>
        <Text style={styles.sectionHint}>
          Zgodnie z widokiem raportów w panelu — zestawienie należności obejmuje wszystkie płatności w systemie.
        </Text>
        <View style={styles.payGrid}>
          <View style={styles.payCard}>
            <Text style={styles.payLabel}>Należności łącznie</Text>
            <Text style={[styles.payValue, { color: C.ink }]}>{formatReportMoney(m.payments.due)}</Text>
          </View>
          <View style={styles.payCard}>
            <Text style={styles.payLabel}>Zapłacone</Text>
            <Text style={[styles.payValue, { color: C.emerald }]}>{formatReportMoney(m.payments.paid)}</Text>
            <Text style={styles.kpiSub}>Skuteczność windykacji: {formatReportPercent(m.payments.collectionRate)}</Text>
          </View>
          <View style={styles.payCard}>
            <Text style={styles.payLabel}>Zaległe po terminie</Text>
            <Text style={[styles.payValue, { color: C.amber }]}>{formatReportMoney(m.payments.overdue)}</Text>
          </View>
        </View>

        <View style={[styles.panel, { marginTop: 4 }]}>
          <Text style={styles.sectionTitle}>Wskaźnik ściągalności</Text>
          <View style={styles.barRow}>
            <View style={styles.barLabelRow}>
              <Text style={styles.barLabel}>Zapłacono z należności</Text>
              <Text style={styles.barValue}>{formatReportPercent(m.payments.collectionRate)}</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.min(100, Math.max(0, m.payments.collectionRate))}%` }]} />
            </View>
          </View>
          {m.payments.overdue > 0 && (
            <Text style={{ fontSize: 7.5, color: C.amber, marginTop: 6 }}>
              Uwaga: {formatReportMoney(m.payments.overdue)} pozostaje po terminie płatności — wymaga monitorowania.
            </Text>
          )}
        </View>

        <PageFooter org={organizationName} page="Strona 2 z 2" />
      </Page>
    </Document>
  );
}
