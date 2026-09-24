/**
 * Treść dokumentu (umowy, aneksu, protokołu) jako prosty tekst z oznaczeniami — do edycji
 * w polu tekstowym przed wydrukiem — i jej rozbiór na bloki do PDF.
 *
 * Wcześniej PDF znał tylko akapity i nagłówki „§”, więc wzory Dawida (listy a) b) c),
 * tabele w protokole odbioru częściowego, pola wyboru „☐ odebrano bez zastrzeżeń”, podpisy
 * w środku dokumentu) wychodziły jako ściana tekstu.
 *
 * Oznaczenia (każde na początku wiersza):
 *   # TYTUŁ                 tytuł wyśrodkowany
 *   ## Nagłówek             nagłówek sekcji
 *   § 1 Przedmiot umowy     paragraf: „§ 1” i tytuł wyśrodkowane w dwóch wierszach
 *   1. / 1) / a) / -        punkt listy; dwie spacje na początku = poziom niżej
 *   [ ] tekst / [x] tekst   pole wyboru (puste / zaznaczone)
 *   | a | b |               wiersz tabeli; wiersz „| --- | --- |” oznacza, że poprzedni to nagłówek
 *   <> tekst                wyśrodkowany akapit
 *   >> tekst                akapit do prawej
 *   [podpisy: A | B]        miejsca na podpisy w tym miejscu dokumentu
 *   ---strona---            nowa strona
 *   **tekst**               pogrubienie w dowolnym miejscu
 */

export type Run = { text: string; bold: boolean };

export type Block =
  | { type: "title"; runs: Run[] }
  | { type: "subtitle"; runs: Run[] }
  | { type: "section"; label: string; title: string }
  | { type: "paragraph"; runs: Run[]; align: "justify" | "center" | "right" }
  | { type: "item"; marker: string; level: number; runs: Run[] }
  | { type: "checkbox"; checked: boolean; level: number; runs: Run[] }
  | { type: "table"; header: Run[][] | null; rows: Run[][][] }
  | { type: "signatures"; labels: string[] }
  | { type: "pagebreak" }
  | { type: "spacer" };

/** Podział na fragmenty pogrubione i zwykłe według `**`. Niesparowana gwiazdka zostaje tekstem. */
export function parseRuns(text: string): Run[] {
  const parts = text.split("**");
  if (parts.length % 2 === 0) {
    // Nieparzysta liczba „**” — ostatnia nie ma pary, traktujemy ją dosłownie.
    const last = parts.pop() ?? "";
    parts[parts.length - 1] = `${parts[parts.length - 1]}**${last}`;
  }
  const runs: Run[] = [];
  parts.forEach((part, i) => {
    if (part) runs.push({ text: part, bold: i % 2 === 1 });
  });
  return runs.length ? runs : [{ text: "", bold: false }];
}

export function runsToText(runs: Run[]): string {
  return runs.map((r) => r.text).join("");
}

const SECTION = /^§\s*(\d+[a-z]?)\.?\s*(.*)$/i;
const ITEM = /^(\d{1,2}[.)]|[a-z][.)]|[-•–])\s+(.*)$/;
const CHECKBOX = /^\[( |x|X)\]\s*(.*)$/;
const SIGNATURES = /^\[podpisy:\s*(.*)\]$/i;
const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

function indentLevel(line: string): number {
  const spaces = line.length - line.trimStart().length;
  return Math.min(3, Math.floor(spaces / 2));
}

function tableCells(line: string): Run[][] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => parseRuns(cell.trim()));
}

export function parseDocumentBody(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      if (blocks.length && blocks[blocks.length - 1].type !== "spacer") blocks.push({ type: "spacer" });
      i += 1;
      continue;
    }

    if (/^-{3}\s*strona\s*-{3}$/i.test(line)) {
      blocks.push({ type: "pagebreak" });
      i += 1;
      continue;
    }

    if (line.startsWith("|")) {
      const rows: Run[][][] = [];
      let header: Run[][] | null = null;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = lines[i].trim();
        if (TABLE_SEPARATOR.test(row)) {
          if (rows.length === 1 && !header) header = rows.pop() ?? null;
        } else {
          rows.push(tableCells(row));
        }
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const signatures = SIGNATURES.exec(line);
    if (signatures) {
      blocks.push({ type: "signatures", labels: signatures[1].split("|").map((s) => s.trim()) });
      i += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({ type: "subtitle", runs: parseRuns(line.slice(3).trim()) });
    } else if (line.startsWith("# ")) {
      blocks.push({ type: "title", runs: parseRuns(line.slice(2).trim()) });
    } else if (SECTION.test(line)) {
      const [, num, title] = SECTION.exec(line) as RegExpExecArray;
      blocks.push({ type: "section", label: `§ ${num}`, title: title.replace(/^\*\*|\*\*$/g, "").trim() });
    } else if (line.startsWith("<> ")) {
      blocks.push({ type: "paragraph", runs: parseRuns(line.slice(3).trim()), align: "center" });
    } else if (line.startsWith(">> ")) {
      blocks.push({ type: "paragraph", runs: parseRuns(line.slice(3).trim()), align: "right" });
    } else if (CHECKBOX.test(line)) {
      const [, mark, rest] = CHECKBOX.exec(line) as RegExpExecArray;
      blocks.push({ type: "checkbox", checked: mark.toLowerCase() === "x", level: indentLevel(raw), runs: parseRuns(rest) });
    } else if (ITEM.test(line)) {
      const [, marker, rest] = ITEM.exec(line) as RegExpExecArray;
      const level = indentLevel(raw);
      // Punkt literowy „a)” bez wcięcia i tak jest podpunktem — tak piszą wzory Dawida.
      const effectiveLevel = /^[a-z][.)]$/.test(marker) ? Math.max(level, 1) : level;
      blocks.push({ type: "item", marker: marker === "•" || marker === "–" ? "-" : marker, level: effectiveLevel, runs: parseRuns(rest) });
    } else {
      blocks.push({ type: "paragraph", runs: parseRuns(line), align: "justify" });
    }
    i += 1;
  }

  while (blocks.length && blocks[blocks.length - 1].type === "spacer") blocks.pop();
  return blocks;
}

/** Czy treść ma własny tytuł („# ”) — wtedy PDF nie dokłada tytułu z pola „Tytuł”. */
export function bodyHasTitle(blocks: Block[]): boolean {
  return blocks.some((b) => b.type === "title");
}

/** Czy treść ma własne miejsca na podpisy — wtedy PDF nie dokłada ich na końcu. */
export function bodyHasSignatures(blocks: Block[]): boolean {
  return blocks.some((b) => b.type === "signatures");
}
