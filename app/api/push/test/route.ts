import { NextResponse } from "next/server";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import { isWebPushConfigured, sendWebPush } from "@/lib/web-push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const { data: userData } = await auth.supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  if (!isWebPushConfigured()) {
    return NextResponse.json({ error: "Serwer push nie ma kompletnej konfiguracji VAPID" }, { status: 503 });
  }

  let body: { endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }
  if (!body.endpoint || body.endpoint.length > 2048) {
    return NextResponse.json({ error: "Nieprawidłowy endpoint urządzenia" }, { status: 400 });
  }

  const { data: subscription, error } = await auth.supabase
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .eq("user_id", userData.user.id)
    .eq("endpoint", body.endpoint)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!subscription) return NextResponse.json({ error: "To urządzenie nie jest zapisane na serwerze" }, { status: 404 });

  try {
    await sendWebPush(subscription, {
      title: "GolBud Panel",
      body: "Powiadomienia na tym urządzeniu działają prawidłowo.",
      url: "/notifications",
      tag: `golbud-push-test-${Date.now()}`
    });
    return NextResponse.json({ ok: true });
  } catch (sendError) {
    const status = (sendError as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await auth.supabase.from("push_subscriptions").delete().eq("endpoint", body.endpoint);
      return NextResponse.json({ error: "Subskrypcja wygasła. Połącz urządzenie ponownie." }, { status: 410 });
    }
    console.warn("[push-test] send failed", sendError);
    return NextResponse.json({ error: "Usługa push odrzuciła wysyłkę. Sprawdź konfigurację VAPID i ustawienia przeglądarki." }, { status: 502 });
  }
}
