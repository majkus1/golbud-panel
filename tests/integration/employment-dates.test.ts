import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANON_KEY, SERVICE_KEY, SUPABASE_URL, TEST_PASSWORD, detectStack, requireStack } from "./local-stack";

/**
 * Daty zatrudnienia (migracja 20260924190000_employee_employment_dates).
 * Kalendarz czyta koniec umowy przez `employee_hr_profiles_visible`: właściciel i sam
 * pracownik go widzą, brygadzista (który widzi terminy BHP swojej brygady) — nie.
 */
describe("daty zatrudnienia w kalendarzu", () => {
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const suffix = String(Date.now());
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let organizationId = "";
  let workerProfileId = "";
  let owner: SupabaseClient;
  let foreman: SupabaseClient;
  let worker: SupabaseClient;

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
    await createUser(`emp-owner-${suffix}@local.test`);
    const foremanId = await createUser(`emp-foreman-${suffix}@local.test`);
    const workerId = await createUser(`emp-worker-${suffix}@local.test`);
    organizationId = orgIds[0];
    await service.from("organization_members").insert([
      { organization_id: organizationId, user_id: foremanId, role: "brygadzista" },
      { organization_id: organizationId, user_id: workerId, role: "member" }
    ]);
    const { data: crew } = await service.from("crews").insert({ organization_id: organizationId, name: "Brygada A" }).select("id").single();
    await service.from("employee_profiles").insert({ organization_id: organizationId, user_id: foremanId, crew_id: crew!.id, full_name: "Brygadzista", department: "brygada" });
    const { data: profile, error: profileError } = await service
      .from("employee_profiles")
      .insert({ organization_id: organizationId, user_id: workerId, crew_id: crew!.id, full_name: "Pracownik", department: "brygada", bhp_valid_until: "2026-11-30", employment_start_date: "2026-03-01", employment_end_date: "2026-10-15" })
      .select("id")
      .single();
    if (profileError || !profile) throw new Error(`Nie udało się dodać pracownika: ${profileError?.message}`);
    workerProfileId = profile.id as string;
    owner = await signIn(`emp-owner-${suffix}@local.test`);
    foreman = await signIn(`emp-foreman-${suffix}@local.test`);
    worker = await signIn(`emp-worker-${suffix}@local.test`);
  });

  afterAll(async () => {
    if (organizationId) {
      await service.from("employee_profiles").delete().eq("organization_id", organizationId);
      await service.from("crews").delete().eq("organization_id", organizationId);
    }
    for (const id of userIds) await service.auth.admin.deleteUser(id);
    for (const id of orgIds) await service.from("organizations").delete().eq("id", id);
  });

  const endDateSeenBy = async (client: SupabaseClient) => {
    const { data, error } = await client.rpc("employee_hr_profiles_visible", { target_org: organizationId });
    expect(error).toBeNull();
    const row = (data as { id: string; bhp_valid_until: string | null; employment_end_date: string | null }[]).find((r) => r.id === workerProfileId);
    return row;
  };

  it("właściciel i sam pracownik widzą koniec umowy", async (ctx) => {
    if (!requireStack(ctx)) return;
    expect((await endDateSeenBy(owner))?.employment_end_date).toBe("2026-10-15");
    expect((await endDateSeenBy(worker))?.employment_end_date).toBe("2026-10-15");
  });

  it("brygadzista widzi termin BHP swojego pracownika, ale nie koniec umowy", async (ctx) => {
    if (!requireStack(ctx)) return;
    const row = await endDateSeenBy(foreman);
    expect(row?.bhp_valid_until).toBe("2026-11-30");
    expect(row?.employment_end_date).toBeNull();
  });

  it("koniec zatrudnienia nie może być przed początkiem", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { error } = await service.from("employee_profiles").update({ employment_end_date: "2026-01-01" }).eq("id", workerProfileId);
    expect(error?.message).toMatch(/employment_dates/);
  });
});
