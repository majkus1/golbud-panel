/**
 * Eksport do ostylowanych plików Excel (.xlsx) z użyciem exceljs.
 *
 * Zapewnia: nagłówki w kolorach firmy, automatyczne dopasowanie szerokości
 * kolumn do treści, formatowanie kwot/liczb, naprzemienne tło wierszy,
 * obramowania, zamrożony nagłówek, autofiltr oraz wiersz podsumowania.
 */

export type XlsxColumnType = "text" | "number" | "currency" | "date";

export interface XlsxColumn {
  header: string;
  type?: XlsxColumnType;
  /** Stała szerokość (w jednostkach Excela). Domyślnie liczona automatycznie. */
  width?: number;
  /** Czy w wierszu podsumowania ma być suma tej kolumny. */
  total?: boolean;
}

export interface XlsxSheet {
  name: string;
  title?: string;
  subtitle?: string;
  columns: XlsxColumn[];
  rows: (string | number | null | undefined)[][];
  /** Etykieta wiersza podsumowania (jeśli którakolwiek kolumna ma total). */
  totalsLabel?: string;
}

// Kolory marki (ARGB) — spójne z tailwind.config.ts
const COLOR = {
  headerFill: "FF3F5239", // moss-dark
  headerFont: "FFFFFFFF",
  title: "FF17201B", // ink
  subtitle: "FF5D6B66", // steel
  zebra: "FFF5F4F0", // jaśniejszy concrete
  border: "FFE2E0DA", // stone-200
  totalsFill: "FFE7EDE3", // jasny moss
  totalsFont: "FF17201B"
} as const;

const CURRENCY_FMT = '#,##0.00 "zł"';
const NUMBER_FMT = "#,##0";

function alignFor(type: XlsxColumnType | undefined): "left" | "right" {
  return type === "number" || type === "currency" ? "right" : "left";
}

function numberFormatFor(type: XlsxColumnType | undefined): string | undefined {
  if (type === "currency") return CURRENCY_FMT;
  if (type === "number") return NUMBER_FMT;
  return undefined;
}

function estimateWidth(col: XlsxColumn, rows: (string | number | null | undefined)[][], index: number): number {
  if (col.width) return col.width;
  let max = col.header.length;
  for (const row of rows) {
    const v = row[index];
    if (v === null || v === undefined) continue;
    let len: number;
    if (col.type === "currency" && typeof v === "number") {
      len = `${v.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`.length;
    } else if (col.type === "number" && typeof v === "number") {
      len = v.toLocaleString("pl-PL").length;
    } else {
      len = String(v).length;
    }
    if (len > max) max = len;
  }
  const width = Math.ceil(max * 1.15) + 2;
  return Math.min(Math.max(width, 10), 60);
}

export async function downloadXlsx(filename: string, sheets: XlsxSheet[]): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "GolBud Panel";
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name, {
      views: [{ showGridLines: false }],
      pageSetup: { fitToPage: true, fitToWidth: 1, orientation: "landscape" }
    });

    const colCount = sheet.columns.length;
    const lastColLetter = ws.getColumn(colCount).letter;
    let cursor = 1;

    if (sheet.title) {
      ws.mergeCells(`A${cursor}:${lastColLetter}${cursor}`);
      const cell = ws.getCell(`A${cursor}`);
      cell.value = sheet.title;
      cell.font = { name: "Calibri", size: 16, bold: true, color: { argb: COLOR.title } };
      cell.alignment = { vertical: "middle" };
      ws.getRow(cursor).height = 24;
      cursor += 1;
    }

    if (sheet.subtitle) {
      ws.mergeCells(`A${cursor}:${lastColLetter}${cursor}`);
      const cell = ws.getCell(`A${cursor}`);
      cell.value = sheet.subtitle;
      cell.font = { name: "Calibri", size: 10, italic: true, color: { argb: COLOR.subtitle } };
      cursor += 1;
    }

    if (sheet.title || sheet.subtitle) {
      cursor += 1; // pusty wiersz separatora
    }

    const headerRowIdx = cursor;
    const headerRow = ws.getRow(headerRowIdx);
    sheet.columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.header;
      cell.font = { name: "Calibri", bold: true, color: { argb: COLOR.headerFont } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.headerFill } };
      cell.alignment = { vertical: "middle", horizontal: alignFor(col.type), wrapText: false };
      cell.border = {
        top: { style: "thin", color: { argb: COLOR.headerFill } },
        bottom: { style: "thin", color: { argb: COLOR.headerFill } },
        left: { style: "thin", color: { argb: COLOR.border } },
        right: { style: "thin", color: { argb: COLOR.border } }
      };
    });
    headerRow.height = 20;
    cursor += 1;

    const totals = sheet.columns.map(() => 0);
    let hasTotals = false;

    sheet.rows.forEach((row, r) => {
      const excelRow = ws.getRow(cursor);
      const zebra = r % 2 === 1;
      sheet.columns.forEach((col, i) => {
        const cell = excelRow.getCell(i + 1);
        const value = row[i];
        cell.value = value === undefined ? null : value;
        const fmt = numberFormatFor(col.type);
        if (fmt) cell.numFmt = fmt;
        cell.alignment = { vertical: "middle", horizontal: alignFor(col.type) };
        cell.font = { name: "Calibri", color: { argb: COLOR.title } };
        if (zebra) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.zebra } };
        }
        cell.border = {
          bottom: { style: "hair", color: { argb: COLOR.border } },
          left: { style: "hair", color: { argb: COLOR.border } },
          right: { style: "hair", color: { argb: COLOR.border } }
        };
        if (col.total && typeof value === "number") {
          totals[i] += value;
          hasTotals = true;
        }
      });
      cursor += 1;
    });

    if (hasTotals) {
      const totalsRow = ws.getRow(cursor);
      const labelIdx = sheet.columns.findIndex((c) => !c.total);
      sheet.columns.forEach((col, i) => {
        const cell = totalsRow.getCell(i + 1);
        if (col.total) {
          cell.value = totals[i];
          const fmt = numberFormatFor(col.type);
          if (fmt) cell.numFmt = fmt;
          cell.alignment = { vertical: "middle", horizontal: "right" };
        } else if (i === labelIdx) {
          cell.value = sheet.totalsLabel || "RAZEM";
          cell.alignment = { vertical: "middle", horizontal: "left" };
        }
        cell.font = { name: "Calibri", bold: true, color: { argb: COLOR.totalsFont } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.totalsFill } };
        cell.border = {
          top: { style: "thin", color: { argb: COLOR.headerFill } },
          bottom: { style: "thin", color: { argb: COLOR.headerFill } }
        };
      });
      totalsRow.height = 18;
      cursor += 1;
    }

    sheet.columns.forEach((col, i) => {
      ws.getColumn(i + 1).width = estimateWidth(col, sheet.rows, i);
    });

    ws.views = [
      {
        state: "frozen",
        ySplit: headerRowIdx,
        showGridLines: false
      }
    ];
    ws.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to: { row: headerRowIdx, column: colCount }
    };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
