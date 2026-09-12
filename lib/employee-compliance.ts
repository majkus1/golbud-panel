import { daysUntilDate } from "@/lib/hr";

/**
 * Jedna ocena BHP i badań lekarskich dla całej aplikacji.
 *
 * Do tej pory Kadry liczyły braki po dokumentach pracownika, a Struktura firmy po datach
 * wpisanych w profilu. Te same osoby dawały różne liczby („6 braków” w jednym miejscu,
 * „0 do uwagi” w drugim), bo każda strona patrzyła na inne pole. Teraz obie biorą pod
 * uwagę oba źródła i oceniają je tą samą regułą.
 *
 * Trzy stany, bo klient słusznie zauważył, że „brak wpisu w programie” to nie to samo
 * co „brak ważnego dokumentu” — i nie wolno tych dwóch rzeczy wrzucać do jednej liczby.
 */

export type ComplianceState = "ok" | "expiring" | "expired" | "missing";

export type ComplianceEmployee = {
  id: string;
  active: boolean;
  bhp_valid_until: string | null;
  medical_valid_until: string | null;
};

export type ComplianceDocument = {
  employee_id: string;
  document_type: string;
  status: string;
  valid_until: string | null;
};

export const EXPIRING_WINDOW_DAYS = 30;

/** Najpóźniejsza data ważności z profilu i aktywnych dokumentów danego typu. */
function latestValidUntil(profileDate: string | null, documents: ComplianceDocument[], type: string): string | null {
  const candidates = documents
    .filter((d) => d.document_type === type && d.status === "active" && d.valid_until)
    .map((d) => d.valid_until as string);
  if (profileDate) candidates.push(profileDate);
  if (candidates.length === 0) return null;
  return candidates.sort().at(-1) ?? null;
}

export function complianceStateFromDate(validUntil: string | null, todayIso: string): ComplianceState {
  const days = daysUntilDate(validUntil, todayIso);
  if (days == null) return "missing";
  if (days < 0) return "expired";
  if (days <= EXPIRING_WINDOW_DAYS) return "expiring";
  return "ok";
}

export type EmployeeCompliance = {
  bhp: ComplianceState;
  medical: ComplianceState;
  bhpValidUntil: string | null;
  medicalValidUntil: string | null;
};

export function employeeCompliance(
  employee: ComplianceEmployee,
  documents: ComplianceDocument[],
  todayIso: string
): EmployeeCompliance {
  const own = documents.filter((d) => d.employee_id === employee.id);
  const bhpValidUntil = latestValidUntil(employee.bhp_valid_until, own, "bhp");
  const medicalValidUntil = latestValidUntil(employee.medical_valid_until, own, "medical");
  return {
    bhp: complianceStateFromDate(bhpValidUntil, todayIso),
    medical: complianceStateFromDate(medicalValidUntil, todayIso),
    bhpValidUntil,
    medicalValidUntil
  };
}

export type ComplianceSummary = {
  /** Osoby, u których BHP lub badania kończą się w ciągu 30 dni. */
  expiring: number;
  /** Osoby z przeterminowanym BHP lub badaniami. */
  expired: number;
  /** Osoby bez żadnego wpisu o BHP lub badaniach — brak danych, nie brak dokumentu. */
  missing: number;
  bhp: Record<ComplianceState, number>;
  medical: Record<ComplianceState, number>;
};

const emptyCounts = (): Record<ComplianceState, number> => ({ ok: 0, expiring: 0, expired: 0, missing: 0 });

/** Liczy tylko aktywnych pracowników — archiwalni nie wymagają aktualnych badań. */
export function summarizeCompliance(
  employees: ComplianceEmployee[],
  documents: ComplianceDocument[],
  todayIso: string
): ComplianceSummary {
  const summary: ComplianceSummary = { expiring: 0, expired: 0, missing: 0, bhp: emptyCounts(), medical: emptyCounts() };
  for (const employee of employees) {
    if (!employee.active) continue;
    const c = employeeCompliance(employee, documents, todayIso);
    summary.bhp[c.bhp] += 1;
    summary.medical[c.medical] += 1;
    const states = [c.bhp, c.medical];
    // Osoba liczy się raz, według najgorszego stanu — inaczej ktoś z przeterminowanym BHP
    // i wygasającymi badaniami pojawiłby się w dwóch kafelkach naraz.
    if (states.includes("expired")) summary.expired += 1;
    else if (states.includes("expiring")) summary.expiring += 1;
    else if (states.includes("missing")) summary.missing += 1;
  }
  return summary;
}

export const COMPLIANCE_LABELS: Record<ComplianceState, string> = {
  ok: "aktualne",
  expiring: "wygasa w ciągu 30 dni",
  expired: "po terminie",
  missing: "brak danych"
};
