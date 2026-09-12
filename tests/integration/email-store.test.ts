import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadStoredThreads, saveMessages, threadKeyOf } from "@/lib/mail/store";
import { normalizeSubject, type MailMessage } from "@/lib/mail/thread-model";

/**
 * Zapis historii korespondencji — najważniejsza gwarancja modułu:
 * **powtórna synchronizacja nie może duplikować wiadomości**.
 *
 * Testy nie ruszają prawdziwej skrzynki — podstawiają gotowe wiadomości, dzięki czemu
 * sprawdzają samą logikę zapisu i uprawnienia, a nie połączenie z Gmailem.
 * Wymagają lokalnego Supabase; bez niego same się pomijają.
 */

const SUPABASE_URL = process.env.SUPABASE_TEST_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.SUPABASE_TEST_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_KEY =
  process.env.SUPABASE_TEST_SERVICE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const PASSWORD = "test-haslo-1234";
const MAILBOX = "skrzynka@golbud.pl";
const CLIENT = "klient@example.com";

async function stackIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: ANON_KEY } });
    return res.ok;
  } catch {
    return false;
  }
}

let available = false;
type SkippableContext = { skip: () => void };
function requireStack(ctx: SkippableContext): boolean {
  if (!available) {
    ctx.skip();
    return false;
  }
  return true;
}

function message(overrides: Partial<MailMessage> & { uid: number }): MailMessage {
  return {
    messageId: `<msg-${overrides.uid}@test>`,
    threadId: null,
    inReplyTo: null,
    references: [],
    subject: "Oferta elewacja",
    from: { name: "Klient", address: CLIENT },
    to: [{ name: "GolBud", address: MAILBOX }],
    cc: [],
    date: "2026-08-01T10:00:00.000Z",
    text: "treść wiadomości",
    html: null,
    attachments: [],
    ...overrides
  };
}

const threadKey = (m: MailMessage) => threadKeyOf(m, normalizeSubject(m.subject));

