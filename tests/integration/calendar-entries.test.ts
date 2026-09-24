import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDigestCalendarEntries } from "@/lib/digest-calendar-entries";
import { ANON_KEY, SERVICE_KEY, SUPABASE_URL, TEST_PASSWORD, detectStack, requireStack } from "./local-stack";

/**
 * Wpisy w kalendarzu (migracja 20260924170000_calendar_entries): `case_tasks.kind = 'wpis'`.
 *
 *  - każdy członek firmy może dodać wpis i usunąć własny,
 *  - zadań dalej nie usuwa nikt poza właścicielem, biurem i kierownikiem,
 *  - cudzych wpisów handlowiec nie widzi (RLS jak przy zadaniach), a właściciel widzi wszystkie.
 *
 * Wymaga lokalnego Supabase — bez niego blok jest pomijany.
 */

describe("wpisy w kalendarzu", () => {
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const suffix = String(Date.now());
  const ownerEmail = `cal-owner-${suffix}@local.test`;
  const salesEmail = `cal-sales-${suffix}@local.test`;
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let organizationId = "";
  let ownerId = "";
  let salesId = "";
  let owner: SupabaseClient;
  let sales: SupabaseClient;

  async function createUser(email: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`Nie udało się utworzyć użytkownika: ${error?.message}`);
    userIds.push(data.user.id);
    const { data: membership } = await service.from("organization_members").select("organization_id").eq("user_id", data.user.id).maybeSingle();
    if (membership?.organization_id) orgIds.push(membership.organization_id as string);
    return data.user.id;
  }

  async function signIn(email: string): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (error) throw new Error(`Nie udało się zalogować: ${error.message}`);
    return client;
  }

  beforeAll(async () => {
    if (!(await detectStack())) return;
    ownerId = await createUser(ownerEmail);
    salesId = await createUser(salesEmail);
    organizationId = orgIds[0];
    await service.from("organization_members").insert({ organization_id: organizationId, user_id: salesId, role: "sales" });
    owner = await signIn(ownerEmail);
    sales = await signIn(salesEmail);
  });

  afterAll(async () => {
    if (organizationId) await service.from("case_tasks").delete().eq("organization_id", organizationId);
    if (organizationId) await service.from("cases").delete().eq("organization_id", organizationId);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
    for (const id of orgIds) await service.from("organizations").delete().eq("id", id);
  });

  it("nowe zadanie ma domyślnie rodzaj „zadanie”, a rodzaj spoza listy jest odrzucany", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { data, error } = await owner
      .from("case_tasks")
      .insert({ organization_id: organizationId, title: "Zwykłe zadanie", created_by: ownerId })
      .select("kind, due_time")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ kind: "zadanie", due_time: null });

    const bad = await owner.from("case_tasks").insert({ organization_id: organizationId, title: "X", kind: "spotkanie", created_by: ownerId });
    expect(bad.error).not.toBeNull();
  });

  it("handlowiec dodaje i usuwa własny wpis z godziną", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { data: created, error } = await sales
      .from("case_tasks")
      .insert({ organization_id: organizationId, title: "Pomiar", kind: "wpis", due_date: "2026-09-25", due_time: "09:30", priority: "pilne", created_by: salesId })
      .select("id, due_time")
      .single();
    expect(error).toBeNull();
    expect(created?.due_time).toBe("09:30:00");

    // Właściciel widzi wpis handlowca w kalendarzu.
    const { data: seen } = await owner.from("case_tasks").select("id").eq("id", created!.id);
    expect(seen).toHaveLength(1);

    const del = await sales.from("case_tasks").delete({ count: "exact" }).eq("id", created!.id);
    expect(del.error).toBeNull();
    expect(del.count).toBe(1);
  });

  it("handlowiec nie usunie zadania ani nie zobaczy cudzego wpisu", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { data: task } = await sales
      .from("case_tasks")
      .insert({ organization_id: organizationId, title: "Moje zadanie", kind: "zadanie", created_by: salesId })
      .select("id")
      .single();
    const del = await sales.from("case_tasks").delete({ count: "exact" }).eq("id", task!.id);
    expect(del.count).toBe(0);

    const { data: ownerEntry } = await owner
      .from("case_tasks")
      .insert({ organization_id: organizationId, title: "Spotkanie zarządu", kind: "wpis", due_date: "2026-09-26", created_by: ownerId })
      .select("id")
      .single();
    const { data: hidden } = await sales.from("case_tasks").select("id").eq("id", ownerEntry!.id);
    expect(hidden).toEqual([]);
    const delForeign = await sales.from("case_tasks").delete({ count: "exact" }).eq("id", ownerEntry!.id);
    expect(delForeign.count).toBe(0);
  });

  it("poranne podsumowanie bierze wpisy z danego dnia, bez zadań i bez spraw z kosza", async (ctx) => {
    if (!requireStack(ctx)) return;
    const day = "2031-03-14";
    const insertCase = async (name: string) => {
      const { data } = await service
        .from("cases")
        .insert({ organization_id: organizationId, created_by: ownerId, client_name: name, location: "Ożarów", work_description: "Test", status: "nowe zapytanie", source: "telefon" })
        .select("id")
        .single();
      return data!.id as string;
    };
    const liveCase = await insertCase("Klient aktywny");
    const trashedCase = await insertCase("Klient w koszu");
    // Ten sam zestaw pól w każdym wierszu — przy wstawianiu wielu wierszy brakujące pola trafiają jako NULL.
    const row = (title: string, over: Record<string, unknown>) => ({
      organization_id: organizationId,
      title,
      kind: "wpis",
      due_date: day,
      due_time: null,
      priority: "normalny",
      status: "do zrobienia",
      case_id: null,
      created_by: ownerId,
      ...over
    });
    const inserted = await service.from("case_tasks").insert([
      row("Bez sprawy", { created_by: salesId }),
      row("Pomiar", { due_time: "08:15", priority: "pilne", case_id: liveCase }),
      row("Wpis sprawy z kosza", { case_id: trashedCase }),
      row("Zadanie", { kind: "zadanie" }),
      row("Wykonany", { status: "zrobione" })
    ]);
    expect(inserted.error).toBeNull();
    await owner.rpc("trash_case", { p_case_id: trashedCase });

    const { entries, error } = await loadDigestCalendarEntries(service, day);
    expect(error).toBeNull();
    const mine = entries.filter((e) => e.organization_id === organizationId);
    expect(mine.map((e) => e.title)).toEqual(["Pomiar", "Bez sprawy"]);
    expect(mine[0]).toMatchObject({ due_time: "08:15", priority: "pilne", client_name: "Klient aktywny — Ożarów", created_by: ownerId });
    expect(mine[1]).toMatchObject({ due_time: null, client_name: null, created_by: salesId });
  });
});
