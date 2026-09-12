/** Dzisiejsza data kalendarzowa w strefie Europe/Warsaw (YYYY-MM-DD). */
export function warsawTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
