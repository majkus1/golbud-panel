import { ImapFlow } from "imapflow";
import { hasVisibleContent, sanitizeIncomingHtml, stripQuotedHtml } from "@/lib/mail/html";
import { htmlToPlainText, stripQuotedReply, type MailAddress, type MailAttachmentInfo, type MailMessage } from "@/lib/mail/thread-model";

/**
 * Warstwa dostępu do skrzynki po IMAP. Tylko odczyt — wysyłka idzie przez SMTP
 * (`lib/mail/send.ts`). Nic tu nie wie o zleceniach ani o uprawnieniach; to zadanie tras API.
 */

export type MailboxCredentials = {
  emailAddress: string;
  appPassword: string;
  imapHost: string;
  imapPort: number;
};

export type FetchConversationOptions = {
  /** Ile wiadomości maksymalnie pobrać (od najnowszych). */
  limit?: number;
  /** Jak daleko wstecz szukać. */
  monthsBack?: number;
};

const DEFAULT_LIMIT = 100;
const DEFAULT_MONTHS_BACK = 24;
/** Gmail trzyma wszystko (odebrane i wysłane) w jednym folderze — jedno zapytanie wystarczy. */
const GMAIL_ALL_MAIL = "[Gmail]/All Mail";

export class MailboxError extends Error {
  code: "auth" | "connection" | "unknown";

  constructor(message: string, code: MailboxError["code"]) {
    super(message);
    this.name = "MailboxError";
    this.code = code;
  }
}

/**
 * Surowy błąd IMAP na komunikat, który da się pokazać użytkownikowi.
 *
 * `imapflow` zwraca zwykle lakoniczne „Command failed", a powód siedzi w polach
 * `authenticationFailed`, `serverResponseCode` i `responseText` — bez ich sprawdzenia
 * użytkownik dostałby komunikat, z którego nic nie wynika.
 */
export function describeMailboxError(error: unknown): MailboxError {
  if (error instanceof MailboxError) return error;

  const details = error as {
    message?: string;
    authenticationFailed?: boolean;
    serverResponseCode?: string;
    responseText?: string;
    code?: string;
  };
  const message = [details?.message, details?.serverResponseCode, details?.responseText, details?.code]
    .filter(Boolean)
    .join(" | ") || String(error);

  if (details?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication/i.test(message)) {
    return new MailboxError(
      "Poczta odrzuciła dane logowania. Sprawdź adres i hasło aplikacji — w Gmailu wymaga ono włączonego " +
        "logowania dwuetapowego, a IMAP musi być włączony w ustawieniach skrzynki.",
      "auth"
    );
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|timeout/i.test(message)) {
    return new MailboxError("Nie udało się połączyć z serwerem poczty. Spróbuj ponownie za chwilę.", "connection");
  }
  return new MailboxError(`Błąd skrzynki pocztowej: ${message}`, "unknown");
}

function createClient(credentials: MailboxCredentials): ImapFlow {
  return new ImapFlow({
    host: credentials.imapHost,
    port: credentials.imapPort,
    secure: true,
    auth: { user: credentials.emailAddress, pass: credentials.appPassword },
    logger: false,
    // Bez tego pojedyncza zawieszona operacja potrafi zająć całe okno czasu funkcji serwerowej.
    socketTimeout: 20_000,
    greetingTimeout: 10_000,
    connectionTimeout: 10_000
  });
}

