import { NextResponse } from "next/server";
import { isCaseMailFailure, resolveCaseMailContext } from "@/lib/mail/case-mail-context";
import { describeMailboxError, fetchConversation } from "@/lib/mail/imap-client";
import { loadStoredThreads, saveMessages, threadKeyOf } from "@/lib/mail/store";
import { normalizeSubject } from "@/lib/mail/thread-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Pobranie kilkudziesięciu wiadomości po IMAP bywa wolne; domyślne 10 s to za mało. */
export const maxDuration = 60;

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Pobranie nowych wiadomości ze skrzynki i dopisanie ich do bazy.
 *
 * Wiadomości już zapisane są pomijane na poziomie bazy (unikalny `dedupe_key`),
 * więc ponowna synchronizacja nie tworzy duplikatów nawet przy dwóch równoczesnych
 * kliknięciach. Po zapisie zwracamy pełną, zaktualizowaną historię.
 */
export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  const resolved = await resolveCaseMailContext(request, caseId);
  if (isCaseMailFailure(resolved)) return resolved.response;

  const clientEmail = resolved.caseRow.email?.trim();
  if (!clientEmail || !isEmail(clientEmail)) {
    return NextResponse.json(
      { error: "Zlecenie nie ma adresu e-mail klienta", reason: "no_client_email" },
      { status: 409 }
    );
  }

  try {
    const messages = await fetchConversation(resolved.credentials, clientEmail, { limit: 100, monthsBack: 24 });

    const added = await saveMessages(
      resolved.service,
      {
        organizationId: resolved.organizationId,
        caseId,
        userId: resolved.userId,
        mailboxAddress: resolved.account.email_address
      },
      messages,
      // Klucz wątku musi być stabilny między synchronizacjami, inaczej ta sama rozmowa
      // rozpadłaby się na kilka wątków po zmianie tematu przez klienta.
      (message) => threadKeyOf(message, normalizeSubject(message.subject))
    );

    const stored = await loadStoredThreads(resolved.supabaseUser, caseId);

    return NextResponse.json({
      mailbox: resolved.account.email_address,
      clientEmail,
      added,
      fetched: messages.length,
      threads: stored.threads,
      messageCount: stored.messageCount,
      lastSyncedAt: stored.lastSyncedAt
    });
  } catch (error) {
    const described = describeMailboxError(error);
    return NextResponse.json({ error: described.message, reason: described.code }, { status: 502 });
  }
}
