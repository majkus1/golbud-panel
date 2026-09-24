import { Document, Page, StyleSheet, View } from "@react-pdf/renderer";
import { Text } from "@/components/pdf/pdf-primitives";
import { DocFooter, Letterhead, PageNumber } from "@/components/pdf/letterhead";
import { bodyHasSignatures, bodyHasTitle, parseDocumentBody, runsToText, type Block, type Run } from "@/lib/document-body";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import { pdfText } from "@/lib/pdf-text";
import { PDF_FONT_FAMILY, registerPdfFonts } from "@/lib/register-pdf-fonts";

registerPdfFonts();

/**
 * Dokument z wzoru (umowa, aneks, protokół, oświadczenie). Treść przychodzi jako tekst
 * z oznaczeniami (lib/document-body.ts) — ten sam, który użytkownik poprawił w polu tekstowym.
 */

const C = {
  ink: "#17201b",
  muted: "#5d6b66",
  line: "#bdb8b3",
  headerBg: "#f3f1ee"
};

const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingHorizontal: 40, paddingBottom: 50, fontSize: 9.5, fontFamily: PDF_FONT_FAMILY, color: C.ink, lineHeight: 1.45 },
  docTitle: { fontSize: 12.5, fontWeight: "bold", textAlign: "center", marginTop: 4, marginBottom: 2 },
  docMeta: { fontSize: 8, color: C.muted, textAlign: "center", marginBottom: 10 },
  title: { fontSize: 12.5, fontWeight: "bold", textAlign: "center", marginTop: 6, marginBottom: 6 },
  subtitle: { fontSize: 10.5, fontWeight: "bold", marginTop: 8, marginBottom: 3 },
  section: { marginTop: 10, marginBottom: 4 },
  sectionLine: { fontSize: 10, fontWeight: "bold", textAlign: "center" },
  para: { marginBottom: 3 },
  itemRow: { flexDirection: "row", marginBottom: 2.5 },
  itemMarker: { width: 18 },
  itemText: { flex: 1, textAlign: "justify" },
  checkRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 3 },
  checkBox: { width: 8.5, height: 8.5, borderWidth: 0.8, borderColor: C.ink, marginTop: 2.5, marginRight: 7, alignItems: "center", justifyContent: "center" },
  checkMark: { width: 4.5, height: 4.5, backgroundColor: C.ink },
  table: { borderTopWidth: 0.6, borderLeftWidth: 0.6, borderColor: C.line, marginVertical: 5 },
  tableRow: { flexDirection: "row" },
  tableCell: { borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: C.line, paddingVertical: 3, paddingHorizontal: 4, fontSize: 8.5, minHeight: 16 },
  tableHead: { backgroundColor: C.headerBg, fontWeight: "bold" },
  signatures: { flexDirection: "row", marginTop: 20, gap: 32 },
  signCol: { flex: 1 },
  signLine: { borderTopWidth: 0.6, borderTopColor: C.ink, marginTop: 26, paddingTop: 3, fontSize: 7.5, color: C.muted, textAlign: "center" },
  spacer: { height: 5 },
  parties: { flexDirection: "row", gap: 12, marginBottom: 12 },
  partyBox: { flex: 1, borderWidth: 0.5, borderColor: C.line, padding: 8, minHeight: 70 },
  partyTitle: { fontSize: 8, fontWeight: "bold", marginBottom: 4, textTransform: "uppercase" },
  partyLine: { fontSize: 8.5, marginBottom: 1.5 }
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
  /** „boxes” — ramki Wykonawca / Zamawiający nad treścią; „none” — strony opisane w treści. */
  parties: "boxes" | "none";
  buyer: Party;
  body: string;
  /** Podpisy na końcu; pomijane, gdy treść ma własne `[podpisy: …]`. */
  signatures: string[];
  footer?: string | null;
};

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, i) =>
        run.bold ? (
          <Text key={`r-${i}`} style={{ fontWeight: "bold" }}>
            {pdfText(run.text)}
          </Text>
        ) : (
          <Text key={`r-${i}`}>{pdfText(run.text)}</Text>
        )
      )}
    </>
  );
}

function PartyBlock({ title, lines }: { title: string; lines: string[] }) {
  const visible = lines.filter((l) => l.trim().length > 0);
  return (
    <View style={styles.partyBox}>
      <Text style={styles.partyTitle}>{title}</Text>
      {(visible.length ? visible : ["—"]).map((line, i) => (
        <Text key={`${title}-${i}`} style={styles.partyLine}>
          {pdfText(line)}
        </Text>
      ))}
    </View>
  );
}

