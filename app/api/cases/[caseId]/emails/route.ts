import { NextResponse } from "next/server";
import { hasVisibleContent, htmlToOutgoingText, sanitizeOutgoingHtml } from "@/lib/mail/html";
import { describeMailboxError } from "@/lib/mail/imap-client";
import { isCaseMailFailure, resolveCaseAccess, resolveCaseMailContext } from "@/lib/mail/case-mail-context";
import { MailSendDisabledError, sendFromAccount } from "@/lib/mail/send";
import { loadStoredThreads } from "@/lib/mail/store";
import { buildReplyHeaders, replySubject } from "@/lib/mail/thread-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Pobranie kilkudziesięciu wiadomości po IMAP bywa wolne; domyślne 10 s to za mało. */
export const maxDuration = 60;

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * GET — historia zapisana w bazie. Nie łączy się ze skrzynką, więc działa natychmiast
 * i także wtedy, gdy użytkownik odłączył pocztę. Pobieranie nowych wiadomości
 * robi osobna trasa `./sync`.
 */
export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  const access = await resolveCaseAccess(request, caseId);
  if (isCaseMailFailure(access)) return access.response;

  try {
    const stored = await loadStoredThreads(access.supabase, caseId);
    return NextResponse.json({
      clientEmail: access.caseRow.email?.trim() ?? null,
      threads: stored.threads,
      messageCount: stored.messageCount,
      lastSyncedAt: stored.lastSyncedAt
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się wczytać historii" },
      { status: 500 }
    );
  }
}

/** Gmail przyjmuje wiadomości do ~25 MB razem z kodowaniem — 10 MB to bezpieczny próg. */
const MAX_ATTACHMENTS_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_COUNT = 10;

/** POST — odpowiedź w wątku albo nowy temat do klienta. Dane jako `multipart/form-data`. */
export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  const resolved = await resolveCaseMailContext(request, caseId);
  if (isCaseMailFailure(resolved)) return resolved.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane" }, { status: 400 });
  }

  const rawHtml = String(form.get("html") ?? "").trim();
  // Czyścimy ponownie po stronie serwera — treść z przeglądarki zawsze traktujemy jak obcą.
  const html = rawHtml ? sanitizeOutgoingHtml(rawHtml) : "";
  if (!html || !hasVisibleContent(html)) {
    return NextResponse.json({ error: "Treść wiadomości jest pusta" }, { status: 400 });
  }
  const text = htmlToOutgoingText(html);

  const clientEmail = resolved.caseRow.email?.trim();
  const rawTo = String(form.get("to") ?? "").trim();
  const recipients = rawTo
    ? Array.from(new Set(rawTo.split(/[,;]/).map((entry) => entry.trim()).filter(isEmail)))
    : clientEmail && isEmail(clientEmail)
      ? [clientEmail]
      : [];
  if (recipients.length === 0) {
    return NextResponse.json({ error: "Brak poprawnego adresu odbiorcy" }, { status: 400 });
  }

  let thread: Parameters<typeof buildReplyHeaders>[0] | undefined;
  const rawThread = form.get("thread");
  if (typeof rawThread === "string" && rawThread) {
    try {
      thread = JSON.parse(rawThread);
    } catch {
      return NextResponse.json({ error: "Nieprawidłowe dane wątku" }, { status: 400 });
    }
  }

  const headers = thread ? buildReplyHeaders(thread) : {};
  const rawSubject = String(form.get("subject") ?? "").trim();
  const subject = thread
    ? replySubject(thread.subject ?? "")
    : rawSubject || `Zlecenie: ${resolved.caseRow.client_name}`;

  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length > MAX_ATTACHMENTS_COUNT) {
    return NextResponse.json({ error: `Maksymalnie ${MAX_ATTACHMENTS_COUNT} załączników` }, { status: 400 });
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
    return NextResponse.json({ error: "Załączniki przekraczają 10 MB" }, { status: 400 });
  }

  const attachments = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      content: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || "application/octet-stream"
    }))
  );

  try {
    const sent = await sendFromAccount(resolved.account, resolved.credentials.appPassword, {
      to: recipients,
      subject,
      text,
      html,
      attachments,
      inReplyTo: headers.inReplyTo,
      references: headers.references
    });
    return NextResponse.json({ ok: true, messageId: sent.messageId, sentTo: recipients });
  } catch (error) {
    if (error instanceof MailSendDisabledError) {
      return NextResponse.json({ error: error.message, reason: "send_disabled" }, { status: 503 });
    }
    const described = describeMailboxError(error);
    return NextResponse.json({ error: described.message }, { status: 502 });
  }
}