/** Otwiera połączenie, wykonuje operację i zawsze zamyka — także przy błędzie. */
async function withMailbox<T>(
  credentials: MailboxCredentials,
  path: string | null,
  action: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const client = createClient(credentials);
  try {
    await client.connect();
    if (!path) return await action(client);
    const lock = await client.getMailboxLock(path);
    try {
      return await action(client);
    } finally {
      lock.release();
    }
  } catch (error) {
    throw describeMailboxError(error);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Sprawdzenie danych logowania — używane przy zapisie skrzynki w ustawieniach. */
export async function verifyMailbox(credentials: MailboxCredentials): Promise<void> {
  await withMailbox(credentials, null, async (client) => {
    await client.list();
  });
}

/**
 * Folder do przeszukania. Gmail ma „All Mail" z całą korespondencją; przy zwykłym IMAP
 * wracamy do INBOX, bo nie ma jednego folderu z wysłanymi i odebranymi naraz.
 */
async function resolveSearchMailbox(client: ImapFlow): Promise<string> {
  const mailboxes = await client.list();
  const allMail = mailboxes.find((box) => box.specialUse === "\\All");
  return allMail?.path ?? (mailboxes.some((box) => box.path === GMAIL_ALL_MAIL) ? GMAIL_ALL_MAIL : "INBOX");
}

function toAddress(entry: { name?: string; address?: string } | undefined): MailAddress | null {
  if (!entry?.address) return null;
  return { name: entry.name?.trim() || "", address: entry.address.trim() };
}

function toAddresses(entries: { name?: string; address?: string }[] | undefined): MailAddress[] {
  return (entries ?? []).map(toAddress).filter((entry): entry is MailAddress => entry !== null);
}

/** Serwery zwracają datę raz jako `Date`, raz jako tekst — ujednolicamy do ISO. */
function toIsoDate(value: Date | string | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

type BodyNode = {
  part?: string;
  type?: string;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  parameters?: Record<string, string>;
  size?: number;
  childNodes?: BodyNode[];
};

/** Płaska lista części MIME — łatwiej po niej szukać treści i załączników. */
function flattenParts(node: BodyNode | undefined, acc: BodyNode[] = []): BodyNode[] {
  if (!node) return acc;
  acc.push(node);
  for (const child of node.childNodes ?? []) flattenParts(child, acc);
  return acc;
}

/**
 * Obrazek wklejony w treść, który jest realnym zdjęciem, a nie logo ze stopki.
 * Progu wielkości używamy dlatego, że stopki firmowe i piksele śledzące mają
 * kilka kilobajtów, a zdjęcie z budowy zawsze znacznie więcej.
 */
const INLINE_IMAGE_MIN_BYTES = 20 * 1024;

function isRealAttachment(part: BodyNode): boolean {
  if (!part.part) return false;
  if (part.disposition === "attachment") return true;
  const hasName = !!(part.dispositionParameters?.filename || part.parameters?.name);
  return !!part.type?.startsWith("image/") && hasName && (part.size ?? 0) >= INLINE_IMAGE_MIN_BYTES;
}

function collectAttachments(parts: BodyNode[]): MailAttachmentInfo[] {
  return parts.filter(isRealAttachment).map((part) => ({
    partId: part.part as string,
    fileName: part.dispositionParameters?.filename || part.parameters?.name || `zalacznik-${part.part}`,
    mimeType: part.type ?? null,
    size: part.size ?? null
  }));
}

type FetchedHeader = {
  uid: number;
  envelope?: {
    messageId?: string;
    inReplyTo?: string;
    subject?: string;
    date?: Date | string;
    from?: { name?: string; address?: string }[];
    to?: { name?: string; address?: string }[];
    cc?: { name?: string; address?: string }[];
  };
  bodyStructure?: unknown;
  threadId?: string;
  internalDate?: Date | string;
};

/**
 * Zbiera nagłówki i strukturę wiadomości, wyczerpując strumień do końca.
 * Osobna funkcja, żeby nie dało się przypadkiem wpleść innej komendy IMAP w tę pętlę.
 */
async function collectHeaders(client: ImapFlow, uids: number[]): Promise<FetchedHeader[]> {
  const headers: FetchedHeader[] = [];
  for await (const item of client.fetch(
    uids,
    { uid: true, envelope: true, bodyStructure: true, threadId: true, internalDate: true },
    { uid: true }
  )) {
    headers.push(item as unknown as FetchedHeader);
  }
  return headers;
}

async function downloadPart(client: ImapFlow, uid: number, partId: string): Promise<string> {
  const download = await client.download(String(uid), partId, { uid: true });
  const chunks: Buffer[] = [];
  for await (const chunk of download.content) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Treść wiadomości w dwóch wariantach: czysty tekst (zawsze) i sformatowany HTML (gdy jest).
 * HTML wychodzi stąd **już oczyszczony** — surowy nie ma prawa opuścić serwera.
 */
async function readBody(
  client: ImapFlow,
  uid: number,
  parts: BodyNode[]
): Promise<{ text: string; html: string | null }> {
  const isBody = (part: BodyNode, type: string) => part.type === type && part.disposition !== "attachment";
  const plainPart = parts.find((part) => isBody(part, "text/plain"));
  const htmlPart = parts.find((part) => isBody(part, "text/html"));

  try {
    const rawHtml = htmlPart?.part ? await downloadPart(client, uid, htmlPart.part) : null;
    const rawPlain = plainPart?.part ? await downloadPart(client, uid, plainPart.part) : null;

    const text = stripQuotedReply(rawPlain ?? (rawHtml ? htmlToPlainText(rawHtml) : ""));
    if (!rawHtml) return { text, html: null };

    const safeHtml = sanitizeIncomingHtml(stripQuotedHtml(rawHtml));
    return { text, html: hasVisibleContent(safeHtml) ? safeHtml : null };
  } catch {
    // Pojedyncza nieczytelna wiadomość nie może wywrócić całej synchronizacji.
    return { text: "", html: null };
  }
}

/**
 * Pobiera korespondencję z jednym adresem — odebraną i wysłaną.
 * Na Gmailu używa wyszukiwania `X-GM-RAW`, które ogarnia oba kierunki jednym zapytaniem
 * i zwraca identyfikator wątku, dzięki czemu grupowanie po rozmowach jest dokładne.
 */
export async function fetchConversation(
  credentials: MailboxCredentials,
  counterpartEmail: string,
  options: FetchConversationOptions = {}
): Promise<MailMessage[]> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 200);
  const monthsBack = options.monthsBack ?? DEFAULT_MONTHS_BACK;
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);
  const address = counterpartEmail.trim().toLowerCase();

  const client = createClient(credentials);
  try {
    await client.connect();
    const path = await resolveSearchMailbox(client);
    const lock = await client.getMailboxLock(path);

    try {
      const isGmail = path === GMAIL_ALL_MAIL || /gmail/i.test(credentials.imapHost);
      const query = isGmail
        ? { gmraw: `(from:${address} OR to:${address} OR cc:${address}) newer_than:${monthsBack * 30}d` }
        : { or: [{ from: address }, { to: address }, { cc: address }], since };

      const uids = (await client.search(query, { uid: true })) || [];
      if (uids.length === 0) return [];

      // Najnowsze najpierw — starsze i tak przycinamy limitem.
      const selected = uids.slice(-limit);

      // Krok 1: same nagłówki i struktura. Iterator `fetch` trzeba wyczerpać do końca,
      // ZANIM wyślemy kolejną komendę — IMAP obsługuje jedno polecenie naraz, a pobieranie
      // treści w środku tej pętli rozspójnia połączenie („Connection not available").
      const headers = await collectHeaders(client, selected);

      // Krok 2: dopiero teraz treści — każda to osobna komenda na wolnym już połączeniu.
      const messages: MailMessage[] = [];
      for (const item of headers) {
        const parts = flattenParts(item.bodyStructure as BodyNode | undefined);
        const envelope = item.envelope;
        const body = await readBody(client, item.uid, parts);
        messages.push({
          uid: item.uid,
          messageId: envelope?.messageId ?? null,
          threadId: item.threadId ?? null,
          inReplyTo: envelope?.inReplyTo ?? null,
          references: [],
          subject: envelope?.subject ?? "",
          from: toAddress(envelope?.from?.[0]),
          to: toAddresses(envelope?.to),
          cc: toAddresses(envelope?.cc),
          date: toIsoDate(envelope?.date ?? item.internalDate),
          text: body.text,
          html: body.html,
          attachments: collectAttachments(parts)
        });
      }

      return messages;
    } finally {
      lock.release();
    }
  } catch (error) {
    throw describeMailboxError(error);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export type DownloadedAttachment = {
  fileName: string;
  mimeType: string;
  content: Buffer;
};

/** Pobiera pojedynczy załącznik na żądanie — nie trzymamy plików u siebie. */
export async function fetchAttachment(
  credentials: MailboxCredentials,
  uid: number,
  partId: string
): Promise<DownloadedAttachment | null> {
  const client = createClient(credentials);
  try {
    await client.connect();
    const path = await resolveSearchMailbox(client);
    const lock = await client.getMailboxLock(path);
    try {
      const download = await client.download(String(uid), partId, { uid: true });
      if (!download?.content) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of download.content) chunks.push(chunk as Buffer);
      return {
        fileName: download.meta?.filename || `zalacznik-${partId}`,
        mimeType: download.meta?.contentType || "application/octet-stream",
        content: Buffer.concat(chunks)
      };
    } finally {
      lock.release();
    }
  } catch (error) {
    throw describeMailboxError(error);
  } finally {
    await client.logout().catch(() => undefined);
  }
}
