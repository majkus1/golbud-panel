import { NextResponse } from "next/server";
import { describeMailboxError, fetchAttachment } from "@/lib/mail/imap-client";
import { isCaseMailFailure, resolveCaseMailContext } from "@/lib/mail/case-mail-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Załącznik pobierany prosto ze skrzynki — nie zapisujemy go po naszej stronie. */
export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  const resolved = await resolveCaseMailContext(request, caseId);
  if (isCaseMailFailure(resolved)) return resolved.response;

  const url = new URL(request.url);
  const uid = Number(url.searchParams.get("uid"));
  const partId = url.searchParams.get("part")?.trim();
  if (!Number.isInteger(uid) || uid <= 0 || !partId || !/^[\d.]+$/.test(partId)) {
    return NextResponse.json({ error: "Nieprawidłowy identyfikator załącznika" }, { status: 400 });
  }

  try {
    const attachment = await fetchAttachment(resolved.credentials, uid, partId);
    if (!attachment) return NextResponse.json({ error: "Nie znaleziono załącznika" }, { status: 404 });

    return new NextResponse(new Uint8Array(attachment.content), {
      headers: {
        "Content-Type": attachment.mimeType,
        // Nazwa pliku bywa z polskimi znakami — RFC 5987 zamiast psucia nagłówka.
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const described = describeMailboxError(error);
    return NextResponse.json({ error: described.message }, { status: 502 });
  }
}
