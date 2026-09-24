import { createElement } from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { PDF_FONT_FAMILY, registerPdfFonts } from "./register-pdf-fonts";

/**
 * Strażnik błędu z krzaczkami w PDF-ach: podstawowe litery i polskie znaki leżą w dwóch
 * plikach Inter o tej samej nazwie wewnętrznej. Gdy pdfkit weźmie je za jeden font,
 * „ł”, „ą”, „ż” zamieniają się w przypadkowe znaki. PDF musi osadzać dwa osobne fonty.
 */
describe("registerPdfFonts", () => {
  it("osadza zakres latin i latin-ext jako osobne fonty", async () => {
    registerPdfFonts();
    const doc = createElement(
      Document,
      null,
      createElement(
        Page,
        { size: "A4" },
        createElement(Text, { style: { fontFamily: PDF_FONT_FAMILY } }, "Zażółć gęślą jaźń — § 1 „cudzysłów” …"),
        createElement(Text, { style: { fontFamily: PDF_FONT_FAMILY, fontWeight: 700 } }, "Oświadczenie Łódź")
      )
    );
    const pdf = (await renderToBuffer(doc)).toString("latin1");
    const baseFonts = Array.from(pdf.matchAll(/\/BaseFont\s*\/([A-Z]{6}\+[^\s/>]+)/g), (m) => m[1].split("+")[1]);
    const unique = Array.from(new Set(baseFonts)).sort();

    expect(unique).toEqual(["BuildflowInter-400", "BuildflowInter-700", "Inter-Bold", "Inter-Regular"]);
    // Żadnego zapasowego fontu standardowego (Helvetica) — cały tekst w jednym kroju.
    expect(pdf).not.toMatch(/\/BaseFont\s*\/Helvetica/);
  }, 30_000);
});
