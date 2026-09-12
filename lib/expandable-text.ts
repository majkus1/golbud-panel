/**
 * Logika zwijania długich opisów, wydzielona z komponentu, żeby dała się przetestować
 * bez przeglądarki. Komponent zostaje wtedy samym renderowaniem.
 */

export type ClampLines = 2 | 3 | 4;

const CLAMP_CLASS: Record<ClampLines, string> = {
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4"
};

/** Klasa przycięcia — w stanie rozwiniętym żadna, bo tekst ma być cały. */
export function clampClass(lines: ClampLines, expanded: boolean): string {
  return expanded ? "" : CLAMP_CLASS[lines];
}

/**
 * Czy tekst wystaje poza przycięty obszar.
 *
 * Tolerancja 1 px jest konieczna: wysokość wiersza rzadko wypada na całych pikselach,
 * więc `scrollHeight` bywa o pół piksela większy od `clientHeight` przy tekście, który
 * mieści się w całości. Bez tolerancji przy krótkich opisach migotałby przycisk „Rozwiń".
 */
export function isTextOverflowing(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight > 1;
}

/** Puste i złożone z samych spacji opisy traktujemy jednakowo — jako brak treści. */
export function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}
