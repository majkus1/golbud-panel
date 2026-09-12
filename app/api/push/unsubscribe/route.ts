import { NextResponse } from "next/server";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  let body: { endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  if (!body.endpoint) return NextResponse.json({ error: "Brak endpoint" }, { status: 400 });

  const { error } = await auth.supabase.from("push_subscriptions").delete().eq("endpoint", body.endpoint);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
