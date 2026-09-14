import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultNotificationPrefsForRole, mergeNotificationPrefs } from "@/lib/notification-prefs";
import type { MemberRole } from "@/lib/types";

/**
 * Regresja: włączenie push nie może wyłączać maili o nowych zapytaniach.
 *
 * Funkcja `set_own_push_enabled` zakładała wiersz ustawień z surowymi wartościami
 * domyślnymi tabeli (`notify_new_case = false`), a nie z domyślnymi dla roli. Trzy osoby
 * w GolBudzie straciły przez to powiadomienia w dniu, w którym włączyły push.
 *
 * Wymaga lokalnego Supabase — bez niego blok jest pomijany.
 */

const SUPABASE_URL = process.env.SUPABASE_TEST_URL ?? "http://127.0.0.1:54321";
// Klucze demo lokalnego Supabase — identyczne na każdej instalacji, nie są tajne.
const ANON_KEY =
  process.env.SUPABASE_TEST_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_KEY =
  process.env.SUPABASE_TEST_SERVICE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const PASSWORD = "test-haslo-1234";

async function stackIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: ANON_KEY } });
    return res.ok;
  } catch {
    return false;
  }
}

let available = false;

function requireStack(ctx: { skip: () => void }): boolean {
  if (!available) {
    ctx.skip();
    return false;
  }
  return true;
}

describe("włączenie push a zgody na maile", () => {
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const suffix = String(Date.now());
  const ownerEmail = `push-test-owner-${suffix}@local.test`;
  const salesEmail = `push-test-sales-${suffix}@local.test`;
  const fieldEmail = `push-test-field-${suffix}@local.test`;

  let organizationId = "";
  const userIds: string[] = [];
  const clients: Partial<Record<MemberRole, SupabaseClient>> = {};

  async function createUser(email: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`Nie udało się utworzyć użytkownika: ${error?.message}`);
    userIds.push(data.user.id);
    return data.user.id;
  }

  async function signIn(email: string): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`Nie udało się zalogować: ${error.message}`);
    return client;
  }

  beforeAll(async () => {
    available = await stackIsUp();
    if (!available) return;

    const ownerId = await createUser(ownerEmail);
    const salesId = await createUser(salesEmail);
    const fieldId = await createUser(fieldEmail);

    const { data: membership } = await service
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", ownerId)
      .single();
    organizationId = membership?.organization_id as string;

    await service.from("organization_members").insert([
      { organization_id: organizationId, user_id: salesId, role: "sales" },
      { organization_id: organizationId, user_id: fieldId, role: "brygadzista" }
    ]);

    clients.owner = await signIn(ownerEmail);
    clients.sales = await signIn(salesEmail);
    clients.brygadzista = await signIn(fieldEmail);
  });

  afterAll(async () => {
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  async function enablePushAndReadPrefs(role: MemberRole) {
    const client = clients[role];
    if (!client) throw new Error(`brak klienta dla roli ${role}`);
    const { error } = await client.rpc("set_own_push_enabled", { p_organization_id: organizationId, p_enabled: true });
    expect(error).toBeNull();
    const {
      data: { user }
    } = await client.auth.getUser();
    const { data: row } = await service
      .from("digest_email_prefs")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("user_id", user?.id ?? "")
      .single();
    return row;
  }

  it("właściciel po włączeniu push nadal dostaje maile o nowych zapytaniach", async (ctx) => {
    if (!requireStack(ctx)) return;
    const row = await enablePushAndReadPrefs("owner");
    expect(row?.push_enabled).toBe(true);
    // Sedno regresji — przed poprawką tu było `false`.
    expect(row?.notify_new_case).toBe(true);
    expect(row?.notify_financial_alerts).toBe(true);
  });

  it("nowy wiersz odpowiada dokładnie domyślnym ustawieniom roli z aplikacji", async (ctx) => {
    if (!requireStack(ctx)) return;
    for (const role of ["owner", "sales", "brygadzista"] as const) {
      const row = await enablePushAndReadPrefs(role);
      const expected = { ...defaultNotificationPrefsForRole(role), push_enabled: true };
      // `mergeNotificationPrefs` na wierszu z bazy musi dać to samo, co domyślne dla roli.
      // Gdyby SQL i TypeScript się rozjechały, ten test to pokaże.
      expect(mergeNotificationPrefs(role, row)).toEqual(expected);
    }
  });

  it("ponowne przełączenie push nie nadpisuje zgód na maile", async (ctx) => {
    if (!requireStack(ctx)) return;
    const client = clients.owner!;
    const {
      data: { user }
    } = await client.auth.getUser();
    // Użytkownik świadomie wyłącza maile o zapytaniach…
    await service
      .from("digest_email_prefs")
      .update({ notify_new_case: false })
      .eq("organization_id", organizationId)
      .eq("user_id", user?.id ?? "");
    // …a potem wyłącza i włącza push. Jego decyzja ma zostać.
    await client.rpc("set_own_push_enabled", { p_organization_id: organizationId, p_enabled: false });
    await client.rpc("set_own_push_enabled", { p_organization_id: organizationId, p_enabled: true });
    const { data: row } = await service
      .from("digest_email_prefs")
      .select("notify_new_case, push_enabled")
      .eq("organization_id", organizationId)
      .eq("user_id", user?.id ?? "")
      .single();
    expect(row?.notify_new_case).toBe(false);
    expect(row?.push_enabled).toBe(true);
  });
});
