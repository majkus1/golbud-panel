import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/employee-settlements";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { EmployeeMonthlySettlement, EmployeeProfile } from "@/lib/types";

export const runtime = "nodejs";

async function resolveOrganizationId(supabase: SupabaseClient, userId: string, requested: string | null): Promise<string> {
  const orgId = requested?.trim() || "";
  if (!orgId) return "";
  const { data } = await supabase.from("organization_members").select("organization_id, role").eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
  return data && ["owner", "manager"].includes(String(data.role)) ? orgId : "";
}

function money(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export async function GET(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  const { data: userData } = await auth.supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "";
  if (!/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: "Nieprawidłowy miesiąc" }, { status: 400 });
  const organizationId = await resolveOrganizationId(auth.supabase, user.id, url.searchParams.get("organizationId"));
  if (!organizationId) return NextResponse.json({ error: "Brak dostępu do rozliczeń" }, { status: 403 });

  const [{ data: cards, error: cardsError }, { data: employees }, { data: organization }] = await Promise.all([
    auth.supabase.from("employee_monthly_settlements").select("*").eq("organization_id", organizationId).eq("period_month", `${period}-01`).order("amount_due", { ascending: false }),
    auth.supabase.from("employee_profiles").select("*").eq("organization_id", organizationId),
    auth.supabase.from("organizations").select("name, offer_nip").eq("id", organizationId).maybeSingle()
  ]);
  if (cardsError) return NextResponse.json({ error: cardsError.message }, { status: 500 });

  const employeeById = new Map(((employees || []) as EmployeeProfile[]).map((employee) => [employee.id, employee]));
  const rows = (cards || []) as EmployeeMonthlySettlement[];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GolBud Panel";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Rozliczenia", { views: [{ state: "frozen", ySplit: 5 }] });

  sheet.mergeCells("A1:S1");
  sheet.getCell("A1").value = `ROZLICZENIA PRACOWNIKÓW · ${period}`;
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17231D" } };
  sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 28;
  sheet.mergeCells("A2:S2");
  sheet.getCell("A2").value = `${organization?.name || "Firma"}${organization?.offer_nip ? ` · NIP ${organization.offer_nip}` : ""}`;
  sheet.getCell("A2").font = { color: { argb: "FF647068" } };
  sheet.mergeCells("A3:S3");
  sheet.getCell("A3").value = `Wygenerowano: ${new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short" }).format(new Date())}`;
  sheet.getCell("A3").font = { italic: true, color: { argb: "FF647068" } };

  const headers = [
    "Pracownik", "Stanowisko", "Model", "Status", "Godziny", "Dni", "Ilość akordowa", "Stawka godz.", "Dniówka", "Pensja mies.",
    "Podstawa", "Premie", "Zwroty", "Korekty +", "Potrącenia i korekty -", "Zaliczki", "Wypłaty częściowe", "Do wypłaty", "Data wypłaty"
  ];
  sheet.addRow([]);
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF557252" } };
  headerRow.alignment = { vertical: "middle", wrapText: true };
  headerRow.height = 32;

  for (const card of rows) {
    const employee = employeeById.get(card.employee_id);
    sheet.addRow([
      employee?.full_name || "Nieznany pracownik", employee?.role_title || "", EMPLOYMENT_TYPE_LABELS[card.employment_type_snapshot] || card.employment_type_snapshot, card.status,
      Number(card.hours_total), Number(card.work_days_total), Number(card.piecework_quantity_total), money(card.hourly_rate_snapshot), money(card.day_rate_snapshot),
      money(card.monthly_salary_snapshot), money(card.base_amount), money(card.bonuses_total), money(card.reimbursements_total),
      money(card.corrections_plus_total), money(card.deductions_total) + money(card.corrections_minus_total),
      money(card.advances_total), money(card.previous_payments_total), money(card.amount_due), card.paid_at ? new Date(card.paid_at) : ""
    ]);
  }

  const firstDataRow = 6;
  const lastDataRow = Math.max(firstDataRow, sheet.rowCount);
  const formula = (column: string) => rows.length > 0 ? { formula: `SUM(${column}${firstDataRow}:${column}${lastDataRow})` } : 0;
  const totalRow = sheet.addRow([
    "RAZEM", "", "", "", "", "", "", "", "", "",
    formula("K"), formula("L"), formula("M"), formula("N"), formula("O"), formula("P"), formula("Q"), formula("R"), ""
  ]);
  totalRow.font = { bold: true };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7EEE6" } };

  sheet.columns = [
    { width: 26 }, { width: 20 }, { width: 16 }, { width: 14 }, { width: 11 }, { width: 9 }, { width: 14 }, { width: 14 }, { width: 13 },
    { width: 15 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 19 }, { width: 12 }, { width: 18 }, { width: 15 }, { width: 17 }
  ];
  for (let column = 8; column <= 18; column++) sheet.getColumn(column).numFmt = '#,##0.00 "zł"';
  sheet.getColumn(5).numFmt = "0.00";
  sheet.getColumn(7).numFmt = "0.00";
  sheet.getColumn(19).numFmt = "dd.mm.yyyy";
  sheet.autoFilter = { from: "A5", to: "S5" };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber >= 5) {
      row.alignment = { vertical: "middle", wrapText: rowNumber === 5 };
      row.eachCell((cell) => { cell.border = { bottom: { style: "hair", color: { argb: "FFD9DDD9" } } }; });
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rozliczenia-pracownikow-${period}.xlsx"`,
      "Cache-Control": "private, no-store"
    }
  });
}
