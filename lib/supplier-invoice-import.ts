import type { CaseRow, SupplierInvoice, SupplierInvoiceCategory, SupplierInvoiceCategoryRule, SupplierInvoiceStatus } from "@/lib/types";
import { warsawTodayIso } from "@/lib/warsaw-today";

export type ImportSource = "csv" | "xlsx" | "ocr";

export type RawInvoiceImportRow = Record<string, unknown>;

export type SupplierInvoiceImportPreviewRow = {
  rowId: string;
  supplier_name: string;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  case_id: string | null;
  case_label: string | null;
  category: SupplierInvoiceCategory;
  category_confidence: number;
  category_reason: string;
  net_total: number | null;
  gross_total: number;
  paid_amount: number;
  status: SupplierInvoiceStatus;
  notes: string | null;
  duplicate: boolean;
  duplicate_reason: string | null;
  raw: RawInvoiceImportRow;
};

const CATEGORY_KEYWORDS: Record<SupplierInvoiceCategory, string[]> = {
  materialy: ["hurtownia", "material", "materiał", "styropian", "klej", "siatka", "welna", "wełna", "farba", "grunt", "tynk", "listwa", "kolki", "kołki", "castorama", "leroy", "psb"],
  robocizna: ["robocizna", "usluga", "usługa", "montaz", "montaż", "wykonanie", "prace", "godziny"],
  sprzet: ["sprzet", "sprzęt", "rusztowanie", "wynajem", "narzedzia", "narzędzia", "maszyna", "agregat"],
  transport: ["transport", "paliwo", "kurier", "dostawa", "przewoz", "przewóz", "logistyka"],
  podwykonawca: ["podwykonawca", "ekipa", "brygada", "firma wykonawcza"],
  inne: ["inne", "opłata", "oplata", "administracja"]
};

const HEADER_ALIASES: Record<string, string[]> = {
  supplier_name: ["dostawca", "hurtownia", "kontrahent", "sprzedawca", "supplier", "vendor"],
  invoice_number: ["numer", "nr", "nr faktury", "numer faktury", "faktura", "invoice", "invoice number"],
  invoice_date: ["data", "data faktury", "wystawiono", "invoice date", "date"],
  due_date: ["termin", "termin platnosci", "termin płatności", "due date"],
  case_text: ["sprawa", "budowa", "klient", "zlecenie", "adres", "lokalizacja"],
  category: ["kategoria", "typ", "rodzaj", "category"],
  net_total: ["netto", "kwota netto", "net"],
  gross_total: ["brutto", "kwota brutto", "razem", "wartosc", "wartość", "gross", "total"],
  paid_amount: ["zaplacono", "zapłacono", "oplacono", "opłacono", "paid"],
  notes: ["uwagi", "opis", "notatka", "notes", "description"]
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("pl-PL")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function cell(row: RawInvoiceImportRow, key: string): string {
  const aliases = HEADER_ALIASES[key] || [key];
  const found = Object.entries(row).find(([rawKey]) => aliases.includes(normalizeText(rawKey)));
  return String(found?.[1] ?? "").trim();
}

export function parseImportAmount(value: unknown): number {
  const source = String(value ?? "")
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");
  const parsed = Number(source);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: unknown): string {
  const source = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
  const match = source.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  const parsed = new Date(source);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return warsawTodayIso();
}

function statusFromAmounts(gross: number, paid: number): SupplierInvoiceStatus {
  if (paid >= gross && gross > 0) return "oplacona";
  if (paid > 0) return "czesciowo";
  return "nieoplacona";
}

function categoryFromValue(value: string): SupplierInvoiceCategory | null {
  const normalized = normalizeText(value);
  const allowed: SupplierInvoiceCategory[] = ["materialy", "robocizna", "sprzet", "transport", "podwykonawca", "inne"];
  return allowed.find((category) => normalizeText(category) === normalized) || null;
}

function suggestCategory(row: RawInvoiceImportRow, rules: SupplierInvoiceCategoryRule[]) {
  const explicit = categoryFromValue(cell(row, "category"));
  if (explicit) return { category: explicit, confidence: 0.96, reason: "Kategoria z pliku" };

  const supplier = cell(row, "supplier_name");
  const number = cell(row, "invoice_number");
  const notes = cell(row, "notes");
  const all = `${supplier} ${number} ${notes}`;
  const activeRules = rules.filter((rule) => rule.active).sort((a, b) => a.priority - b.priority);
  for (const rule of activeRules) {
    const haystack = rule.match_field === "supplier" ? supplier : rule.match_field === "number" ? number : rule.match_field === "notes" ? notes : all;
    if (normalizeText(haystack).includes(normalizeText(rule.pattern))) {
      return { category: rule.category, confidence: 0.92, reason: `Reguła: ${rule.pattern}` };
    }
  }

  const normalizedAll = normalizeText(all);
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [SupplierInvoiceCategory, string[]][]) {
    const keyword = keywords.find((word) => normalizedAll.includes(normalizeText(word)));
    if (keyword) return { category, confidence: 0.72, reason: `Słowo kluczowe: ${keyword}` };
  }
  return { category: "materialy" as SupplierInvoiceCategory, confidence: 0.45, reason: "Domyślna kategoria do weryfikacji" };
}

