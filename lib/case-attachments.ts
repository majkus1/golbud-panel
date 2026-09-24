import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attachment, AttachmentCategory } from "@/lib/types";

/**
 * Dodawanie plików do sprawy — wspólne dla zakładki Umowa, sekcji Dokumentacji
 * i zapisu dokumentów wygenerowanych z wzoru. Wcześniej ten sam kod był w dwóch miejscach
 * i różnił się obsługą błędów.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_UPLOAD_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const UPLOAD_ACCEPT = ALLOWED_UPLOAD_MIME.join(",");

/** Komunikat dla użytkownika albo null, gdy plik można wysłać. */
export function validateUpload(file: { size: number; type: string }): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return "Plik za duży — najwyżej 15 MB.";
  if (!(ALLOWED_UPLOAD_MIME as readonly string[]).includes(file.type)) return "Można dodać zdjęcie (JPG, PNG, WebP) albo PDF.";
  return null;
}

/** Nazwa pliku bezpieczna dla ścieżki w Storage; polskie litery zostają. */
export function safeStorageName(name: string): string {
  const cleaned = name.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]+/g, "_").trim().slice(0, 120);
  return cleaned || "plik";
}

type UploadInput = {
  organizationId: string;
  caseId: string;
  userId: string;
  file: Blob;
  fileName: string;
  mimeType: string;
  category: AttachmentCategory;
  source?: "upload" | "generated";
  templateId?: string | null;
};

export async function uploadCaseAttachment(
  client: SupabaseClient,
  input: UploadInput
): Promise<{ ok: true; attachment: Attachment } | { ok: false; error: string }> {
  const path = `${input.organizationId}/${input.caseId}/${crypto.randomUUID()}_${safeStorageName(input.fileName)}`;
  const { error: uploadError } = await client.storage
    .from("case-attachments")
    .upload(path, input.file, { contentType: input.mimeType, upsert: false });
  if (uploadError) return { ok: false, error: `Nie udało się wysłać pliku: ${uploadError.message}` };

  const { data, error } = await client
    .from("attachments")
    .insert({
      organization_id: input.organizationId,
      case_id: input.caseId,
      storage_path: path,
      file_name: input.fileName,
      mime_type: input.mimeType,
      size_bytes: input.file.size,
      category: input.category,
      uploaded_by: input.userId,
      source: input.source ?? "upload",
      template_id: input.templateId ?? null
    })
    .select("*")
    .single();

  if (error || !data) {
    // Bez wpisu w bazie plik byłby niewidoczny i nieusuwalny z programu — sprzątamy go.
    await client.storage.from("case-attachments").remove([path]);
    return { ok: false, error: `Nie udało się zapisać pliku w sprawie: ${error?.message ?? "brak odpowiedzi"}` };
  }
  return { ok: true, attachment: data as Attachment };
}
