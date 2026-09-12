import type { CaseStatus } from "@/lib/domain";
import { isDue } from "@/lib/format";
import type { CaseRow } from "@/lib/types";

/** Presety listy spraw — zgodne z kartami na dashboardzie (`?preset=…`). */
export const CASE_LIST_PRESET = {
  noweZapytania: "nowe-zapytania",
  wOfercie: "w-ofercie",
  realizacja: "realizacja",
  kontaktPoTerminie: "kontakt-po-terminie",
  zalegleZlecenia: "zalegle-zlecenia"
} as const;

export type CaseListPreset = (typeof CASE_LIST_PRESET)[keyof typeof CASE_LIST_PRESET];

export const STATUSES_W_OFERCIE: CaseStatus[] = [
  "do wyceny",
  "wycena wysłana",
  "do decyzji klienta",
  "umowa do podpisu"
];

export const STATUSES_REALIZACJA: CaseStatus[] = ["termin zarezerwowany", "realizacja", "odbiór"];

const TERMINAL_CASE: CaseStatus[] = ["rozliczone", "utracone"];

/** Zlecenie po planowanym terminie zakończenia realizacji (nie rozliczone). */
export function isCaseRealizationOverdue(c: Pick<CaseRow, "status" | "realization_end_date">): boolean {
  if (TERMINAL_CASE.includes(c.status)) return false;
  if (!STATUSES_REALIZACJA.includes(c.status)) return false;
  return isDue(c.realization_end_date);
}

export function isValidCaseListPreset(v: string | null): v is CaseListPreset {
  return v !== null && Object.values(CASE_LIST_PRESET).includes(v as CaseListPreset);
}
