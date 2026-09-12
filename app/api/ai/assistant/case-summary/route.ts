import { NextResponse } from "next/server";
import {
  buildAssistantContext,
  buildAssistantQueryContext,
  canAccessAssistantCase,
  caseSummaryPrompt,
  generateAssistantAnswer,
  getOrCreateConversation,
  OpenAiAssistantError,
  resolveAssistantAccess,
  saveAssistantExchange
} from "@/lib/ai-assistant";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  const { supabase } = auth;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const body = (await request.json()) as { organizationId?: string; caseId?: string; conversationId?: string | null };
  if (!body.caseId) return NextResponse.json({ error: "Brak sprawy do podsumowania." }, { status: 400 });
  const access = await resolveAssistantAccess(supabase, user.id, body.organizationId);
  if (!access) return NextResponse.json({ error: "Brak dostępu do organizacji." }, { status: 403 });
  if (!(await canAccessAssistantCase(supabase, access, user.id, body.caseId))) {
    return NextResponse.json({ error: "Brak dostępu do tej sprawy." }, { status: 403 });
  }

  try {
    const conversation = await getOrCreateConversation(supabase, access, user.id, {
      conversationId: body.conversationId,
      caseId: body.caseId,
      title: "Asystent AI sprawy"
    });
    const ctx = await buildAssistantContext(supabase, access, { scope: "case", caseId: body.caseId });
    const prompt = caseSummaryPrompt();
    const retrieved = await buildAssistantQueryContext(supabase, access, prompt, body.caseId);
    ctx.contextText = `${retrieved.text}\n\n${ctx.contextText}`;
    const { content, meta } = await generateAssistantAnswer(ctx, prompt);
    const result = await saveAssistantExchange(supabase, access, user.id, conversation, "Wygeneruj podsumowanie AI aktualnego stanu zlecenia.", content, {
      user: { source: "case_summary", context_scope: "case", canSeeFinances: ctx.canSeeFinances },
      assistant: { source: "case_summary", ...meta }
    });

    // Rozmowy z Asystentem AI są w pełni prywatne (patrz migracja 0050) — nie logujemy ich
    // w ogólnofirmowym Dzienniku zmian, widocznym dla całej roli zarządczej.

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OpenAiAssistantError) {
      return NextResponse.json({ error: error.message }, { status: error.status && error.status >= 500 ? 502 : 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się wygenerować podsumowania." }, { status: 400 });
  }
}
