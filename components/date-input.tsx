"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Pole daty w formacie polskim (dd.mm.rrrr) z własnym kalendarzem.
 *
 * Dlaczego nie natywne `<input type="date">`: przeglądarka bierze układ pól z ustawień
 * systemu, więc na komputerach z lokalizacją inną niż PL pokazywało `mm/dd/yyyy`.
 * Wpisanie polskiej daty dawało wtedy zły miesiąc albo „gubiło" rok. Dodatkowo Safari
 * na telefonie po dotknięciu pola od razu wstawiał dzisiejszą datę i zatwierdzał ją,
 * a przycisk „Clear" nie czyścił wartości.
 *
 * API jest zgodne z poprzednią wersją: `value` to ISO (`rrrr-mm-dd`), a `onChange`
 * dostaje obiekt z `target.value`, więc miejsca użycia nie wymagają zmian.
 *
 * Kalendarz renderujemy przez portal do `document.body` z pozycjonowaniem `fixed`.
 * Inaczej byłby przycinany przez karty z `overflow-hidden` (etapy harmonogramu,
 * płatności, prace dodatkowe) i przez tabele z przewijaniem poziomym.
 */

const POPOVER_WIDTH = 280;
/** Wstępne oszacowanie — po wyrenderowaniu pozycja jest korygowana rzeczywistą wysokością. */
const POPOVER_HEIGHT = 362;
const VIEWPORT_MARGIN = 8;

type DateChangeEvent = { target: { value: string } };

type DateInputProps = {
  /** Tryb kontrolowany — wartość ISO `rrrr-mm-dd`. */
  value?: string | null;
  /** Tryb niekontrolowany — wartość początkowa; zapis następuje przez `onBlur`. */
  defaultValue?: string | null;
  onChange?: (event: DateChangeEvent) => void;
  /** W trybie niekontrolowanym wywoływane także po wyborze daty z kalendarza. */
  onBlur?: (event: DateChangeEvent) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  placeholder?: string;
  "aria-label"?: string;
};

const MONTHS = [
  "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"
];

