import { NextResponse } from "next/server";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const {
    data: { user }
  } = await auth.supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  let body: {
    organizationId?: string;
    endpoint?: string;
    p256dh?: string;
    auth?: string;
    userAgent?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  if (!body.organizationId || !body.endpoint || !body.p256dh || !body.auth) {
    return NextResponse.json({ error: "Brak danych subskrypcji" }, { status: 400 });
  }

  const { error } = await auth.supabase.from("push_subscriptions").upsert(
    {
      organization_id: body.organizationId,
      user_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      user_agent: body.userAgent || null
    },
    { onConflict: "endpoint" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: prefErr } = await auth.supabase.rpc("set_own_push_enabled", {
    p_organization_id: body.organizationId,
    p_enabled: true
  });
  if (prefErr) return NextResponse.json({ error: prefErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
