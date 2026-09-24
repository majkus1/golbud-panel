import path from "node:path";
import { Font } from "@react-pdf/renderer";
import { pdfHyphenation } from "@/lib/pdf-text";

/**
 * Inter jest w paczce @fontsource podzielony na zakresy znaków: `latin` ma podstawowe litery,
 * cyfry, „§”, „…” i polskie cudzysłowy, a `latin-ext` — ą, ć, ę, ł, ń, ó, ś, ź, ż.
 *
 * Do tej pory rejestrowany był tylko `latin-ext`, w którym nie ma liter a–z ani cyfr.
 * react-pdf dobierał wtedy brakujące znaki z Helvetiki, więc każdy PDF był składany z dwóch
 * krojów naraz: polskie litery w Inter, reszta w Helvetice — widoczne jako nierówny tekst.
 *
 * Rejestrujemy oba zakresy jako osobne rodziny i podajemy je listą: react-pdf wybiera
 * dla każdego znaku pierwszą rodzinę, która go zawiera.
 */
const PDF_FONT_LATIN = "BuildflowInterLatin";
const PDF_FONT_LATIN_EXT = "BuildflowInter";

/** Rodzina do `fontFamily` w StyleSheet — lista zakresów w kolejności wyboru. */
export const PDF_FONT_FAMILY: string[] = [PDF_FONT_LATIN, PDF_FONT_LATIN_EXT];

let registered = false;

/**
 * `Font.register` wymaga `src` jako string (ścieżka pliku, URL lub data URL).
 * Przekazanie `Buffer` (nawet z castem) psuje `@react-pdf/font`: `isDataUrl` woła
 * `.substring` na `src` — dla Buffera to nie jest funkcja; dodatkowo przecinek
 * w bajtach pliku WOFF może wejść w gałąź „data URL”.
 *
 * WOFF (nie WOFF2) + `fontkit.open(ścieżka)` jest stabilne na Node/Vercel.
 * Kursywy nie rejestrujemy — żaden dokument jej nie używa, a styl bez zarejestrowanego
 * pliku kończy się błędem „Could not resolve font”.
 */
export function registerPdfFonts(): void {
  if (registered) return;
  registered = true;

  const filesDir = path.join(process.cwd(), "node_modules", "@fontsource", "inter", "files");

  Font.register({
    family: PDF_FONT_LATIN,
    fonts: [
      { src: path.join(filesDir, "inter-latin-400-normal.woff"), fontWeight: 400 },
      { src: path.join(filesDir, "inter-latin-700-normal.woff"), fontWeight: 700 }
    ]
  });

  Font.register({
    family: PDF_FONT_LATIN_EXT,
    fonts: [
      { src: path.join(filesDir, "inter-latin-ext-400-normal.woff"), fontWeight: 400 },
      { src: path.join(filesDir, "inter-latin-ext-700-normal.woff"), fontWeight: 700 }
    ]
  });
  renameLoadedFonts(PDF_FONT_LATIN_EXT);

  Font.registerHyphenationCallback(pdfHyphenation);
}

/** Minimalny kształt wewnętrznego źródła fontu react-pdf, którego tu potrzebujemy. */
type LoadableFontSource = {
  fontWeight: number;
  data: object | null;
  _load: () => Promise<void>;
};

/**
 * Oba pliki (`latin` i `latin-ext`) mają w środku tę samą nazwę PostScript „Inter-Regular”
 * (a pogrubione „Inter-Bold”). pdfkit przy osadzaniu sprawdza, czy font o tej nazwie jest
 * już w dokumencie, i jeśli tak — używa tamtego. Znaki z `latin-ext` dostawały wtedy numery
 * glifów z `latin`: zamiast „ł” było „˷”, zamiast „ą” — „6”, a „ż” znikało.
 *
 * Nadajemy więc wczytanym fontom `latin-ext` własną nazwę. Plik fontu zostaje bez zmian,
 * zmienia się tylko nazwa, pod którą pdfkit go rozpoznaje i osadza. Test
 * `lib/register-pdf-fonts.test.ts` pilnuje, żeby w PDF-ie były dwa osobne fonty.
 */
function renameLoadedFonts(family: string): void {
  const registered = Font.getRegisteredFonts()[family] as unknown as { sources?: LoadableFontSource[] } | undefined;
  const sources = registered?.sources;
  if (!sources?.length) {
    throw new Error(`register-pdf-fonts: nie znaleziono źródeł rodziny ${family} — zmieniło się API react-pdf.`);
  }
  for (const source of sources) {
    if (typeof source._load !== "function") {
      throw new Error("register-pdf-fonts: brak FontSource._load — zmieniło się API react-pdf.");
    }
    const load = source._load.bind(source);
    source._load = async () => {
      await load();
      if (source.data) {
        Object.defineProperty(source.data, "postscriptName", {
          value: `${family}-${source.fontWeight}`,
          configurable: true
        });
      }
    };
  }
}
