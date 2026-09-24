import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, safeStorageName, validateUpload } from "./case-attachments";

describe("validateUpload", () => {
  it("przyjmuje PDF i zdjęcia do 15 MB", () => {
    expect(validateUpload({ size: 1000, type: "application/pdf" })).toBeNull();
    expect(validateUpload({ size: MAX_UPLOAD_BYTES, type: "image/jpeg" })).toBeNull();
  });

  it("odrzuca za duże i nieobsługiwane pliki z czytelnym komunikatem", () => {
    expect(validateUpload({ size: MAX_UPLOAD_BYTES + 1, type: "application/pdf" })).toMatch(/15 MB/);
    expect(validateUpload({ size: 10, type: "application/msword" })).toMatch(/PDF/);
  });
});

describe("safeStorageName", () => {
  it("zostawia polskie litery, usuwa znaki niebezpieczne w ścieżce", () => {
    expect(safeStorageName("Umowa — Łódź/2026.pdf")).toBe("Umowa _ Łódź_2026.pdf");
    expect(safeStorageName("../../etc")).toBe(".._.._etc");
    expect(safeStorageName("???")).toBe("_");
    expect(safeStorageName("   ")).toBe("plik");
  });
});
