/**
 * Rodzaje pozycji kosztorysu. Do tej pory były dwa — robocizna albo materiał — a GolBud
 * wycenia wiele prac jedną stawką „z materiałem” (np. docieplenie 1 m² z klejem i siatką).
 * Takie pozycje trzeba było sztucznie rozbijać albo wpisywać jako „materiał”, przez co
 * podział w podsumowaniu kłamał.
 *
 * Suma oferty liczy się zawsze ze WSZYSTKICH pozycji — grupy służą tylko do podziału,
 * żeby nowy rodzaj nie mógł „zniknąć” z kwoty w żadnym miejscu.
 */

export const OFFER_SECTIONS = ["labor", "material", "mixed"] as const;
export type OfferSection = (typeof OFFER_SECTIONS)[number];

export const OFFER_SECTION_LABELS: Record<OfferSection, string> = {
  labor: "Robocizna",
  material: "Materiał",
  mixed: "Materiał i robocizna"
};

/** Krótka etykieta do list rozwijanych i plakietek. */
export const OFFER_SECTION_SHORT: Record<OfferSection, string> = {
  labor: "robocizna",
  material: "materiał",
  mixed: "materiał + robocizna"
};

/** Kolory: plakietka, obramowanie karty, pasek z lewej. */
export const OFFER_SECTION_TONES: Record<OfferSection, { chip: string; card: string; bar: string; tile: string; tileLabel: string }> = {
  labor: {
    chip: "bg-sky-100 text-sky-700 ring-sky-200",
    card: "border-sky-200 bg-sky-50/30",
    bar: "bg-sky-400",
    tile: "border-sky-200/70 bg-sky-50/50",
    tileLabel: "text-sky-700"
  },
  material: {
    chip: "bg-amber-100 text-amber-800 ring-amber-200",
    card: "border-amber-200 bg-amber-50/30",
    bar: "bg-amber-400",
    tile: "border-amber-200/70 bg-amber-50/50",
    tileLabel: "text-amber-700"
  },
  mixed: {
    chip: "bg-violet-100 text-violet-800 ring-violet-200",
    card: "border-violet-200 bg-violet-50/30",
    bar: "bg-violet-400",
    tile: "border-violet-200/70 bg-violet-50/50",
    tileLabel: "text-violet-700"
  }
};

export function isOfferSection(value: unknown): value is OfferSection {
  return typeof value === "string" && (OFFER_SECTIONS as readonly string[]).includes(value);
}

type SummableLine = { section: string; line_total: number | string | null };

/**
 * Sumy pozycji: łącznie i w podziale na rodzaje. Pozycja z nieznanym rodzajem
 * (np. dane sprzed migracji) wchodzi do sumy i trafia do „materiału”, żeby kwota się zgadzała.
 */
export function summarizeOfferLines(lines: SummableLine[]): { total: number; bySection: Record<OfferSection, number> } {
  const bySection: Record<OfferSection, number> = { labor: 0, material: 0, mixed: 0 };
  let total = 0;
  for (const line of lines) {
    const value = Number(line.line_total) || 0;
    total += value;
    bySection[isOfferSection(line.section) ? line.section : "material"] += value;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    total: round(total),
    bySection: { labor: round(bySection.labor), material: round(bySection.material), mixed: round(bySection.mixed) }
  };
}

/** Pozycje pogrupowane w stałej kolejności rodzajów; puste grupy pominięte. */
export function groupOfferLines<T extends { section: string }>(lines: T[]): { section: OfferSection; lines: T[] }[] {
  return OFFER_SECTIONS.map((section) => ({
    section,
    lines: lines.filter((l) => (isOfferSection(l.section) ? l.section : "material") === section)
  })).filter((g) => g.lines.length > 0);
}