const WEEKDAYS = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** ISO (rrrr-mm-dd) → tekst dd.mm.rrrr. Pusty string dla braku daty. */
function isoToDisplay(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** Sprawdza, czy data faktycznie istnieje (odrzuca np. 31.02). */
function isRealDate(day: number, month: number, year: number): boolean {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(year, month - 1, day);
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
}

/** Tekst dd.mm.rrrr → ISO. Zwraca null, gdy data jest niepełna lub nieprawidłowa. */
function displayToIso(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  if (!isRealDate(day, month, year)) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Wstawia kropki w trakcie pisania: „08082026" → „08.08.2026". */
function formatWhileTyping(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/** Poniedziałek = 0 (polski tydzień). */
function mondayFirstWeekday(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

export function DateInput({
  value,
  defaultValue,
  onChange,
  onBlur,
  className = "",
  disabled = false,
  id,
  name,
  placeholder = "dd.mm.rrrr",
  ...rest
}: DateInputProps) {
  const isControlled = value !== undefined;
  const [innerIso, setInnerIso] = useState(() => defaultValue || "");
  const [text, setText] = useState(() => isoToDisplay(isControlled ? value : defaultValue));
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Zmiana wartości z zewnątrz (reset formularza, wczytanie rekordu) aktualizuje pole,
  // ale nie nadpisuje tego, co użytkownik właśnie wpisuje.
  useEffect(() => {
    if (!isControlled) return;
    setText((current) => (displayToIso(current) === (value || null) ? current : isoToDisplay(value)));
  }, [value, isControlled]);

  const emit = useCallback(
    (iso: string) => {
      if (!isControlled) setInnerIso(iso);
      onChange?.({ target: { value: iso } });
    },
    [onChange, isControlled]
  );

  /** Zatwierdzenie wyboru z kalendarza — w trybie niekontrolowanym to moment zapisu,
   *  bo kliknięcie w kalendarz nie wywołuje natywnego `blur` na polu tekstowym. */
  const commit = useCallback(
    (iso: string) => {
      emit(iso);
      if (!isControlled) onBlur?.({ target: { value: iso } });
    },
    [emit, isControlled, onBlur]
  );

  const selectedIso = (isControlled ? value : innerIso) || "";
  const [viewYear, viewMonth] = useMemo(() => {
    const base = selectedIso && /^\d{4}-\d{2}/.test(selectedIso) ? selectedIso : todayIso();
    return [Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1] as const;
  }, [selectedIso]);

  const [cursor, setCursor] = useState({ year: viewYear, month: viewMonth });

  // Otwarcie kalendarza ustawia widok na miesiąc wybranej daty (albo bieżący).
  useEffect(() => {
    if (open) setCursor({ year: viewYear, month: viewMonth });
  }, [open, viewYear, viewMonth]);

  /** Pozycja kalendarza względem okna: pod polem, a przy braku miejsca — nad nim. */
  const updatePosition = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const height = popoverRef.current?.offsetHeight || POPOVER_HEIGHT;
    const spaceBelow = window.innerHeight - rect.bottom;
    const preferAbove = spaceBelow < height + VIEWPORT_MARGIN && rect.top > height + VIEWPORT_MARGIN;
    const rawTop = preferAbove ? rect.top - height - 4 : rect.bottom + 4;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN;
    setCoords({
      top: Math.max(VIEWPORT_MARGIN, Math.min(rawTop, maxTop)),
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft))
    });
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  // Druga korekta po wyrenderowaniu — dopiero wtedy znamy rzeczywistą wysokość kalendarza.
  useLayoutEffect(() => {
    if (!open || !coords || !popoverRef.current) return;
    const height = popoverRef.current.offsetHeight;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    const corrected = Math.max(VIEWPORT_MARGIN, Math.min(coords.top, maxTop));
    if (corrected !== coords.top) setCoords((current) => (current ? { ...current, top: corrected } : current));
  }, [open, coords]);

  // Zamknięcie po kliknięciu poza polem i po Escape; przeliczenie pozycji przy przewijaniu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  const handleTyping = (raw: string) => {
    const formatted = formatWhileTyping(raw);
    setText(formatted);
    const iso = displayToIso(formatted);
    if (iso) emit(iso);
    else if (formatted === "") emit("");
  };

  // Po wyjściu z pola: niepełny albo nieprawidłowy wpis wraca do ostatniej poprawnej wartości.
  const handleBlur = () => {
    if (text !== "" && !displayToIso(text)) {
      setText(isoToDisplay(selectedIso));
      onBlur?.({ target: { value: selectedIso } });
      return;
    }
    onBlur?.({ target: { value: displayToIso(text) ? (displayToIso(text) as string) : "" } });
  };

  const pick = (day: number) => {
    const iso = `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`;
    setText(isoToDisplay(iso));
    commit(iso);
    setOpen(false);
  };

  const clear = () => {
    setText("");
    commit("");
    setOpen(false);
  };

  const setToday = () => {
    const iso = todayIso();
    setText(isoToDisplay(iso));
    commit(iso);
    setOpen(false);
  };

  const shiftMonth = (delta: number) => {
    setCursor((c) => {
      const next = new Date(c.year, c.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  const shiftYear = (delta: number) => {
    setCursor((c) => ({ ...c, year: c.year + delta }));
  };

  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const leading = mondayFirstWeekday(cursor.year, cursor.month);
  const today = todayIso();

  const navBtn =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-steel transition hover:bg-stone-100 hover:text-ink";

  return (
    <div ref={wrapperRef} className="relative min-w-0">
      <div className="relative">
        <input
          {...rest}
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(e) => handleTyping(e.target.value)}
          onBlur={handleBlur}
          className={`input input-date w-full min-w-0 max-w-full pr-9 ${className}`.trim()}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Zamknij kalendarz" : "Otwórz kalendarz"}
          aria-expanded={open}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-steel transition hover:text-ink disabled:opacity-40"
        >
          <CalendarIcon />
        </button>
      </div>

      {open && !disabled && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Wybór daty"
          style={{ position: "fixed", top: coords.top, left: coords.left, width: POPOVER_WIDTH }}
          className="z-50 rounded-xl2 border border-stone-200 bg-white p-3 shadow-panel"
        >
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center">
              <button type="button" onClick={() => shiftYear(-1)} className={navBtn} aria-label="Poprzedni rok">«</button>
              <button type="button" onClick={() => shiftMonth(-1)} className={navBtn} aria-label="Poprzedni miesiąc">‹</button>
            </div>
            <p className="min-w-0 flex-1 truncate text-center text-sm font-bold text-ink">
              {MONTHS[cursor.month]} {cursor.year}
            </p>
            <div className="flex items-center">
              <button type="button" onClick={() => shiftMonth(1)} className={navBtn} aria-label="Następny miesiąc">›</button>
              <button type="button" onClick={() => shiftYear(1)} className={navBtn} aria-label="Następny rok">»</button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((day) => (
              <span key={day} className="py-1 text-center text-[0.65rem] font-bold uppercase tracking-wide text-stone-400">
                {day}
              </span>
            ))}
            {Array.from({ length: leading }, (_, i) => <span key={`pad-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const iso = `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`;
              const isSelected = iso === selectedIso;
              const isToday = iso === today;
              const tone = isSelected
                ? "bg-ink font-bold text-white"
                : isToday
                  ? "bg-moss/10 font-bold text-moss ring-1 ring-moss/40"
                  : "text-ink hover:bg-stone-100";
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => pick(day)}
                  aria-current={isToday ? "date" : undefined}
                  className={`flex h-9 items-center justify-center rounded-lg text-sm transition ${tone}`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-stone-100 pt-2">
            <button
              type="button"
              onClick={setToday}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-moss transition hover:bg-moss/10"
            >
              Dziś
            </button>
            <button
              type="button"
              onClick={clear}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-steel transition hover:bg-stone-100 hover:text-ink"
            >
              Wyczyść
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
