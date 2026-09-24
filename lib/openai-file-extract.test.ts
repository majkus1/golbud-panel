import { afterEach, describe, expect, it, vi } from "vitest";
import { extractJsonFromFile, parseJsonFromModelText } from "@/lib/openai-file-extract";

describe("JSON z odpowiedzi modelu", () => {
  it("zdejmuje ```json i dopiski wokół tablicy", () => {
    expect(parseJsonFromModelText('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
    expect(parseJsonFromModelText('Oto pozycje:\n[{"a":1}]\nTo wszystko.')).toEqual([{ a: 1 }]);
    expect(() => parseJsonFromModelText("brak danych")).toThrow();
  });
});

describe("odczyt pliku przez OpenAI", () => {
  const original = process.env.OPENAI_API_KEY;
  afterEach(() => {
    process.env.OPENAI_API_KEY = original;
    vi.restoreAllMocks();
  });

  it("bez klucza nie wysyła nic i mówi, czego brakuje", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_KEY;
    delete process.env.OPENAI_SECRET_KEY;
    const fetchImpl = vi.fn();
    const result = await extractJsonFromFile({ bytes: new Uint8Array([1]), fileName: "k.pdf", mimeType: "application/pdf", instruction: "x", fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("PDF idzie jako input_file, odpowiedź wraca jako JSON", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ output_text: '[{"nazwa":"Tynk"}]' }), { status: 200 }));
    const result = await extractJsonFromFile({ bytes: new Uint8Array([37, 80, 68, 70]), fileName: "kosztorys.pdf", mimeType: "application/pdf", instruction: "Odczytaj", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ ok: true, data: [{ nazwa: "Tynk" }] });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.input[0].content[1]).toMatchObject({ type: "input_file", filename: "kosztorys.pdf" });
    expect(body.input[0].content[1].file_data).toMatch(/^data:application\/pdf;base64,/);
  });

  it("błąd OpenAI i śmieciowa odpowiedź dają czytelny komunikat", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const failing = vi.fn(async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }));
    expect(await extractJsonFromFile({ bytes: new Uint8Array([1]), fileName: "a.jpg", mimeType: "image/jpeg", instruction: "x", fetchImpl: failing as unknown as typeof fetch })).toMatchObject({ ok: false, reason: "request_failed", error: "quota" });
    const garbage = vi.fn(async () => new Response(JSON.stringify({ output_text: "nie wiem" }), { status: 200 }));
    expect(await extractJsonFromFile({ bytes: new Uint8Array([1]), fileName: "a.jpg", mimeType: "image/jpeg", instruction: "x", fetchImpl: garbage as unknown as typeof fetch })).toMatchObject({ ok: false, reason: "bad_output" });
  });
});