function Signatures({ labels }: { labels: string[] }) {
  return (
    <View style={styles.signatures} wrap={false}>
      {labels.map((label, i) =>
        label ? (
          <View key={`s-${i}`} style={styles.signCol}>
            <Text style={styles.signLine}>{pdfText(label)}</Text>
          </View>
        ) : (
          <View key={`s-${i}`} style={styles.signCol} />
        )
      )}
      {/* Jeden podpis nie rozciąga się na całą szerokość strony. */}
      {labels.length === 1 ? <View style={styles.signCol} /> : null}
    </View>
  );
}

function TableBlock({ header, rows }: { header: Run[][] | null; rows: Run[][][] }) {
  const columns = Math.max(header?.length ?? 0, ...rows.map((r) => r.length));
  // Wąska pierwsza kolumna, gdy to numer pozycji („Lp.”).
  const firstIsLp = header?.[0]?.map((r) => r.text).join("").trim().toLowerCase() === "lp.";
  // Kolumna z nazwą pozycji (druga po „Lp.”) szersza — reszta to krótkie liczby i jednostki.
  const cellStyle = (index: number) =>
    firstIsLp && index === 0 ? { width: 26 } : firstIsLp && index === 1 && columns >= 4 ? { flex: 2.4 } : { flex: 1 };
  const renderRow = (cells: Run[][], key: string, head: boolean) => (
    <View key={key} style={styles.tableRow} wrap={false}>
      {Array.from({ length: columns }, (_, i) => (
        <Text key={`${key}-${i}`} style={[styles.tableCell, cellStyle(i), ...(head ? [styles.tableHead] : [])]}>
          <Runs runs={cells[i] ?? []} />
        </Text>
      ))}
    </View>
  );
  return (
    <View style={styles.table}>
      {header ? renderRow(header, "h", true) : null}
      {rows.map((row, i) => renderRow(row, `r${i}`, false))}
    </View>
  );
}

/**
 * Punkt listy nie może się rozjechać między strony tak, że numer „3.” zostaje sam na dole
 * strony, a treść przechodzi dalej. Zwykłe punkty trzymamy w całości; tylko bardzo długie
 * (dłuższe niż pół strony) mogą się łamać, bo inaczej zostawiałyby pustą połowę strony.
 */
const KEEP_ITEM_TOGETHER_CHARS = 900;

function keepTogether(runs: Run[]): boolean {
  return runsToText(runs).length < KEEP_ITEM_TOGETHER_CHARS;
}

function BlockView({ block, index }: { block: Block; index: number }) {
  const key = `b-${index}`;
  switch (block.type) {
    case "title":
      return (
        <Text key={key} style={styles.title} minPresenceAhead={40}>
          <Runs runs={block.runs} />
        </Text>
      );
    case "subtitle":
      return (
        <Text key={key} style={styles.subtitle} minPresenceAhead={30}>
          <Runs runs={block.runs} />
        </Text>
      );
    case "section":
      return (
        <View key={key} style={styles.section} wrap={false} minPresenceAhead={40}>
          <Text style={styles.sectionLine}>{pdfText(block.label)}</Text>
          {block.title ? <Text style={styles.sectionLine}>{pdfText(block.title)}</Text> : null}
        </View>
      );
    case "paragraph":
      return (
        <Text key={key} style={[styles.para, { textAlign: block.align }]}>
          <Runs runs={block.runs} />
        </Text>
      );
    case "item":
      return (
        <View key={key} style={[styles.itemRow, { paddingLeft: block.level * 16 }]} wrap={!keepTogether(block.runs)}>
          <Text style={styles.itemMarker}>{pdfText(block.marker === "-" ? "–" : block.marker)}</Text>
          <Text style={styles.itemText}>
            <Runs runs={block.runs} />
          </Text>
        </View>
      );
    case "checkbox":
      return (
        <View key={key} style={[styles.checkRow, { paddingLeft: block.level * 16 }]} wrap={false}>
          <View style={styles.checkBox}>{block.checked ? <View style={styles.checkMark} /> : null}</View>
          <Text style={styles.itemText}>
            <Runs runs={block.runs} />
          </Text>
        </View>
      );
    case "table":
      return <TableBlock key={key} header={block.header} rows={block.rows} />;
    case "signatures":
      return <Signatures key={key} labels={block.labels} />;
    case "pagebreak":
      return <View key={key} break />;
    case "spacer":
      return <View key={key} style={styles.spacer} />;
    default:
      return null;
  }
}