function matchCase(row: RawInvoiceImportRow, cases: CaseRow[]) {
  const caseText = normalizeText(cell(row, "case_text"));
  if (!caseText) return null;
  return (
    cases.find((c) => normalizeText(`${c.client_name} ${c.location || ""}`).includes(caseText)) ||
    cases.find((c) => caseText.includes(normalizeText(c.client_name))) ||
    null
  );
}

function duplicateReason(row: SupplierInvoiceImportPreviewRow, existing: SupplierInvoice[], seen: Set<string>): string | null {
  const key = `${normalizeText(row.supplier_name)}:${normalizeText(row.invoice_number || "")}:${row.gross_total}`;
  if (seen.has(key)) return "Duplikat w tym imporcie";
  seen.add(key);
  if (!row.invoice_number) return null;
  const exists = existing.some(
    (invoice) =>
      normalizeText(invoice.supplier_name) === normalizeText(row.supplier_name) &&
      normalizeText(invoice.invoice_number || "") === normalizeText(row.invoice_number) &&
      Math.abs(Number(invoice.gross_total || 0) - row.gross_total) < 0.01
  );
  return exists ? "Taka faktura jest już w systemie" : null;
}

export function buildSupplierInvoiceImportPreview(params: {
  rows: RawInvoiceImportRow[];
  cases: CaseRow[];
  existingInvoices: SupplierInvoice[];
  rules: SupplierInvoiceCategoryRule[];
}): SupplierInvoiceImportPreviewRow[] {
  const seen = new Set<string>();
  return params.rows
    .filter((row) => Object.values(row).some((value) => String(value ?? "").trim()))
    .map((row, index) => {
      const gross = parseImportAmount(cell(row, "gross_total"));
      const paid = parseImportAmount(cell(row, "paid_amount"));
      const matchedCase = matchCase(row, params.cases);
      const category = suggestCategory(row, params.rules);
      const preview: SupplierInvoiceImportPreviewRow = {
        rowId: `row-${index + 1}`,
        supplier_name: cell(row, "supplier_name") || "Dostawca",
        invoice_number: cell(row, "invoice_number") || null,
        invoice_date: parseDate(cell(row, "invoice_date")),
        due_date: cell(row, "due_date") ? parseDate(cell(row, "due_date")) : null,
        case_id: matchedCase?.id ?? null,
        case_label: matchedCase ? `${matchedCase.client_name}${matchedCase.location ? ` - ${matchedCase.location}` : ""}` : null,
        category: category.category,
        category_confidence: category.confidence,
        category_reason: category.reason,
        net_total: cell(row, "net_total") ? parseImportAmount(cell(row, "net_total")) : null,
        gross_total: gross,
        paid_amount: paid,
        status: statusFromAmounts(gross, paid),
        notes: cell(row, "notes") || null,
        duplicate: false,
        duplicate_reason: null,
        raw: row
      };
      const duplicate = duplicateReason(preview, params.existingInvoices, seen);
      preview.duplicate = Boolean(duplicate);
      preview.duplicate_reason = duplicate;
      return preview;
    });
}

export function parseDelimitedInvoiceRows(text: string): RawInvoiceImportRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const separator = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(separator).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(separator).map((v) => v.trim());
    return headers.reduce<RawInvoiceImportRow>((acc, header, index) => {
      acc[header || `kolumna_${index + 1}`] = values[index] ?? "";
      return acc;
    }, {});
  });
}
