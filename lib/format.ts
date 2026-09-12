export const currency = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0
});

export const formatMoney = (value: number | null) => (value ? currency.format(value) : "Brak kwoty");

/**
 * Kwota wpisana ręcznie na liczbę. Przyjmuje polski zapis z przecinkiem („1 500,50")
 * i spacje jako separator tysięcy — użytkownik nie ma się zastanawiać nad formatem.
 *
 * Pola kwotowe są zwykłymi polami tekstowymi z `inputMode="decimal"`, a nie `type="number"`:
 * natywne pole liczbowe odrzuca przecinek i zwraca pustą wartość, przez co formularza
 * nie dało się zapisać.
 */
export function parseAmount(value: string): number {
  const parsed = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Kwota do pola formularza — pusto zamiast zera, żeby nie blokować wpisywania. */
export function amountToInput(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

export const formatDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("pl-PL").format(new Date(`${value}T00:00:00`)) : "Nie ustawiono";

/** Data i godzina (ISO z bazy / timestamptz). */
export const formatDateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value))
    : "—";

/**
 * Sama data ze znacznika czasu z bazy.
 *
 * `formatDate` przyjmuje wyłącznie datę bez godziny — dokleja do niej „T00:00:00”, więc
 * podanie mu pełnego znacznika daje nieprawidłową datę. Tu potrzebujemy dnia bez godziny
 * (np. przy autorze zlecenia), liczonego w czasie lokalnym, żeby sprawa założona wieczorem
 * nie wyświetlała się z datą poprzedniego dnia.
 */
export const formatDateOfTimestamp = (value: string | null) =>
  value ? new Intl.DateTimeFormat("pl-PL").format(new Date(value)) : "";

export const isDue = (date: string | null) => {
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${date}T00:00:00`) <= today;
};
