import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANON_KEY, SERVICE_KEY, SUPABASE_URL, TEST_PASSWORD, detectStack, requireStack } from "./local-stack";

/**
 * Kosz spraw i nowe pola karty klienta (migracja 20260924120000_cases_extensions).
 *
 * Najważniejsze gwarancje:
 *  - widok `case_records` po odtworzeniu dalej respektuje RLS (inna firma nic nie widzi),
 *  - sprawa w koszu znika z widoku, ale da się ją przywrócić,
 *  - handlowiec, który może edytować swoją sprawę, nie przeniesie jej sam do kosza.
 *
 * Wymaga lokalnego Supabase — bez niego blok jest pomijany.
 */

describe("kosz spraw", () => {
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const suffix = String(Date.now());
  const ownerEmail = `trash-owner-${suffix}@local.test`;
  const salesEmail = `trash-sales-${suffix}@local.test`;
  const strangerEmail = `trash-stranger-${suffix}@local.test`;

  const userIds: string[] = [];
  const orgIds: string[] = [];
  let organizationId = "";
  let ownerId = "";
  let salesId = "";
  let caseId = "";
  let salesCaseId = "";
  let owner: SupabaseClient;
  let sales: SupabaseClient;
  let stranger: SupabaseClient;

  async function createUser(email: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`Nie udało się utworzyć użytkownika: ${error?.message}`);
    userIds.push(data.user.id);
    const { data: membership } = await service
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (membership?.organization_id) orgIds.push(membership.organization_id as string);
    return data.user.id;
  }

  async function signIn(email: string): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (error) throw new Error(`Nie udało się zalogować: ${error.message}`);
    return client;
  }

  async function insertCase(createdBy: string, clientName: string): Promise<string> {
    const { data, error } = await service
      .from("cases")
      .insert({
        organization_id: organizationId,
        created_by: createdBy,
        client_name: clientName,
        work_description: "Test kosza",
        status: "nowe zapytanie",
        source: "telefon"
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Nie udało się dodać sprawy: ${error?.message}`);
    return data.id as string;
  }

  beforeAll(async () => {
    if (!(await detectStack())) return;

    ownerId = await createUser(ownerEmail);
    salesId = await createUser(salesEmail);
    await createUser(strangerEmail);
    organizationId = orgIds[0];

    await service.from("organization_members").insert({ organization_id: organizationId, user_id: salesId, role: "sales" });

    caseId = await insertCase(ownerId, "Klient do kosza");
    salesCaseId = await insertCase(salesId, "Klient handlowca");

    owner = await signIn(ownerEmail);
    sales = await signIn(salesEmail);
    stranger = await signIn(strangerEmail);
  });

  afterAll(async () => {
    for (const id of [caseId, salesCaseId]) if (id) await service.from("cases").delete().eq("id", id);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
    for (const id of orgIds) await service.from("organizations").delete().eq("id", id);
  });

  it("widok case_records po odtworzeniu nie pokazuje spraw innej firmy", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { data: mine } = await owner.from("case_records").select("id").eq("id", caseId);
    expect(mine).toHaveLength(1);
    const { data: foreign, error } = await stranger.from("case_records").select("id").eq("organization_id", organizationId);
    expect(error).toBeNull();
    expect(foreign).toEqual([]);
  });

  it("nowe pola klienta i planowanego rozpoczęcia zapisują się i są w widoku", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { error } = await owner
      .from("cases")
      .update({ planned_start_date: "2026-10-05", client_tax_id: "85010112345", client_address: "ul. Polna 1, 05-850 Ożarów" })
      .eq("id", caseId);
    expect(error).toBeNull();
    const { data } = await owner.from("case_records").select("planned_start_date, client_tax_id, client_address").eq("id", caseId).single();
    expect(data).toEqual({ planned_start_date: "2026-10-05", client_tax_id: "85010112345", client_address: "ul. Polna 1, 05-850 Ożarów" });
  });

  it("sprawa w koszu znika z widoku, jest w koszu i wraca po przywróceniu", async (ctx) => {
    if (!requireStack(ctx)) return;

    const trash = await owner.rpc("trash_case", { p_case_id: caseId });
    expect(trash.error).toBeNull();

    const { data: visible } = await owner.from("case_records").select("id").eq("id", caseId);
    expect(visible).toEqual([]);

    const { data: trashed, error: listError } = await owner.rpc("list_trashed_cases", { p_organization_id: organizationId });
    expect(listError).toBeNull();
    const row = (trashed as { id: string; deleted_by: string }[]).find((r) => r.id === caseId);
    expect(row?.deleted_by).toBe(ownerId);

    const restore = await owner.rpc("restore_case", { p_case_id: caseId });
    expect(restore.error).toBeNull();
    const { data: back } = await owner.from("case_records").select("id").eq("id", caseId);
    expect(back).toHaveLength(1);

    const { data: log } = await service
      .from("organization_activity_log")
      .select("action")
      .eq("entity_id", caseId)
      .in("action", ["trashed", "restored"]);
    expect((log || []).map((l) => l.action).sort()).toEqual(["restored", "trashed"]);
  });

  it("handlowiec nie przeniesie do kosza nawet własnej sprawy", async (ctx) => {
    if (!requireStack(ctx)) return;

    // Handlowiec może edytować swoją sprawę…
    const edit = await sales.from("cases").update({ location: "Warszawa" }).eq("id", salesCaseId).select("id");
    expect(edit.error).toBeNull();
    expect(edit.data).toHaveLength(1);

    // …ale nie ustawi kosza bezpośrednio…
    const direct = await sales.from("cases").update({ deleted_at: new Date().toISOString() }).eq("id", salesCaseId);
    expect(direct.error?.message).toMatch(/kosza/);

    // …ani przez funkcję, ani nie zajrzy do kosza.
    const rpc = await sales.rpc("trash_case", { p_case_id: salesCaseId });
    expect(rpc.error?.message).toMatch(/kosza/);
    const list = await sales.rpc("list_trashed_cases", { p_organization_id: organizationId });
    expect(list.error).not.toBeNull();

    const { data } = await service.from("cases").select("deleted_at").eq("id", salesCaseId).single();
    expect(data?.deleted_at).toBeNull();
  });

  it("osoba z innej firmy nie przeniesie cudzej sprawy do kosza", async (ctx) => {
    if (!requireStack(ctx)) return;
    const rpc = await stranger.rpc("trash_case", { p_case_id: caseId });
    expect(rpc.error).not.toBeNull();
    const { data } = await service.from("cases").select("deleted_at").eq("id", caseId).single();
    expect(data?.deleted_at).toBeNull();
  });
});
