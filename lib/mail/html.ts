import sanitizeHtml from "sanitize-html";
import { htmlToPlainText } from "@/lib/mail/thread-model";

/**
 * Czyszczenie HTML poczty. Obowiązuje zasada: **HTML nigdy nie przechodzi przez system
 * w surowej postaci**. Wiadomości przychodzące czyścimy na serwerze, zanim trafią do
 * przeglądarki, a treść pisaną w edytorze czyścimy ponownie na serwerze przed wysłaniem —
 * nie ufamy temu, co przysyła klient, nawet jeśli to nasz własny edytor.
 */

/** Wspólna, wąska lista znaczników. Wszystko spoza niej wylatuje razem z atrybutami. */
const TEXT_TAGS = [
  "p", "br", "b", "strong", "i", "em", "u", "s",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "a", "h1", "h2", "h3", "h4", "span", "div",
  "table", "thead", "tbody", "tr", "td", "th"
];

// `target` i `rel` muszą tu być, inaczej filtr wycina atrybuty dodane przez `transformTags`
// i odnośnik z obcej poczty otwiera się w tej samej karcie, przekazując adres panelu dalej.
const LINK_ATTRIBUTES = {
  a: ["href", "title", "target", "rel"]
};

/**
 * Wiadomość przychodząca. Świadomie **usuwamy wszystkie obrazki** — zdalny obrazek
 * w mailu to najczęstszy sposób śledzenia, czy i kiedy wiadomość została otwarta.
 * Zdjęcia z budowy przychodzą jako załączniki i tam są dostępne.
 */
export function sanitizeIncomingHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: TEXT_TAGS,
    allowedAttributes: LINK_ATTRIBUTES,
    // Bez tego `javascript:` w odnośniku przeszłoby dalej.
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesAppliedToAttributes: ["href"],
    transformTags: {
      // Odnośniki z obcej poczty otwieramy w nowej karcie i odcinamy dostęp do naszego okna.
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" })
    },
    nonTextTags: ["style", "script", "textarea", "option", "noscript", "head", "title"]
  }).trim();
}

/**
 * Treść z naszego edytora przed wysłaniem. Lista znaczników jest jeszcze węższa —
 * edytor produkuje tylko formatowanie, którego sam pozwala użyć.
 */
export function sanitizeOutgoingHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "a", "blockquote"],
    allowedAttributes: LINK_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesAppliedToAttributes: ["href"],
    nonTextTags: ["style", "script", "textarea", "option", "noscript", "head", "title"]
  }).trim();
}

/**
 * Znaczniki, w które programy pocztowe pakują zacytowaną historię. Odcinamy ją,
 * bo w wątku poprzednie wiadomości i tak są widoczne wyżej — inaczej każda odpowiedź
 * ciągnęłaby ze sobą całą rozmowę.
 */
const QUOTE_CONTAINERS = [
  '<div class="gmail_quote',
  '<blockquote class="gmail_quote',
  '<div id="divRplyFwdMsg"', // Outlook
  '<div class="moz-cite-prefix"', // Thunderbird
  '<div class="yahoo_quoted'
];

export function stripQuotedHtml(html: string): string {
  let cut = html.length;
  for (const marker of QUOTE_CONTAINERS) {
    const index = html.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0 && index < cut) cut = index;
  }
  return html.slice(0, cut);
}

/** Czy po oczyszczeniu została jakakolwiek treść (sam `<p><br></p>` to pusta wiadomość). */
export function hasVisibleContent(html: string): boolean {
  return htmlToPlainText(html).replace(/\s+/g, "").length > 0;
}

/**
 * Wersja tekstowa wysyłanej wiadomości. Wysyłamy oba warianty, bo część programów
 * pocztowych i filtrów antyspamowych czyta wyłącznie czysty tekst.
 */
export function htmlToOutgoingText(html: string): string {
  return htmlToPlainText(html);
}
