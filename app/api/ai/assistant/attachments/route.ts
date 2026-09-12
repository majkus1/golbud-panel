import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import {
  canAccessAssistantCase,
  getOrCreateConversation,
  resolveAssistantAccess
} from "@/lib/ai-assistant";
import { safeStorageFilename } from "@/lib/hr";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { AiMessageAttachment } from "@/lib/types";

export const runtime = "nodejs";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 24000;
const OCR_PROMPT = [
  "Odczytaj dokument, fakturę lub plik dla asystenta firmy budowlanej GolBud.",
  "Zwróć po polsku:",
  "1. Krótkie streszczenie dokumentu",
  "2. Kwoty (netto, brutto, VAT, do zapłaty)",
  "3. Daty (wystawienia, termin płatności, realizacji)",
  "4. Kontrahentów (sprzedawca, nabywca, klient)",
  "5. Pozycje tabel (nazwa, ilość, cena, wartość)",
  "6. Ryzyka i uwagi biznesowe",
  "Pisz konkretnie. Jeśli czegoś nie widać, napisz „brak danych w dokumencie”. Nie wymyślaj."
].join("\n");

type ExtractionResult = { text: string; status: "ready" | "failed"; error: string | null };

function trimExtracted(text: string): string {
  const clean = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
  return clean.length > MAX_EXTRACTED_CHARS
    ? `${clean.slice(0, MAX_EXTRACTED_CHARS - 120)}\n\n[... treść pliku skrócona z powodu limitu ...]`
    : clean;
}

function extension(name: string): string {
  return name.toLowerCase().split(".").pop() || "";
}

function openAiApiKey(): string {
  return (process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENAI_SECRET_KEY || "").trim();
}

function openAiOcrModel(): string {
  return process.env.OPENAI_OCR_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";
}

function isTextLike(file: File): boolean {
  const ext = extension(file.name);
  return file.type.startsWith("text/") || ["csv", "txt", "md", "json", "xml"].includes(ext);
}

function isWorkbook(file: File): boolean {
  return ["xlsx", "xls"].includes(extension(file.name));
}

function isPdfOrImage(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") || file.type.startsWith("image/");
}

function workbookText(buffer: ArrayBuffer): string {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  return workbook.SheetNames.slice(0, 5)
    .map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }).slice(0, 120);
      return [`## Arkusz: ${sheetName}`, JSON.stringify(rows, null, 2)].join("\n");
    })
    .join("\n\n");
}

function parseOpenAiResponseText(json: { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }): string {
  return (
    json.output_text ||
    json.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("\n") ||
    ""
  ).trim();
}

async function extractWithOpenAiOcr(file: File, buffer: ArrayBuffer): Promise<ExtractionResult> {
  const apiKey = openAiApiKey();
  if (!apiKey) {
    return {
      text: "",
      status: "failed",
      error: "OCR wymaga ustawienia OPENAI_API_KEY w środowisku."
    };
  }

  try {
    const bytes = Buffer.from(buffer);
    const dataUrl = `data:${file.type || "application/octet-stream"};base64,${bytes.toString("base64")}`;
    const filePart =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
        ? { type: "input_file" as const, filename: file.name, file_data: dataUrl }
        : { type: "input_image" as const, image_url: dataUrl };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: openAiOcrModel(),
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: OCR_PROMPT }, filePart]
          }
        ]
      })
    });

    if (!response.ok) {
      let detail = "";
      try {
        const errJson = (await response.json()) as { error?: { message?: string } };
        detail = errJson.error?.message || "";
      } catch {
        /* ignore parse errors */
      }
      return {
        text: "",
        status: "failed",
        error: detail || `OCR nie powiódł się (HTTP ${response.status}).`
      };
    }

    const text = trimExtracted(parseOpenAiResponseText((await response.json()) as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }));
    if (!text) {
      return { text: "", status: "failed", error: "OCR zwrócił pustą treść." };
    }
    return { text, status: "ready", error: null };
  } catch (error) {
    return {
      text: "",
      status: "failed",
      error: error instanceof Error ? error.message : "Nie udało się wykonać OCR."
    };
  }
}

async function extractFileText(file: File, buffer: ArrayBuffer): Promise<ExtractionResult> {
  try {
    if (isWorkbook(file)) return { text: trimExtracted(workbookText(buffer)), status: "ready", error: null };
    if (isTextLike(file)) return { text: trimExtracted(Buffer.from(buffer).toString("utf8")), status: "ready", error: null };
    if (isPdfOrImage(file)) return extractWithOpenAiOcr(file, buffer);
    return {
      text: "",
      status: "failed",
      error: `Nieobsługiwany typ pliku: ${file.type || extension(file.name) || "nieznany"}.`
    };
  } catch (error) {
    return {
      text: "",
      status: "failed",
      error: error instanceof Error ? error.message : "Nie udało się odczytać pliku."
    };
  }
}

export async function POST(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  const { supabase } = auth;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const form = await request.formData();
  const access = await resolveAssistantAccess(supabase, user.id, String(form.get("organizationId") || ""));
  if (!access) return NextResponse.json({ error: "Brak dostępu do organizacji." }, { status: 403 });
  if (!access.canUseAssistant) return NextResponse.json({ error: "Asystent AI nie jest dostępny dla Twojej roli." }, { status: 403 });

  const caseId = String(form.get("caseId") || "").trim() || null;
  if (caseId && !(await canAccessAssistantCase(supabase, access, user.id, caseId))) {
    return NextResponse.json({ error: "Brak dostępu do tej sprawy." }, { status: 403 });
  }

  const conversation = await getOrCreateConversation(supabase, access, user.id, {
    conversationId: String(form.get("conversationId") || "").trim() || null,
    caseId,
    title: caseId ? "Asystent AI sprawy" : "Asystent AI firmy",
    forceNew: String(form.get("forceNew") || "") === "true"
  });

  const files = form.getAll("files").filter((file): file is File => file instanceof File).slice(0, MAX_FILES);
  if (files.length === 0) return NextResponse.json({ error: "Dodaj plik do odczytu." }, { status: 400 });

  const attachments: AiMessageAttachment[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `Plik ${file.name} przekracza limit 15 MB.` }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const storagePath = `${access.organizationId}/${conversation.id}/${crypto.randomUUID()}-${safeStorageFilename(file.name)}`;
    const { error: uploadError } = await supabase.storage.from("ai-attachments").upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 400 });

    const extracted = await extractFileText(file, buffer);
    const { data, error } = await supabase
      .from("ai_message_attachments")
      .insert({
        organization_id: access.organizationId,
        conversation_id: conversation.id,
        case_id: caseId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || null,
        file_size: file.size,
        extracted_text: extracted.text || null,
        extraction_status: extracted.status,
        extraction_error: extracted.error,
        created_by: user.id
      })
      .select("*")
      .single();
    if (error) {
      await supabase.storage.from("ai-attachments").remove([storagePath]);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    attachments.push(data as AiMessageAttachment);
  }

  // Rozmowy z Asystentem AI są w pełni prywatne (patrz migracja 0050) — nie logujemy
  // załączników w ogólnofirmowym Dzienniku zmian. Ślad zostaje w `ai_message_attachments`
  // (created_by), widocznym tylko dla autora.

  return NextResponse.json({ conversation, attachments });
}
