import { NextResponse } from "next/server";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Usunięcie własnej skrzynki wraz z sekretem w Vault (RPC sprawdza, że to własne konto). */
export async function POST(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const {
    data: { user }
  } = await auth.supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  let body: { organizationId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane" }, { status: 400 });
  }

  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  if (!organizationId) return NextResponse.json({ error: "Brak organizacji" }, { status: 400 });

  const { error } = await auth.supabase.rpc("delete_user_mail_account", { target_org: organizationId });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
