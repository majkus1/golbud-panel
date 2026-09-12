import type { SupabaseClient } from "@supabase/supabase-js";
import type { createSupabaseServiceClient } from "@/lib/supabase-service";
import { markDirection, type MailMessage, type MailThread, type MailThreadMessage } from "@/lib/mail/thread-model";

/**
 * Zapis i odczyt historii korespondencji w bazie.
 *
 * Synchronizacja dopisuje wyłącznie nowe wiadomości — powtórne pobranie tego samego
 * okresu nie tworzy duplikatów, bo o unikalności decyduje `dedupe_key` (Message-ID,
 * a przy jego braku UID skrzynki) w obrębie pary użytkownik + zlecenie.
 *
 * Zapis idzie kluczem serwerowym, odczyt klientem użytkownika — czyli przez RLS,
 * które przepuszcza wyłącznie własne wiadomości.
 */

type Service = ReturnType<typeof createSupabaseServiceClient>;

const STORED_COLUMNS =
  "mailbox_uid, message_id, dedupe_key, thread_key, thread_subject, subject, direction, " +
  "from_name, from_address, to_addresses, cc_addresses, sent_at, body_text, body_html, attachments";

type StoredRow = {
  mailbox_uid: number;
  message_id: string | null;
  dedupe_key: string;
  thread_key: string;
  thread_subject: string;
  subject: string;
  direction: "incoming" | "outgoing";
  from_name: string | null;
  from_address: string | null;
  to_addresses: { name: string; address: string }[];
  cc_addresses: { name: string; address: string }[];
  sent_at: string;
  body_text: string;
  body_html: string | null;
  attachments: MailMessage["attachments"];
};

/** Ten sam klucz, którego używa unikalny indeks w bazie. */
function dedupeKey(message: MailMessage): string {
  return message.messageId?.trim() || `uid:${message.uid}`;
}

/** Klucz wątku spójny z `groupIntoThreads` — identyfikator Gmaila, a w zastępstwie temat. */
function threadKeyOf(message: MailMessage, fallbackSubject: string): string {
  return message.threadId ? `gm:${message.threadId}` : `subject:${fallbackSubject}`;
}

export type SaveMessagesParams = {
  organizationId: string;
  caseId: string;
  userId: string;
  mailboxAddress: string;
};

/**
 * Dopisuje nowe wiadomości. Zwraca, ile faktycznie doszło — dzięki `ignoreDuplicates`
 * powtórki są pomijane po stronie bazy, bez wyścigów przy równoczesnych synchronizacjach.
 */
export async function saveMessages(
  service: Service,
  params: SaveMessagesParams,
  messages: MailMessage[],
  threadKeyBySubject: (message: MailMessage) => string
): Promise<number> {
  if (messages.length === 0) return 0;

  const rows = messages.map((message) => ({
    organization_id: params.organizationId,
    case_id: params.caseId,
    user_id: params.userId,
    mailbox_address: params.mailboxAddress,
    message_id: message.messageId,
    dedupe_key: dedupeKey(message),
    mailbox_uid: message.uid,
    thread_key: threadKeyBySubject(message),
    thread_subject: message.subject || "(bez tematu)",
    subject: message.subject,
    direction: markDirection(message, params.mailboxAddress),
    from_name: message.from?.name || null,
    from_address: message.from?.address || null,
    to_addresses: message.to,
    cc_addresses: message.cc,
    sent_at: message.date,
    body_text: message.text,
    body_html: message.html,
    attachments: message.attachments
  }));

  const { data, error } = await service
    .from("case_email_messages")
    .upsert(rows, { onConflict: "user_id,case_id,dedupe_key", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(`Nie udało się zapisać wiadomości: ${error.message}`);
  return data?.length ?? 0;
}

export { threadKeyOf };

/** Buduje wątki z zapisanych wierszy — ten sam kształt, który zwracało pobieranie na żywo. */
function rowsToThreads(rows: StoredRow[]): MailThread[] {
  const buckets = new Map<string, MailThreadMessage[]>();

  for (const row of rows) {
    const message: MailThreadMessage = {
      uid: row.mailbox_uid,
      messageId: row.message_id,
      threadId: null,
      inReplyTo: null,
      references: [],
      subject: row.subject,
      from: row.from_address ? { name: row.from_name || "", address: row.from_address } : null,
      to: row.to_addresses ?? [],
      cc: row.cc_addresses ?? [],
      date: row.sent_at,
      text: row.body_text,
      html: row.body_html,
      attachments: row.attachments ?? [],
      direction: row.direction
    };
    const bucket = buckets.get(row.thread_key);
    if (bucket) bucket.push(message);
    else buckets.set(row.thread_key, [message]);
  }

  return Array.from(buckets.entries()).map(([id, messages]) => {
    const ordered = [...messages].sort((a, b) => a.date.localeCompare(b.date));
    const subject = ordered.find((m) => m.subject.trim())?.subject.trim() || "(bez tematu)";
    const participants = new Map<string, string>();
    for (const message of ordered) {
      if (message.direction !== "incoming" || !message.from?.address) continue;
      participants.set(message.from.address.toLowerCase(), message.from.name || message.from.address);
    }
    return {
      id,
      subject,
      messages: ordered,
      messageCount: ordered.length,
      lastMessageAt: ordered[ordered.length - 1]?.date ?? "",
      participants: Array.from(participants.values())
    };
  });
}

/**
 * Odczyt zapisanej historii. Używa klienta z sesją użytkownika, więc RLS sam odetnie
 * cudze wiadomości — ta funkcja nie musi (i nie powinna) niczego autoryzować samodzielnie.
 */
export async function loadStoredThreads(
  supabase: SupabaseClient,
  caseId: string
): Promise<{ threads: MailThread[]; messageCount: number; lastSyncedAt: string | null }> {
  const { data, error } = await supabase
    .from("case_email_messages")
    .select(`${STORED_COLUMNS}, created_at`)
    .eq("case_id", caseId)
    .order("sent_at", { ascending: true });

  if (error) throw new Error(`Nie udało się wczytać historii: ${error.message}`);

  const rows = (data ?? []) as (StoredRow & { created_at: string })[];
  const lastSyncedAt = rows.reduce<string | null>(
    (latest, row) => (!latest || row.created_at > latest ? row.created_at : latest),
    null
  );

  return { threads: rowsToThreads(rows), messageCount: rows.length, lastSyncedAt };
}
