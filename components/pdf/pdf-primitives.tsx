import { readFileSync } from "node:fs";
import { Text as ReactPdfText } from "@react-pdf/renderer";
import { createElement, type ComponentProps } from "react";

/**
 * `<Text>` bez łamania słów w środku.
 *
 * Tekst składamy z dwóch plików Inter (podstawowe litery i polskie znaki). react-pdf dzieli
 * słowo na części według fontu, więc „wynikających” to dla niego „wynikają” + „cych” i w tym
 * miejscu wolno mu złamać wiersz z łącznikiem — łącznik brał z fontu bez tego znaku i na
 * wydruku był pusty prostokąt. Kara za dzielenie równa „nieskończoności” silnika (10000)
 * wyłącza takie miejsca; słów i tak nie dzielimy (pdfHyphenation zwraca całe słowo).
 *
 * `hyphenationPenalty` nie ma w typach react-pdf, ale silnik układu czyta go z właściwości węzła.
 */
const NO_WORD_BREAK = 10000;

export function Text(props: ComponentProps<typeof ReactPdfText>) {
  // Tekst dynamiczny (numer strony przez `render`) zostaje bez zmian — react-pdf wywołuje
  // `render` tylko wtedy, gdy węzeł nie ma dodatkowych właściwości układu.
  if ("render" in props && props.render) return createElement(ReactPdfText, props);
  return createElement(ReactPdfText, { ...props, hyphenationPenalty: NO_WORD_BREAK } as unknown as ComponentProps<typeof ReactPdfText>);
}

/**
 * Obraz z pliku na dysku jako zawartość, a nie ścieżka.
 *
 * react-pdf rozpoznaje ścieżkę przez parser adresów URL. Na Windowsie „C:\…\logo-golbud.png”
 * wygląda dla niego jak adres z protokołem „c:”, więc próbuje go pobrać z sieci i po cichu
 * pomija obraz — na lokalnym dev żaden PDF nie miał logo. Zawartość pliku działa wszędzie.
 */
export function pdfImageSource(filePath: string): string | { data: Buffer; format: "png" | "jpg" } {
  try {
    const data = readFileSync(filePath);
    const lower = filePath.toLowerCase();
    return { data, format: lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "jpg" : "png" };
  } catch {
    return filePath;
  }
}
