import { UNITS } from "@/lib/domain";
import type { EstimateImportDraft, ImportedEstimateLine, Unit } from "@/lib/types";

/**
 * Import kosztorysu zewnętrznego (CSV/XLSX) do pozycji oferty.
 * Warstwa czysta: parsowanie CSV + normalizacja tabeli 2D do pozycji.
 * XLSX jest wczytywany po stronie klienta (dynamiczny import SheetJS) i podawany tu jako tablica wierszy.
 */

export type { ImportedEstimateLine as ImportedLine, EstimateImportDraft } from "@/lib/types";

export type RawCell = string | number | boolean | null | undefined;
export type RawTable = RawCell[][];

export type EstimateParseResult = {
  lines: ImportedEstimateLine[];
  headerDetected: boolean;
  skippedRows: number;
};

/** Wykrywa separator (PL Excel zwykle ';') i parsuje CSV z obsługą cudzysłowów. */
export function parseCsv(text: string): RawTable {
  const clean = text.replace(/^\uFEFF/, "");
  const sample = clean.slice(0, 5000);
  const semis = (sample.match(/;/g) || []).length;
  const commas = (sample.match(/,/g) || []).length;
  const tabs = (sample.match(/\t/g) || []).length;
  const delimiter = tabs > semis && tabs > commas ? "\t" : semis >= commas ? ";" : ",";

  const rows: RawTable = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\r") {
      // ignoruj — CRLF obsłużone przez \n
    } else if (ch === "\n") {
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  return rows.filter((r) => r.some((c) => String(c ?? "").trim().length > 0));
}

