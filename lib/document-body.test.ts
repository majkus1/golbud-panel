import { describe, expect, it } from "vitest";
import { bodyHasSignatures, bodyHasTitle, parseDocumentBody, parseRuns } from "./document-body";

describe("parseRuns", () => {
  it("dzieli tekst na pogrubienia", () => {
    expect(parseRuns("zwaną dalej **„Inwestorem”**,")).toEqual([
      { text: "zwaną dalej ", bold: false },
      { text: "„Inwestorem”", bold: true },
      { text: ",", bold: false }
    ]);
  });

  it("niesparowana gwiazdka zostaje tekstem", () => {
    expect(parseRuns("a ** b")).toEqual([{ text: "a ** b", bold: false }]);
    expect(parseRuns("**x** i ** reszta")).toEqual([
      { text: "x", bold: true },
      { text: " i ** reszta", bold: false }
    ]);
  });
});

describe("parseDocumentBody", () => {
  it("rozpoznaje tytuł, paragraf i akapity", () => {
    const blocks = parseDocumentBody("# UMOWA NR 12/2026\n<> zawarta w Ożarowie\n\n§ 1 Przedmiot Umowy\nTreść akapitu.");
    expect(blocks.map((b) => b.type)).toEqual(["title", "paragraph", "spacer", "section", "paragraph"]);
    expect(blocks[1]).toMatchObject({ align: "center" });
    expect(blocks[3]).toEqual({ type: "section", label: "§ 1", title: "Przedmiot Umowy" });
    expect(bodyHasTitle(blocks)).toBe(true);
  });

  it("paragraf z kropką i bez tytułu", () => {
    expect(parseDocumentBody("§ 3. Wynagrodzenie")[0]).toEqual({ type: "section", label: "§ 3", title: "Wynagrodzenie" });
    expect(parseDocumentBody("§ 11")[0]).toEqual({ type: "section", label: "§ 11", title: "" });
  });

  it("listy: numery, litery jako podpunkty, wcięcia", () => {
    const blocks = parseDocumentBody("1. Pierwszy\n2) Drugi\na) literowy\n  - wcięty\n    b) głębiej");
    expect(blocks).toMatchObject([
      { type: "item", marker: "1.", level: 0 },
      { type: "item", marker: "2)", level: 0 },
      { type: "item", marker: "a)", level: 1 },
      { type: "item", marker: "-", level: 1 },
      { type: "item", marker: "b)", level: 2 }
    ]);
  });

  it("data na początku wiersza nie jest punktem listy", () => {
    expect(parseDocumentBody("5.8.2026 r. ustalono")[0]).toMatchObject({ type: "paragraph" });
    expect(parseDocumentBody("2026 rok")[0]).toMatchObject({ type: "paragraph" });
  });

  it("pola wyboru", () => {
    const blocks = parseDocumentBody("[ ] Roboty odebrano bez zastrzeżeń.\n[x] Z uwagami");
    expect(blocks).toMatchObject([
      { type: "checkbox", checked: false },
      { type: "checkbox", checked: true }
    ]);
  });

  it("tabela z nagłówkiem i bez", () => {
    const [withHeader] = parseDocumentBody("| Lp. | Nazwa |\n| --- | --- |\n| 1 | Tynk |\n| 2 | Siatka |");
    expect(withHeader).toMatchObject({ type: "table" });
    if (withHeader.type !== "table") throw new Error();
    expect(withHeader.header?.map((c) => c[0].text)).toEqual(["Lp.", "Nazwa"]);
    expect(withHeader.rows).toHaveLength(2);

    const [plain] = parseDocumentBody("| **Data:** | 1.09 |\n| Umowa | 12 |");
    if (plain.type !== "table") throw new Error();
    expect(plain.header).toBeNull();
    expect(plain.rows[0][0]).toEqual([{ text: "Data:", bold: true }]);
  });

  it("podpisy w środku dokumentu i nowa strona", () => {
    const blocks = parseDocumentBody("Tekst\n[podpisy: INWESTOR | WYKONAWCA]\n---strona---\nDalej");
    expect(blocks).toMatchObject([
      { type: "paragraph" },
      { type: "signatures", labels: ["INWESTOR", "WYKONAWCA"] },
      { type: "pagebreak" },
      { type: "paragraph" }
    ]);
    expect(bodyHasSignatures(blocks)).toBe(true);
  });

  it("zbija puste wiersze i obcina końcowe", () => {
    expect(parseDocumentBody("a\n\n\n\nb\n\n").map((b) => b.type)).toEqual(["paragraph", "spacer", "paragraph"]);
  });
});
