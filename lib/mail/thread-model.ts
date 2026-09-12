/**
 * Model korespondencji — czyste funkcje, bez połączenia z pocztą.
 *
 * Wydzielone celowo: grupowanie w wątki, kierunek wiadomości i sortowanie da się
 * sprawdzić bez skrzynki pocztowej, a wymiana Gmaila na innego dostawcę nie dotyka
 * ani tej warstwy, ani interfejsu.
 */

export type MailAddress = {
  name: string;
  address: string;
};

export type MailAttachmentInfo = {
  /** Identyfikator części MIME — potrzebny do pobrania załącznika na żądanie. */
  partId: string;
  fileName: string;
  mimeType: string | null;
  size: number | null;
};

export type MailMessage = {
  /** UID w skrzynce — stabilny w obrębie folderu, używany przy pobieraniu treści. */
  uid: number;
  messageId: string | null;
  /** Identyfikator wątku Gmaila (X-GM-THRID); brak dla serwerów bez tego rozszerzenia. */
  threadId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  date: string;
  /** Treść w czystym tekście — zawsze obecna, także gdy wiadomość była w HTML. */
  text: string;
  /** Treść z zachowanym formatowaniem, **już oczyszczona na serwerze**; null, gdy brak. */
  html: string | null;
  attachments: MailAttachmentInfo[];
};

export type MailDirection = "incoming" | "outgoing";

export type MailThreadMessage = MailMessage & {
  direction: MailDirection;
};

export type MailThread = {
  id: string;
  subject: string;
  messages: MailThreadMessage[];
  messageCount: number;
  lastMessageAt: string;
  participants: string[];
};

export type ThreadOrder = "newest" | "oldest";

/** „Re: Fwd: Odp: Oferta" → „oferta". Do sklejania wątków, gdy brakuje identyfikatora Gmaila. */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|odp|fwd|fw|pd)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pl-PL");
}

function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Kierunek wiadomości względem właściciela skrzynki.
 * Nadawca „nasz" oznacza wiadomość wychodzącą — reszta to poczta od klienta.
 */
export function markDirection(message: MailMessage, mailboxAddress: string): MailDirection {
  return sameAddress(message.from?.address, mailboxAddress) ? "outgoing" : "incoming";
}

/** Klucz wątku: najpierw identyfikator Gmaila, potem znormalizowany temat, na końcu sama wiadomość. */
function threadKey(message: MailMessage): string {
  if (message.threadId) return `gm:${message.threadId}`;
  const normalized = normalizeSubject(message.subject);
  if (normalized) return `subject:${normalized}`;
  return `uid:${message.uid}`;
}

function collectParticipants(messages: MailThreadMessage[], mailboxAddress: string): string[] {
  const seen = new Map<string, string>();
  for (const message of messages) {
    const people = [message.from, ...message.to, ...message.cc].filter(Boolean) as MailAddress[];
    for (const person of people) {
      const key = person.address.trim().toLowerCase();
      if (!key || sameAddress(key, mailboxAddress) || seen.has(key)) continue;
      seen.set(key, person.name?.trim() || person.address);
    }
  }
  return Array.from(seen.values());
}

/**
 * Grupuje wiadomości w wątki. Wewnątrz wątku kolejność jest zawsze chronologiczna
 * (rozmowa czyta się od góry), niezależnie od sortowania listy wątków.
 */
export function groupIntoThreads(messages: MailMessage[], mailboxAddress: string): MailThread[] {
  const buckets = new Map<string, MailThreadMessage[]>();

  for (const message of messages) {
    const key = threadKey(message);
    const withDirection: MailThreadMessage = { ...message, direction: markDirection(message, mailboxAddress) };
    const bucket = buckets.get(key);
    if (bucket) bucket.push(withDirection);
    else buckets.set(key, [withDirection]);
  }

  return Array.from(buckets.entries()).map(([id, bucketMessages]) => {
    const ordered = [...bucketMessages].sort((a, b) => a.date.localeCompare(b.date));
    const subject = ordered.find((m) => m.subject.trim())?.subject.trim() || "(bez tematu)";
    return {
      id,
      subject,
      messages: ordered,
      messageCount: ordered.length,
      lastMessageAt: ordered[ordered.length - 1]?.date ?? "",
      participants: collectParticipants(ordered, mailboxAddress)
    };
  });
}

export function sortThreads(threads: MailThread[], order: ThreadOrder): MailThread[] {
  const sorted = [...threads].sort((a, b) => a.lastMessageAt.localeCompare(b.lastMessageAt));
  return order === "newest" ? sorted.reverse() : sorted;
}

/**
 * HTML wiadomości na czytelny tekst. Wyświetlamy korespondencję jako tekst,
 * bo obcy HTML w panelu to zbędne ryzyko (skrypty, wycieki przez zdalne obrazki).
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Odcina zacytowaną historię pod odpowiedzią — w wątku i tak jest widoczna wyżej.
 *
 * Nagłówek cytatu bywa zawinięty na kilka linii (Gmail wstawia adres w nawiasach ostrych),
 * a po polsku zaczyna się od skrótu dnia tygodnia: „sob., 8 sie 2026 o 23:06 Jan napisał(a):".
 * Dlatego szukamy końcówki nagłówka, a potem cofamy się do początku jego akapitu.
 */
export function stripQuotedReply(input: string): string {
  // Poczta chodzi z zakończeniami CRLF — bez normalizacji wykrywanie akapitu (`\n\n`)
  // nigdy nie trafia i cytat urywa się w przypadkowym miejscu.
  const text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const markers = [
    /napisał\(a\):/i,
    /napisała:/i,
    /\bwrote:/i,
    /^\s*>/m,
    /^\s*-{2,}\s*Original Message\s*-{2,}/im,
    /^\s*_{5,}\s*$/m
  ];

  let cut = text.length;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (!match) continue;

    // Cofnij się do początku akapitu z nagłówkiem cytatu (pusta linia albo początek tekstu),
    // inaczej w treści zostałby ogon w rodzaju „sob., 8 sie 2026 o 23:06 Jan".
    const paragraphStart = text.lastIndexOf("\n\n", match.index);
    const lineStart = text.lastIndexOf("\n", match.index);
    const start = paragraphStart >= 0 ? paragraphStart : lineStart >= 0 ? lineStart : match.index;
    if (start < cut) cut = start;
  }

  const trimmed = text.slice(0, cut).trim();
  return trimmed || text.trim();
}

/** Temat odpowiedzi — bez mnożenia „Re: Re: Re:". */
export function replySubject(subject: string): string {
  const clean = subject.trim();
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean || "(bez tematu)"}`;
}

/**
 * Nagłówki wiążące odpowiedź z wątkiem. Bez nich Gmail pokaże ją jako osobną rozmowę.
 * Lista `References` jest przycinana, bo bardzo długie wątki potrafią przekroczyć limity serwerów.
 */
export function buildReplyHeaders(thread: MailThread): { inReplyTo?: string; references?: string[] } {
  const last = [...thread.messages].reverse().find((message) => message.messageId);
  if (!last?.messageId) return {};
  const chain = [...(last.references ?? []), last.messageId].filter(Boolean);
  return { inReplyTo: last.messageId, references: chain.slice(-20) };
}