describe("zapis historii korespondencji", () => {
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const suffix = String(Date.now());
  const ownerEmail = `store-owner-${suffix}@local.test`;
  const otherEmail = `store-other-${suffix}@local.test`;

  let organizationId = "";
  let ownerId = "";
  let otherId = "";
  let caseId = "";
  let ownerClient: SupabaseClient;
  let otherClient: SupabaseClient;

  async function createUser(email: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`Nie udało się utworzyć użytkownika: ${error?.message}`);
    return data.user.id;
  }

  async function signIn(email: string): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`Nie udało się zalogować: ${error.message}`);
    return client;
  }

  function saveParams() {
    return { organizationId, caseId, userId: ownerId, mailboxAddress: MAILBOX };
  }

  beforeAll(async () => {
    available = await stackIsUp();
    if (!available) return;

    ownerId = await createUser(ownerEmail);
    otherId = await createUser(otherEmail);

    const { data: membership } = await service
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", ownerId)
      .single();
    organizationId = membership?.organization_id as string;

    await service.from("organization_members").insert({
      organization_id: organizationId,
      user_id: otherId,
      role: "owner"
    });

    const { data: caseRow } = await service
      .from("cases")
      .insert({
        organization_id: organizationId,
        created_by: ownerId,
        client_name: "Klient testowy",
        email: CLIENT,
        work_description: "Test zapisu korespondencji",
        status: "nowe zapytanie",
        source: "mail"
      })
      .select("id")
      .single();
    caseId = caseRow?.id as string;

    ownerClient = await signIn(ownerEmail);
    otherClient = await signIn(otherEmail);
  });

  afterAll(async () => {
    if (caseId) await service.from("cases").delete().eq("id", caseId);
    if (ownerId) await service.auth.admin.deleteUser(ownerId);
    if (otherId) await service.auth.admin.deleteUser(otherId);
  });

  it("zapisuje wiadomości i buduje z nich wątki", async (ctx) => {
    if (!requireStack(ctx)) return;

    const added = await saveMessages(
      service,
      saveParams(),
      [
        message({ uid: 1, threadId: "t1", date: "2026-08-01T10:00:00.000Z" }),
        message({ uid: 2, threadId: "t1", date: "2026-08-02T10:00:00.000Z", from: { name: "My", address: MAILBOX } }),
        message({ uid: 3, subject: "Faktura", date: "2026-08-03T10:00:00.000Z" })
      ],
      threadKey
    );
    expect(added).toBe(3);

    const stored = await loadStoredThreads(ownerClient, caseId);
    expect(stored.messageCount).toBe(3);
    expect(stored.threads).toHaveLength(2);

    const rozmowa = stored.threads.find((t) => t.messageCount === 2);
    expect(rozmowa?.messages.map((m) => m.direction)).toEqual(["incoming", "outgoing"]);
  });

  /** Sedno funkcji: klikanie „Synchronizuj" wiele razy nie może mnożyć wiadomości. */
  it("powtórna synchronizacja tych samych wiadomości niczego nie duplikuje", async (ctx) => {
    if (!requireStack(ctx)) return;

    const paczka = [
      message({ uid: 1, threadId: "t1", date: "2026-08-01T10:00:00.000Z" }),
      message({ uid: 2, threadId: "t1", date: "2026-08-02T10:00:00.000Z" }),
      message({ uid: 3, subject: "Faktura", date: "2026-08-03T10:00:00.000Z" })
    ];

    const added = await saveMessages(service, saveParams(), paczka, threadKey);
    expect(added).toBe(0);

    const stored = await loadStoredThreads(ownerClient, caseId);
    expect(stored.messageCount).toBe(3);
  });

  it("dopisuje tylko nowe wiadomości z kolejnej synchronizacji", async (ctx) => {
    if (!requireStack(ctx)) return;

    const added = await saveMessages(
      service,
      saveParams(),
      [
        message({ uid: 1, threadId: "t1" }), // znana
        message({ uid: 9, threadId: "t1", date: "2026-08-09T10:00:00.000Z" }) // nowa
      ],
      threadKey
    );
    expect(added).toBe(1);

    const stored = await loadStoredThreads(ownerClient, caseId);
    expect(stored.messageCount).toBe(4);
  });

  it("radzi sobie z wiadomością bez nagłówka Message-ID", async (ctx) => {
    if (!requireStack(ctx)) return;

    const bezId = [message({ uid: 77, messageId: null, subject: "Bez identyfikatora" })];
    expect(await saveMessages(service, saveParams(), bezId, threadKey)).toBe(1);
    // Druga próba tej samej wiadomości — deduplikacja po UID.
    expect(await saveMessages(service, saveParams(), bezId, threadKey)).toBe(0);
  });

  it("nie pokazuje cudzej korespondencji nawet innemu właścicielowi firmy", async (ctx) => {
    if (!requireStack(ctx)) return;

    const cudze = await loadStoredThreads(otherClient, caseId);
    expect(cudze.messageCount).toBe(0);
    expect(cudze.threads).toHaveLength(0);
  });

  it("nie pozwala dopisać wiadomości bezpośrednio z przeglądarki", async (ctx) => {
    if (!requireStack(ctx)) return;

    const { error } = await ownerClient.from("case_email_messages").insert({
      organization_id: organizationId,
      case_id: caseId,
      user_id: ownerId,
      mailbox_address: MAILBOX,
      dedupe_key: "podrobiona",
      mailbox_uid: 999,
      thread_key: "subject:podrobka",
      thread_subject: "Podróbka",
      direction: "incoming",
      sent_at: new Date().toISOString()
    });
    expect(error).not.toBeNull();
  });

  it("usunięcie zlecenia kasuje jego korespondencję", async (ctx) => {
    if (!requireStack(ctx)) return;

    const { data: przed } = await service
      .from("case_email_messages")
      .select("id", { count: "exact", head: false })
      .eq("case_id", caseId);
    expect((przed ?? []).length).toBeGreaterThan(0);

    await service.from("cases").delete().eq("id", caseId);

    const { data: po } = await service.from("case_email_messages").select("id").eq("case_id", caseId);
    expect(po ?? []).toHaveLength(0);
    caseId = "";
  });
});
