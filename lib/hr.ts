import type { EmployeeDocument, EmployeeDocumentType } from "@/lib/types";

export const EMPLOYEE_DOCUMENT_TYPE_LABELS: Record<EmployeeDocumentType, string> = {
  bhp: "Szkolenie BHP",
  medical: "Badania lekarskie",
  training: "Szkolenie",
  qualification: "Uprawnienie",
  contract: "Umowa",
  annex: "Aneks",
  certificate: "Zaświadczenie",
  other: "Inny dokument"
};

export const RENEWABLE_DOCUMENT_TYPES: EmployeeDocumentType[] = ["bhp", "medical", "training", "qualification", "certificate"];

export function daysUntilDate(value: string | null | undefined, todayIso: string): number | null {
  if (!value) return null;
  const target = new Date(`${value}T12:00:00`).getTime();
  const today = new Date(`${todayIso}T12:00:00`).getTime();
  return Math.round((target - today) / 86_400_000);
}

export function documentExpiryLabel(document: Pick<EmployeeDocument, "valid_until" | "requires_renewal">, todayIso: string): string {
  if (!document.valid_until) return document.requires_renewal ? "brak terminu" : "bezterminowo";
  const days = daysUntilDate(document.valid_until, todayIso);
  if (days == null) return "bezterminowo";
  if (days < 0) return `${Math.abs(days)} dni po terminie`;
  if (days === 0) return "wygasa dzisiaj";
  return `ważny jeszcze ${days} dni`;
}

export function documentExpiryTone(document: Pick<EmployeeDocument, "valid_until" | "requires_renewal">, todayIso: string): string {
  if (!document.valid_until) return document.requires_renewal ? "bg-rose-50 text-rose-700" : "bg-stone-100 text-steel";
  const days = daysUntilDate(document.valid_until, todayIso);
  if (days != null && days < 0) return "bg-rose-50 text-rose-700";
  if (days != null && days <= 30) return "bg-amber-50 text-amber-800";
  return "bg-emerald-50 text-emerald-700";
}

export function safeStorageFilename(name: string): string {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 100) || "dokument";
}
