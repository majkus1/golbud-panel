import { NextResponse } from "next/server";
import { assistantRuntimeStatus, resolveAssistantAccess } from "@/lib/ai-assistant";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  const { supabase } = auth;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const url = new URL(request.url);
  const access = await resolveAssistantAccess(supabase, user.id, url.searchParams.get("organizationId"));
  if (!access?.canUseAssistant) return NextResponse.json({ error: "Brak dostępu do statusu Asystenta AI." }, { status: 403 });

  return NextResponse.json(assistantRuntimeStatus());
}
