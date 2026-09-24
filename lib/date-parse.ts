/**
 * Wpisywanie daty z klawiatury w polskim formacie dd.mm.rrrr.
 *
 * Wcześniej pole zbierało same cyfry i wstawiało kropki co dwie — „5.8.2026” zamieniało
 * się w „58.20.26”, a wpis ginął przy wyjściu z pola. Klient prosił, żeby „kliknę 5
 * i podstawi 05”. Parser dzieli wpis na segmenty (dzień, miesiąc, rok) i dopełnia zerem
 * wszystko, co nie może już urosnąć do dwóch cyfr.
 */

/** Separatory, które zamykają bieżący segment: kropka, ukośnik, myślnik, spacja, przecinek. */
const SEPARATOR = /[./\-\s,]/;

type Segments = { day: string; month: string; year: string; closed: number };

/**
 * Rozbiór wpisu na segmenty.
 *
 * Cyfra, po której nie da się już dopisać drugiej (dzień 4–9, miesiąc 2–9), od razu zamyka
 * segment z zerem na początku. Separator po pojedynczej cyfrze robi to samo („1.” → „01”).
 */
function splitSegments(raw: string): Segments {
  // Wklejona data w formacie ISO (rrrr-mm-dd), np. skopiowana z arkusza albo maila.
  const iso = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(raw);
  if (iso) {
    return { day: iso[3].padStart(2, "0"), month: iso[2].padStart(2, "0"), year: iso[1], closed: 2 };
  }

  const seg: Segments = { day: "", month: "", year: "", closed: 0 };
  const current = (): "day" | "month" | "year" => (seg.closed === 0 ? "day" : seg.closed === 1 ? "month" : "year");

  for (const ch of raw) {
    const key = current();
    if (/\d/.test(ch)) {
      if (key === "year") {
        if (seg.year.length < 4) seg.year += ch;
        continue;
      }
      const firstDigitMax = key === "day" ? 3 : 1;
      if (seg[key].length === 0 && Number(ch) > firstDigitMax) {
        seg[key] = `0${ch}`;
        seg.closed += 1;
      } else {
        seg[key] += ch;
        if (seg[key].length === 2) seg.closed += 1;
      }
    } else if (SEPARATOR.test(ch) && key !== "year" && seg[key].length === 1) {
      // „0” przed separatorem zostaje jak jest — „00” byłoby cichą zamianą na złą datę.
      if (seg[key] !== "0") seg[key] = `0${seg[key]}`;
      seg.closed += 1;
    }
  }
  return seg;
}

/**
 * Tekst do wyświetlenia w trakcie pisania.
 *
 * Kropki pojawiają się dopiero przed kolejnym segmentem, a nie po zamkniętym — inaczej
 * Backspace nie mógłby usunąć kropki, bo formatowanie od razu dopisywałoby ją z powrotem.
 */
export function formatDateWhileTyping(raw: string): string {
  const { day, month, year } = splitSegments(raw);
  if (!month && !year) return day;
  if (!year) return `${day}.${month}`;
  return `${day}.${month}.${year}`;
}

/** Sprawdza, czy data faktycznie istnieje (odrzuca np. 31.02). */
export function isRealDate(day: number, month: number, year: number): boolean {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(year, month - 1, day);
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Wpis → ISO rrrr-mm-dd albo null, gdy data jest niepełna lub nie istnieje.
 *
 * `allowShortYear` przyjmuje rok dwucyfrowy jako 20rr — używane przy wyjściu z pola,
 * żeby „5.8.26” dało 05.08.2026. W trakcie pisania wymagamy pełnego roku, bo „2” to
 * dopiero początek „2026”, a nie rok 2002.
 */
export function parsePlDate(raw: string, { allowShortYear = false }: { allowShortYear?: boolean } = {}): string | null {
  const { day, month, year } = splitSegments(raw);
  if (day.length !== 2 || month.length !== 2) return null;
  let fullYear: number;
  if (year.length === 4) fullYear = Number(year);
  else if (allowShortYear && year.length === 2) fullYear = 2000 + Number(year);
  else return null;
  const d = Number(day);
  const m = Number(month);
  if (!isRealDate(d, m, fullYear)) return null;
  return `${fullYear}-${pad(m)}-${pad(d)}`;
}

/** ISO (rrrr-mm-dd) → tekst dd.mm.rrrr. Pusty string dla braku daty. */
export function isoToPlDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "";
  return `${match[3]}.${match[2]}.${match[1]}`;
}
