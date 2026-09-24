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

  Font.registerHyphenationCallback(pdfHyphenation);
}