function deburr(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Liczba w formacie PL: "1 234,56 zł" → 1234.56 */
export function parsePlNumber(value: RawCell): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const cleaned = String(value)
    .replace(/\s|\u00a0/g, "")
    .replace(/(zł|pln|netto|brutto)/gi, "")
    .replace(/[^0-9,.\-]/g, "");
  if (!cleaned) return 0;
  // Jeśli są i kropki, i przecinki — przecinek to separator dziesiętny, kropki to tysiące.
  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

const UNIT_SET = new Set<string>(UNITS);

export function normalizeUnit(value: RawCell): Unit {
  const raw = deburr(String(value ?? ""));
  if (!raw) return "szt.";
  if (UNIT_SET.has(String(value).trim())) return String(value).trim() as Unit;
  if (/(m2|m²|m\^2|metr.?kw)/.test(raw)) return "m²";
  if (/^mb$|metr.?bie|^m$/.test(raw)) return "mb";
  if (/(rg|r-g|roboczo|godz)/.test(raw)) return "roboczogodz.";
  if (/(kpl|komplet)/.test(raw)) return "kpl.";
  if (/(usl|usług|usluga)/.test(raw)) return "usługa";
  if (/(szt|sztuk)/.test(raw)) return "szt.";
  return "szt.";
}

function guessSection(value: RawCell): "labor" | "material" | null {
  const raw = deburr(String(value ?? ""));
  if (!raw) return null;
  if (/(robocizn|montaz|usług|robot|praca)/.test(raw)) return "labor";
  if (/(materia|towar|produkt)/.test(raw)) return "material";
  return null;
}

type ColumnMap = {
  name: number;
  unit: number;
  quantity: number;
  rate: number;
  value: number;
  section: number;
};

function detectColumns(headerRow: RawCell[]): ColumnMap | null {
  const map: ColumnMap = { name: -1, unit: -1, quantity: -1, rate: -1, value: -1, section: -1 };
  let hits = 0;
  headerRow.forEach((cell, idx) => {
    const h = deburr(String(cell ?? ""));
    if (!h) return;
    if (map.name < 0 && /(nazwa|opis|pozycj|wyszczegoln|zakres)/.test(h)) {
      map.name = idx;
      hits += 1;
    } else if (map.unit < 0 && /(jedn|^jm$|j\.m|miara)/.test(h)) {
      map.unit = idx;
      hits += 1;
    } else if (map.quantity < 0 && /(ilosc|liczba|qty|ilo)/.test(h)) {
      map.quantity = idx;
      hits += 1;
    } else if (map.rate < 0 && /(cena|stawka|price)/.test(h)) {
      map.rate = idx;
      hits += 1;
    } else if (map.value < 0 && /(wartosc|kwota|suma|razem)/.test(h)) {
      map.value = idx;
      hits += 1;
    } else if (map.section < 0 && /(rodzaj|sekcja|typ|kategor)/.test(h)) {
      map.section = idx;
      hits += 1;
    }
  });
  return hits >= 2 && map.name >= 0 ? map : null;
}

/** Normalizuje surową tabelę do pozycji oferty. Wykrywa nagłówek; bez nagłówka zakłada kolejność: nazwa, j.m., ilość, cena. */
export function normalizeEstimateTable(table: RawTable): EstimateParseResult {
  const rows = table.filter((r) => r.some((c) => String(c ?? "").trim().length > 0));
  if (rows.length === 0) return { lines: [], headerDetected: false, skippedRows: 0 };

  const columns = detectColumns(rows[0]);
  const headerDetected = columns !== null;
  const dataRows = headerDetected ? rows.slice(1) : rows;

  const map: ColumnMap = columns ?? { name: 0, unit: 1, quantity: 2, rate: 3, value: 4, section: 5 };

  const lines: ImportedEstimateLine[] = [];
  let skipped = 0;

  for (const r of dataRows) {
    const name = String(r[map.name] ?? "").trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    const quantity = map.quantity >= 0 ? parsePlNumber(r[map.quantity]) : 0;
    let unitRate = map.rate >= 0 ? parsePlNumber(r[map.rate]) : 0;
    const value = map.value >= 0 ? parsePlNumber(r[map.value]) : 0;
    // Gdy brak ceny jednostkowej, a jest wartość i ilość — wylicz stawkę.
    if (unitRate === 0 && value > 0 && quantity > 0) {
      unitRate = Math.round((value / quantity) * 100) / 100;
    }
    const section = (map.section >= 0 ? guessSection(r[map.section]) : null) ?? "material";

    lines.push({
      section,
      name,
      unit: normalizeUnit(map.unit >= 0 ? r[map.unit] : ""),
      quantity: quantity || 1,
      unitRate
    });
  }

  return { lines, headerDetected, skippedRows: skipped };
}

export function selectedEstimateLines(draft: EstimateImportDraft | null): ImportedEstimateLine[] {
  if (!draft) return [];
  return draft.lines.filter((_, i) => draft.include[i]);
}

export function sumEstimateLines(lines: ImportedEstimateLine[]): number {
  return lines.reduce((s, l) => s + l.quantity * l.unitRate, 0);
}

/** Wczytuje plik CSV/XLSX i zwraca znormalizowane pozycje. */
export async function parseEstimateFile(file: File): Promise<{
  lines: ImportedEstimateLine[];
  headerInfo: string;
  sourceLabel: string;
}> {
  const lower = file.name.toLowerCase();
  let table: RawTable;
  if (lower.endsWith(".csv") || file.type === "text/csv" || lower.endsWith(".txt")) {
    table = parseCsv(await file.text());
  } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as RawTable;
  } else {
    throw new Error("Obsługiwane formaty: CSV, XLSX, XLS");
  }
  const result = normalizeEstimateTable(table);
  if (result.lines.length === 0) {
    throw new Error("Nie rozpoznano żadnej pozycji w pliku");
  }
  const headerInfo = `${result.lines.length} pozycji${result.headerDetected ? " (wykryto nagłówek)" : " (bez nagłówka — założono kolejność: nazwa, j.m., ilość, cena)"}.`;
  return { lines: result.lines, headerInfo, sourceLabel: file.name };
}