export function DocumentPdfDocument({ logoPath, title, docNumber, docDate, seller, parties, buyer, body, signatures, footer }: Props) {
  const blocks = parseDocumentBody(body);
  const showTitle = !bodyHasTitle(blocks);
  const showEndSignatures = signatures.length > 0 && !bodyHasSignatures(blocks);

  const sellerLines = [
    seller.legalName,
    seller.nip ? `NIP: ${seller.nip}` : "",
    seller.krs ? `KRS: ${seller.krs}` : "",
    seller.addressLine,
    seller.postalCity,
    seller.phone ? `tel. ${seller.phone}` : "",
    seller.email
  ];
  const buyerLines = [
    buyer.name,
    buyer.nip ? `PESEL/NIP: ${buyer.nip}` : "",
    buyer.address || "",
    buyer.city || "",
    buyer.phone ? `tel. ${buyer.phone}` : "",
    buyer.email || ""
  ];

  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <Letterhead seller={seller} logoPath={logoPath} />
        <DocFooter text={footer || seller.slogan || shortFooter(seller)} />

        {showTitle ? (
          <>
            <Text style={styles.docTitle}>{pdfText(title)}</Text>
            <Text style={styles.docMeta}>{`${docNumber ? `Nr ${pdfText(docNumber)} · ` : ""}${pdfText(docDate)}`}</Text>
          </>
        ) : null}

        {parties === "boxes" ? (
          <View style={styles.parties}>
            <PartyBlock title="Wykonawca" lines={sellerLines} />
            <PartyBlock title="Zamawiający" lines={buyerLines} />
          </View>
        ) : null}

        {groupWithSignatures(blocks, showEndSignatures).map((group, g) =>
          group.keep ? (
            <View key={`g-${g}`} wrap={false}>
              {group.items.map(({ block, index }) => (
                <BlockView key={`b-${index}`} block={block} index={index} />
              ))}
              {group.endSignatures ? <Signatures labels={signatures} /> : null}
            </View>
          ) : (
            group.items.map(({ block, index }) => <BlockView key={`b-${index}`} block={block} index={index} />)
          )
        )}
        <PageNumber />
      </Page>
    </Document>
  );
}

type BlockGroup = { keep: boolean; endSignatures: boolean; items: { block: Block; index: number }[] };

/** Ile tekstu (znaków) może przejść razem z podpisami na następną stronę. */
const KEEP_WITH_SIGNATURES_CHARS = 700;

function blockLength(block: Block): number {
  if ("runs" in block) return runsToText(block.runs).length;
  if (block.type === "section") return block.label.length + block.title.length + 40;
  if (block.type === "table") return 400;
  return 20;
}

/**
 * Podpisy nie mogą zostać same na pustej stronie. Ostatni akapit (albo cały krótki ostatni
 * paragraf „§”) trzymamy razem z miejscami na podpisy — gdy nie mieszczą się na stronie,
 * przechodzą na następną razem. To samo dla podpisów w środku treści (`[podpisy: …]`).
 */
function groupWithSignatures(blocks: Block[], endSignatures: boolean): BlockGroup[] {
  const indexed = blocks.map((block, index) => ({ block, index }));
  const groups: BlockGroup[] = [];
  let current: BlockGroup = { keep: false, endSignatures: false, items: [] };
  const flush = () => {
    if (current.items.length) groups.push(current);
    current = { keep: false, endSignatures: false, items: [] };
  };

  // Podpisy w treści: z poprzednim blokiem treści.
  for (const item of indexed) {
    if (item.block.type === "signatures") {
      let prev = current.items.pop();
      while (prev && prev.block.type === "spacer") prev = current.items.pop();
      flush();
      groups.push({ keep: true, endSignatures: false, items: prev ? [prev, item] : [item] });
      continue;
    }
    current.items.push(item);
  }
  flush();

  if (!endSignatures) return groups;

  // Podpisy na końcu: z ostatnim krótkim paragrafem albo przynajmniej z ostatnim akapitem.
  const last = groups[groups.length - 1];
  if (!last || last.keep) {
    groups.push({ keep: true, endSignatures: true, items: [] });
    return groups;
  }
  const tail: { block: Block; index: number }[] = [];
  let length = 0;
  while (last.items.length) {
    const item = last.items[last.items.length - 1];
    const next = length + blockLength(item.block);
    if (tail.length > 0 && next > KEEP_WITH_SIGNATURES_CHARS) break;
    tail.unshift(item);
    last.items.pop();
    length = next;
    if (item.block.type === "section") break;
  }
  if (!last.items.length) groups.pop();
  groups.push({ keep: true, endSignatures: true, items: tail });
  return groups;
}

function shortFooter(seller: OfferSellerProfile): string {
  return [seller.legalName, seller.nip ? `NIP ${seller.nip}` : ""].filter(Boolean).join(" · ");
}
