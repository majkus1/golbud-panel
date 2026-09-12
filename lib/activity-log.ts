import type { MemberRole } from "@/lib/types";

/** Kategorie wpisów w organization_activity_log — zgodne z CHECK w migracji 0029. */
export type ActivityCategory =
  | "sprawa"
  | "platnosc"
  | "faktura"
  | "magazyn"
  | "sprzet"
  | "czas"
  | "zespol"
  | "firma"
  | "przypisanie"
  | "prace_dodatkowe"
  | "zadanie"
  | "rozliczenia"
  | "rentownosc"
  | "hr"
  | "ai";

export type OrganizationActivityLog = {
  id: string;
  organization_id: string;
  case_id: string | null;
  category: ActivityCategory;
  entity_type: string;
  entity_id: string | null;
  action: string;
  summary: string;
  details: string | null;
  meta: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

export const ACTIVITY_FILTER_OPTIONS: { value: "all" | ActivityCategory; label: string }[] = [
  { value: "all", label: "Wszystko" },
  { value: "sprawa", label: "Sprawy i statusy" },
  { value: "platnosc", label: "Płatności i wpłaty" },
  { value: "faktura", label: "Faktury" },
  { value: "magazyn", label: "Magazyn" },
  { value: "sprzet", label: "Sprzęt / rusztowania" },
  { value: "czas", label: "Czas pracy" },
  { value: "przypisanie", label: "Przypisania osób" },
  { value: "prace_dodatkowe", label: "Prace dodatkowe" },
  { value: "zadanie", label: "Zadania" },
  { value: "rozliczenia", label: "Rozliczenia pracowników" },
  { value: "rentownosc", label: "Rentowność i koszty" },
  { value: "hr", label: "HR i dokumenty" },
  { value: "ai", label: "Asystent AI" },
  { value: "zespol", label: "Zespół i role" },
  { value: "firma", label: "Dane firmy" }
];

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  sprawa: "Sprawa",
  platnosc: "Płatność",
  faktura: "Faktura",
  magazyn: "Magazyn",
  sprzet: "Sprzęt",
  czas: "Czas pracy",
  zespol: "Zespół",
  firma: "Firma",
  przypisanie: "Przypisanie",
  prace_dodatkowe: "Prace dod.",
  zadanie: "Zadanie",
  rozliczenia: "Rozliczenie",
  rentownosc: "Rentowność",
  hr: "HR",
  ai: "AI"
};

export const ACTIVITY_CATEGORY_TONE: Record<ActivityCategory, string> = {
  sprawa: "bg-sky-50 text-sky-800 ring-sky-200",
  platnosc: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  faktura: "bg-violet-50 text-violet-800 ring-violet-200",
  magazyn: "bg-amber-50 text-amber-900 ring-amber-200",
  sprzet: "bg-stone-100 text-stone-700 ring-stone-200",
  czas: "bg-blue-50 text-blue-800 ring-blue-200",
  zespol: "bg-rose-50 text-rose-800 ring-rose-200",
  firma: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  przypisanie: "bg-teal-50 text-teal-800 ring-teal-200",
  prace_dodatkowe: "bg-orange-50 text-orange-900 ring-orange-200",
  zadanie: "bg-moss/10 text-moss-dark ring-moss/30",
  rozliczenia: "bg-cyan-50 text-cyan-800 ring-cyan-200",
  rentownosc: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  hr: "bg-rose-50 text-rose-800 ring-rose-200",
  ai: "bg-indigo-50 text-indigo-800 ring-indigo-200"
};

export function activityCategoryLabel(category: ActivityCategory): string {
  return ACTIVITY_CATEGORY_LABELS[category] ?? category;
}

/** Widok dziennika — role zarządcze (jak finanse). */
export function canViewActivityLog(role: MemberRole | null): boolean {
  return role === "owner" || role === "office" || role === "manager";
}
