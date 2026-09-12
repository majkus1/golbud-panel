import type {
  EmployeeEmploymentType,
  EmployeeMonthlySettlement,
  EmployeeMonthlySettlementStatus,
  EmployeePieceworkEntry,
  EmployeePayrollProfile,
  EmployeeSettlementEntry,
  WorkHour
} from "@/lib/types";

export const SETTLEMENT_STATUS_LABELS: Record<EmployeeMonthlySettlementStatus, string> = {
  draft: "Robocza",
  approved: "Zatwierdzona",
  paid: "Wypłacona",
  closed: "Zamknięta"
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmployeeEmploymentType, string> = {
  godzinowka: "Stawka godzinowa",
  dniowka: "Dniówka",
  etat: "Pensja miesięczna",
  ryczalt: "Ryczałt",
  b2b: "B2B",
  podwykonawca: "Podwykonawca",
  akord: "Akord",
  inne: "Inny model"
};

export type EmployeeSettlementCalculation = Pick<
  EmployeeMonthlySettlement,
  | "hours_total"
  | "work_days_total"
  | "piecework_total"
  | "piecework_quantity_total"
  | "base_amount"
  | "bonuses_total"
  | "reimbursements_total"
  | "corrections_plus_total"
  | "deductions_total"
  | "corrections_minus_total"
  | "advances_total"
  | "previous_payments_total"
  | "gross_earnings"
  | "amount_due"
>;

function n(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pl-PL");
}

export function monthBounds(period: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})/.exec(period);
  if (!match) throw new Error("Nieprawidłowy miesiąc");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { start, end: next };
}

export function monthLabel(period: string): string {
  const [year, month] = period.slice(0, 7).split("-").map(Number);
  return new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

export function calculateEmployeeSettlement(
  employee: EmployeePayrollProfile,
  workHours: WorkHour[],
  entries: EmployeeSettlementEntry[],
  pieceworkEntries: EmployeePieceworkEntry[] = []
): EmployeeSettlementCalculation {
  const employeeHours = workHours.filter(
    (row) => row.employee_id === employee.id || (!row.employee_id && normalizeName(row.worker_name) === normalizeName(employee.full_name))
  );
  const hours = employeeHours.reduce((sum, row) => sum + n(row.hours), 0);
  const workDays = new Set(employeeHours.filter((row) => n(row.hours) > 0).map((row) => row.work_date)).size;

  const ownPiecework = pieceworkEntries.filter((entry) => entry.employee_id === employee.id);
  const pieceworkAmount = ownPiecework.reduce((sum, entry) => sum + n(entry.quantity) * n(entry.unit_rate_snapshot), 0);
  const pieceworkQuantity = ownPiecework.reduce((sum, entry) => sum + n(entry.quantity), 0);

  let base = 0;
  if (employee.employment_type === "godzinowka") base = hours * n(employee.hourly_rate);
  else if (employee.employment_type === "dniowka") base = workDays * n(employee.day_rate);
  else if (employee.employment_type === "akord") base = pieceworkAmount;
  else if (n(employee.monthly_salary) > 0) base = n(employee.monthly_salary);
  else base = hours * n(employee.hourly_rate);

  const ownEntries = entries.filter((entry) => entry.employee_id === employee.id);
  const sumType = (type: EmployeeSettlementEntry["entry_type"], direction?: "plus" | "minus") =>
    ownEntries
      .filter((entry) => entry.entry_type === type && (!direction || (entry.direction ?? "plus") === direction))
      .reduce((sum, entry) => sum + n(entry.amount), 0);

  const bonuses = sumType("premia");
  const reimbursements = sumType("zwrot_kosztow");
  const correctionsPlus = sumType("korekta", "plus");
  const deductions = sumType("potracenie");
  const correctionsMinus = sumType("korekta", "minus");
  const advances = sumType("zaliczka");
  const previousPayments = sumType("wyplata");
  const gross = base + bonuses + reimbursements + correctionsPlus;
  const due = Math.max(0, gross - deductions - correctionsMinus - advances - previousPayments);

  return {
    hours_total: Math.round(hours * 100) / 100,
    work_days_total: workDays,
    piecework_total: roundMoney(pieceworkAmount),
    piecework_quantity_total: Math.round(pieceworkQuantity * 100) / 100,
    base_amount: roundMoney(base),
    bonuses_total: roundMoney(bonuses),
    reimbursements_total: roundMoney(reimbursements),
    corrections_plus_total: roundMoney(correctionsPlus),
    deductions_total: roundMoney(deductions),
    corrections_minus_total: roundMoney(correctionsMinus),
    advances_total: roundMoney(advances),
    previous_payments_total: roundMoney(previousPayments),
    gross_earnings: roundMoney(gross),
    amount_due: roundMoney(due)
  };
}

export function settlementStatusTone(status: EmployeeMonthlySettlementStatus): string {
  if (status === "draft") return "bg-amber-50 text-amber-800";
  if (status === "approved") return "bg-sky-50 text-sky-800";
  if (status === "paid") return "bg-emerald-50 text-emerald-800";
  return "bg-stone-100 text-stone-700";
}
