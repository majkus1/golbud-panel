import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Testy integracyjne skrzynek pocztowych — sprawdzają to, czego testy jednostkowe nie ruszą:
 * uprawnienia RLS, zachowanie funkcji SECURITY DEFINER i przechowywanie hasła w Vault.
 *
 * Wymagają lokalnego Supabase (`npx supabase start`). Gdy stos nie działa, cały blok
 * jest pomijany, żeby `npm test` nie wywracał się na maszynie bez Dockera.
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
const APP_PASSWORD = "abcd efgh ijkl mnop";

async function stackIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: ANON_KEY } });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ustawiane w `beforeAll` — bez działającego stosu każdy test kończy się pominięciem. */
let available = false;

type SkippableContext = { skip: () => void };

/** Pomija test, gdy lokalny Supabase nie działa (np. na maszynie bez Dockera). */
function requireStack(ctx: SkippableContext): boolean {
  if (!available) {
    ctx.skip();
    return false;
  }
  return true;
}

describe("skrzynki pocztowe użytkowników", () => {
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const suffix = String(Date.now());
  const ownerEmail = `mail-test-owner-${suffix}@local.test`;
  const otherEmail = `mail-test-other-${suffix}@local.test`;

  let organizationId = "";
  let ownerId = "";
  let otherId = "";
  let ownerClient: SupabaseClient;
  let otherClient: SupabaseClient;

  async function createUser(email: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true
    });
    if (error || !data.user) throw new Error(`Nie udało się utworzyć użytkownika: ${error?.message}`);
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

    ownerId = await createUser(ownerEmail);
    otherId = await createUser(otherEmail);

    // Trigger `handle_new_user` zakłada organizację przy rejestracji — bierzemy tę właściciela.
    const { data: membership } = await service
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", ownerId)
      .single();
    organizationId = membership?.organization_id as string;

    await service.from("organization_members").insert({
      organization_id: organizationId,
      user_id: otherId,
      role: "sales"
    });

    ownerClient = await signIn(ownerEmail);
    otherClient = await signIn(otherEmail);
  });

  afterAll(async () => {
    if (ownerId) await service.auth.admin.deleteUser(ownerId);
    if (otherId) await service.auth.admin.deleteUser(otherId);
  });

  it("zapisuje skrzynkę i chowa hasło w Vault", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { data: accountId, error } = await ownerClient.rpc("save_user_mail_account", {
      target_org: organizationId,
      target_email: "Skrzynka@Gmail.com",
      target_app_password: APP_PASSWORD
    });
    expect(error).toBeNull();
    expect(accountId).toBeTruthy();

    const { data: row } = await service
      .from("user_mail_accounts")
      .select("email_address, status, secret_id")
      .eq("id", accountId)
      .single();

    // Adres jest normalizowany, żeby porównanie nadawcy w wątku działało niezależnie od wielkości liter.
    expect(row?.email_address).toBe("skrzynka@gmail.com");
    expect(row?.status).toBe("unverified");
    expect(row?.secret_id).toBeTruthy();

    const { data: secret } = await service.rpc("get_user_mail_secret", { target_account: accountId });
    // Spacje z hasła aplikacji Google są usuwane przy zapisie.
    expect(secret).toBe("abcdefghijklmnop");
  });

  it("nie ujawnia hasła ani identyfikatora sekretu roli zalogowanego użytkownika", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { error: columnError } = await ownerClient.from("user_mail_accounts").select("secret_id").limit(1);
    expect(columnError).not.toBeNull();

    const { error: rpcError } = await ownerClient.rpc("get_user_mail_secret", {
      target_account: "00000000-0000-0000-0000-000000000000"
    });
    expect(rpcError).not.toBeNull();
  });

  it("ponowny zapis aktualizuje hasło zamiast tworzyć drugą skrzynkę", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { error } = await ownerClient.rpc("save_user_mail_account", {
      target_org: organizationId,
      target_email: "skrzynka@gmail.com",
      target_app_password: "nowe-haslo-aplikacji"
    });
    expect(error).toBeNull();

    const { data: rows } = await service
      .from("user_mail_accounts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", ownerId);
    expect(rows).toHaveLength(1);

    const { data: secret } = await service.rpc("get_user_mail_secret", { target_account: rows?.[0].id });
    expect(secret).toBe("nowe-haslo-aplikacji");
  });

  it("właściciel widzi skrzynki zespołu, ale handlowiec tylko własną", async (ctx) => {
    if (!requireStack(ctx)) return;
    await otherClient.rpc("save_user_mail_account", {
      target_org: organizationId,
      target_email: "handlowiec@gmail.com",
      target_app_password: APP_PASSWORD
    });

    const { data: ownerView } = await ownerClient
      .from("user_mail_accounts")
      .select("email_address")
      .eq("organization_id", organizationId);
    expect(ownerView?.map((row) => row.email_address).sort()).toEqual(["handlowiec@gmail.com", "skrzynka@gmail.com"]);

    const { data: salesView } = await otherClient
      .from("user_mail_accounts")
      .select("email_address")
      .eq("organization_id", organizationId);
    expect(salesView?.map((row) => row.email_address)).toEqual(["handlowiec@gmail.com"]);
  });

  it("nie pozwala zapisać skrzynki bezpośrednio, z pominięciem funkcji", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { error } = await ownerClient.from("user_mail_accounts").insert({
      organization_id: organizationId,
      user_id: ownerId,
      email_address: "obejscie@gmail.com",
      secret_id: "00000000-0000-0000-0000-000000000000"
    });
    expect(error).not.toBeNull();
  });

  it("odrzuca niepoprawny adres i zbyt krótkie hasło", async (ctx) => {
    if (!requireStack(ctx)) return;
    const badEmail = await ownerClient.rpc("save_user_mail_account", {
      target_org: organizationId,
      target_email: "to-nie-jest-adres",
      target_app_password: APP_PASSWORD
    });
    expect(badEmail.error).not.toBeNull();

    const shortPassword = await ownerClient.rpc("save_user_mail_account", {
      target_org: organizationId,
      target_email: "skrzynka@gmail.com",
      target_app_password: "krotkie"
    });
    expect(shortPassword.error).not.toBeNull();
  });

  it("usunięcie skrzynki kasuje też sekret", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { data: before } = await service
      .from("user_mail_accounts")
      .select("secret_id")
      .eq("user_id", ownerId)
      .single();
    const secretId = before?.secret_id as string;

    const { error } = await ownerClient.rpc("delete_user_mail_account", { target_org: organizationId });
    expect(error).toBeNull();

    const { count } = await service
      .from("user_mail_accounts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ownerId);
    expect(count).toBe(0);

    const { data: orphan } = await service.schema("vault").from("secrets").select("id").eq("id", secretId);
    expect(orphan ?? []).toHaveLength(0);
  });

  /**
   * Regresja: wiersz skasowany z pominięciem funkcji (np. kaskadą po usunięciu użytkownika)
   * zostawiał sekret w Vault, a unikalna nazwa blokowała ponowne dodanie skrzynki na zawsze.
   */
  it("pozwala dodać skrzynkę ponownie po usunięciu wiersza kaskadą", async (ctx) => {
    if (!requireStack(ctx)) return;
    await ownerClient.rpc("save_user_mail_account", {
      target_org: organizationId,
      target_email: "skrzynka@gmail.com",
      target_app_password: APP_PASSWORD
    });

    await service.from("user_mail_accounts").delete().eq("user_id", ownerId);

    const { error } = await ownerClient.rpc("save_user_mail_account", {
      target_org: organizationId,
      target_email: "skrzynka@gmail.com",
      target_app_password: "haslo-po-odtworzeniu"
    });
    expect(error).toBeNull();

    const { data: row } = await service
      .from("user_mail_accounts")
      .select("id")
      .eq("user_id", ownerId)
      .single();
    const { data: secret } = await service.rpc("get_user_mail_secret", { target_account: row?.id });
    expect(secret).toBe("haslo-po-odtworzeniu");
  });
});
