import type { TaskPriority } from "@/lib/domain";

/**
 * Wspólne, czyste funkcje kalendarza firmy — używa ich widżet na Pulpicie i strona /calendar.
 */

export const WEEKDAYS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];
export const MONTHS = [
  "Styczeń",
  "Luty",
  "Marzec",
  "Kwiecień",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpień",
  "Wrzesień",
  "Październik",
  "Listopad",
  "Grudzień"
];

export type MonthCursor = { year: number; month: number };

export function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 42 dni siatki: od poniedziałku tygodnia z 1. dniem miesiąca. */
export function buildGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // poniedziałek = 0
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const d = new Date(cursor.year, cursor.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/**
 * Kolor wpisu lub zadania w kalendarzu — tak, jak prosił klient:
 * pilne = czerwony, ważne (wysoki) = żółty, zwykłe (normalny, niski) = zielony.
 */
export type PriorityTone = "red" | "yellow" | "green";

export function priorityTone(priority: TaskPriority): PriorityTone {
  if (priority === "pilne") return "red";
  if (priority === "wysoki") return "yellow";
  return "green";
}

export const PRIORITY_TONE_CLASSES: Record<PriorityTone, { dot: string; chip: string; card: string }> = {
  red: { dot: "bg-red-500", chip: "bg-red-50 text-red-800", card: "border-red-200 bg-red-50/50 hover:border-red-300" },
  yellow: { dot: "bg-amber-400", chip: "bg-amber-50 text-amber-900", card: "border-amber-200 bg-amber-50/50 hover:border-amber-300" },
  green: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-800", card: "border-emerald-200 bg-emerald-50/40 hover:border-emerald-300" }
};

/** Trzy poziomy do wyboru przy wpisie; „niski” zostaje tylko dla starszych zadań. */
export const ENTRY_PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "pilne", label: "Pilne (czerwony)" },
  { value: "wysoki", label: "Ważne (żółty)" },
  { value: "normalny", label: "Zwykłe (zielony)" }
];

export function priorityLabel(priority: TaskPriority): string {
  if (priority === "pilne") return "pilne";
  if (priority === "wysoki") return "ważne";
  return "zwykłe";
}

/** „08:30:00” z bazy → „08:30”; puste lub dziwne → null. */
export function formatTime(value: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((value || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { pilne: 0, wysoki: 1, normalny: 2, niski: 3 };

/** Kolejność w dniu: najpierw z godziną (rosnąco), potem bez godziny; w obrębie — pilniejsze wyżej. */
export function compareDayEntries(
  a: { due_time?: string | null; priority: TaskPriority; title: string },
  b: { due_time?: string | null; priority: TaskPriority; title: string }
): number {
  const ta = formatTime(a.due_time);
  const tb = formatTime(b.due_time);
  if (ta && tb && ta !== tb) return ta.localeCompare(tb);
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (p !== 0) return p;
  return a.title.localeCompare(b.title, "pl");
}
