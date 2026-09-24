/**
 * Odczyt pliku (PDF lub zdjęcie) przez OpenAI i zwrot danych jako JSON.
 * Wspólne dla importu faktur kosztowych (Rentowność) i importu kosztorysu do oferty.
 * Tylko po stronie serwera — klucz API nie może trafić do przeglądarki.
 */

export type FileExtractFailure = {
  ok: false;
  /** not_configured — brak klucza; request_failed — błąd OpenAI; bad_output — odpowiedź nie jest JSON-em. */
  reason: "not_configured" | "request_failed" | "bad_output";
  error: string;
};

export type FileExtractResult = { ok: true; data: unknown } | FileExtractFailure;

export function openAiApiKey(): string {
  return (process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENAI_SECRET_KEY || "").trim();
}

export function openAiOcrModel(): string {
  return process.env.OPENAI_OCR_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";
}

type ResponsesJson = { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };

export function parseOpenAiResponseText(json: ResponsesJson): string {
  return (json.output_text || json.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("\n") || "").trim();
}

/**
 * JSON z odpowiedzi modelu: bez bloków ```json, a gdy model dopisze zdanie przed/po —
 * bierzemy fragment od pierwszego `[`/`{` do ostatniego `]`/`}`.
 */
export function parseJsonFromModelText(text: string): unknown {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.search(/[[{]/);
    const end = Math.max(clean.lastIndexOf("]"), clean.lastIndexOf("}"));
    if (start < 0 || end <= start) throw new Error("Odpowiedź nie zawiera JSON");
    return JSON.parse(clean.slice(start, end + 1));
  }
}

export function isPdfOrImage(fileName: string, mimeType: string): boolean {
  return mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf") || mimeType.startsWith("image/");
}

export async function extractJsonFromFile({
  bytes,
  fileName,
  mimeType,
  instruction,
  fetchImpl = fetch
}: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  instruction: string;
  fetchImpl?: typeof fetch;
}): Promise<FileExtractResult> {
  const apiKey = openAiApiKey();
  if (!apiKey) return { ok: false, reason: "not_configured", error: "Odczyt PDF i zdjęć wymaga klucza OpenAI (OPENAI_API_KEY) w ustawieniach serwera." };

  const dataUrl = `data:${mimeType || "application/octet-stream"};base64,${Buffer.from(bytes).toString("base64")}`;
  const filePart =
    mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")
      ? { type: "input_file", filename: fileName, file_data: dataUrl }
      : { type: "input_image", image_url: dataUrl };

  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: openAiOcrModel(),
        input: [{ role: "user", content: [{ type: "input_text", text: instruction }, filePart] }]
      })
    });
  } catch {
    return { ok: false, reason: "request_failed", error: "Brak połączenia z usługą odczytu plików." };
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = ((await response.json()) as { error?: { message?: string } }).error?.message || "";
    } catch {
      /* odpowiedź bez JSON */
    }
    return { ok: false, reason: "request_failed", error: detail || `Odczyt pliku nie powiódł się (HTTP ${response.status}).` };
  }

  const text = parseOpenAiResponseText((await response.json()) as ResponsesJson);
  try {
    return { ok: true, data: parseJsonFromModelText(text) };
  } catch {
    return { ok: false, reason: "bad_output", error: "Nie udało się odczytać danych z pliku — spróbuj wyraźniejszego skanu albo pliku Excel." };
  }
}
