import path from "node:path";
import { Font } from "@react-pdf/renderer";
import { pdfHyphenation } from "@/lib/pdf-text";

/** Nazwa rodziny w StyleSheet — nie koliduje z CSS w przeglądarce. */
export const PDF_FONT_FAMILY = "BuildflowInter";

let registered = false;

/**
 * `Font.register` wymaga `src` jako string (ścieżka pliku, URL lub data URL).
 * Przekazanie `Buffer` (nawet z castem) psuje `@react-pdf/font`: `isDataUrl` woła
 * `.substring` na `src` — dla Buffera to nie jest funkcja; dodatkowo przecinek
 * w bajtach pliku WOFF może wejść w gałąź „data URL”.
 *
 * WOFF (nie WOFF2) + `fontkit.open(ścieżka)` jest stabilne na Node/Vercel.
 */
export function registerPdfFonts(): void {
  if (registered) return;
  registered = true;

  const filesDir = path.join(process.cwd(), "node_modules", "@fontsource", "inter", "files");
  const regularPath = path.join(filesDir, "inter-latin-ext-400-normal.woff");
  const boldPath = path.join(filesDir, "inter-latin-ext-700-normal.woff");

  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: regularPath, fontWeight: 400 },
      { src: boldPath, fontWeight: 700 }
    ]
  });

  Font.registerHyphenationCallback(pdfHyphenation);
}
