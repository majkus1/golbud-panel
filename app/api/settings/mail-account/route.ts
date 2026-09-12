import { NextResponse } from "next/server";
import { MAIL_ACCOUNT_COLUMNS, loadAccountForUser, loadCredentials, updateAccountStatus } from "@/lib/mail/account";
import { describeMailboxError, verifyMailbox } from "@/lib/mail/imap-client";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Konfiguracja własnej skrzynki. Hasło aplikacji idzie prosto do RPC zapisującego je
 * w Vault — nigdy nie wraca do przeglądarki i nie jest logowane.
 */

async function requireUser(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return null;
  const {
    data: { user }
  } = await auth.supabase.auth.getUser();
  return user ? { supabase: auth.supabase, user } : null;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** GET — stan własnej skrzynki (bez hasła). */
export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "Brak organizacji" }, { status: 400 });

  const { data } = await session.supabase
    .from("user_mail_accounts")
    .select(MAIL_ACCOUNT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  return NextResponse.json({ account: data ?? null });
}

/** POST — zapis skrzynki i natychmiastowy test połączenia. */
export async function POST(request: Request) {
  const session = await requireUser(request);
  if (!session) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  let body: { organizationId?: unknown; email?: unknown; appPassword?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane" }, { status: 400 });
  }

  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const appPassword = typeof body.appPassword === "string" ? body.appPassword.replace(/\s/g, "") : "";

  if (!organizationId) return NextResponse.json({ error: "Brak organizacji" }, { status: 400 });
  if (!isEmail(email)) return NextResponse.json({ error: "Podaj poprawny adres e-mail" }, { status: 400 });
  if (appPassword.length < 8) {
    return NextResponse.json({ error: "Hasło aplikacji jest za krótkie" }, { status: 400 });
  }

  // Zapis przez RPC — funkcja sama sprawdza członkostwo i pozwala zapisać wyłącznie własną skrzynkę.
  const { data: accountId, error } = await session.supabase.rpc("save_user_mail_account", {
    target_org: organizationId,
    target_email: email,
    target_app_password: appPassword
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const service = createSupabaseServiceClient();
  const account = await loadAccountForUser(service, organizationId, session.user.id);
  if (!account) return NextResponse.json({ error: "Nie udało się zapisać skrzynki" }, { status: 500 });

  try {
    const credentials = await loadCredentials(service, account);
    await verifyMailbox(credentials);
    await updateAccountStatus(service, account.id, "ok", null);
    return NextResponse.json({ ok: true, accountId, status: "ok" });
  } catch (error) {
    const described = describeMailboxError(error);
    // Skrzynkę zostawiamy zapisaną ze statusem błędu — użytkownik poprawia hasło,
    // zamiast wpisywać wszystko od nowa.
    await updateAccountStatus(service, account.id, "error", described.message);
    return NextResponse.json({ error: described.message, status: "error" }, { status: 400 });
  }
}

// Usuwanie skrzynki: osobna trasa POST (`./delete`) — reszta panelu też komunikuje się
// z API przez POST, a wspólny helper `postAuthenticatedJson` nie obsługuje metody DELETE.
