/**
 * Minimalny eksport do CSV (BOM + ; — Excel PL otwiera bez „krzaków”).
 */

function escape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (s.includes('"')) s = s.replace(/"/g, '""');
  if (/[";\r\n]/.test(s)) s = `"${s}"`;
  return s;
}

export function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escape).join(";"), ...rows.map((r) => r.map(escape).join(";"))];
  return "\uFEFF" + lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
