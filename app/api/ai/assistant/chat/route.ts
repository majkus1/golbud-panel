import { NextResponse } from "next/server";
import {
  buildAssistantContext,
  buildAssistantQueryContext,
  canAccessAssistantCase,
  deriveConversationTitle,
  generateAssistantAnswer,
  getOrCreateConversation,
  loadAssistantAttachmentContext,
  loadAssistantConversationHistory,
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

  const body = (await request.json()) as {
    organizationId?: string;
    conversationId?: string | null;
    caseId?: string | null;
    message?: string;
    attachmentIds?: string[];
    forceNew?: boolean;
  };
  const message = (body.message || "").trim();
  if (message.length < 2) return NextResponse.json({ error: "Napisz pytanie do asystenta." }, { status: 400 });
  if (message.length > 5000) return NextResponse.json({ error: "Pytanie jest zbyt długie. Skróć je do najważniejszych informacji." }, { status: 400 });

  const access = await resolveAssistantAccess(supabase, user.id, body.organizationId);
  if (!access) return NextResponse.json({ error: "Brak dostępu do organizacji." }, { status: 403 });
  if (!access.canUseAssistant) return NextResponse.json({ error: "Asystent AI nie jest dostępny dla Twojej roli." }, { status: 403 });
  if (body.caseId && !(await canAccessAssistantCase(supabase, access, user.id, body.caseId))) {
    return NextResponse.json({ error: "Brak dostępu do tej sprawy." }, { status: 403 });
  }

  try {
    const conversation = await getOrCreateConversation(supabase, access, user.id, {
      conversationId: body.conversationId,
      caseId: body.caseId || null,
      title: deriveConversationTitle(message, body.caseId ? "Asystent AI sprawy" : "Asystent AI firmy"),
      forceNew: body.forceNew
    });
    const ctx = await buildAssistantContext(supabase, access, { scope: body.caseId ? "case" : "global", caseId: body.caseId || null });
    const retrieved = await buildAssistantQueryContext(supabase, access, message, body.caseId || null);
    ctx.contextText = `${retrieved.text}\n\n${ctx.contextText}`;
    const history = await loadAssistantConversationHistory(supabase, conversation.id);
    const attachmentIds = Array.from(new Set((body.attachmentIds || []).map((id) => id.trim()).filter(Boolean))).slice(0, 8);
    const attachmentContext = await loadAssistantAttachmentContext(supabase, access, attachmentIds);
    const { content, meta } = await generateAssistantAnswer(ctx, message, history, attachmentContext.text || undefined);
    const result = await saveAssistantExchange(supabase, access, user.id, conversation, message, content, {
      user: {
        source: "chat",
        context_scope: ctx.scope,
        canSeeFinances: ctx.canSeeFinances,
        attachmentIds,
        attachmentNames: attachmentContext.attachments.map((attachment) => attachment.file_name)
      },
      assistant: { source: "chat", ...meta, attachmentsUsed: attachmentIds.length, toolsUsed: retrieved.tools }
    });
    if (attachmentIds.length > 0) {
      await supabase
        .from("ai_message_attachments")
        .update({ message_id: result.userMessage.id })
        .in("id", attachmentIds)
        .eq("organization_id", access.organizationId)
        .eq("conversation_id", conversation.id);
    }

    // Rozmowy z Asystentem AI są w pełni prywatne (patrz migracja 0050) — nie logujemy ich
    // w ogólnofirmowym Dzienniku zmian (widocznym dla całej roli zarządczej), nawet bez
    // treści. Sam fakt skorzystania z asystenta zostaje wyłącznie w `ai_conversations`
    // (created_by, created_at), widocznym tylko dla autora rozmowy.

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OpenAiAssistantError) {
      return NextResponse.json({ error: error.message }, { status: error.status && error.status >= 500 ? 502 : 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się wygenerować odpowiedzi asystenta." }, { status: 400 });
  }
}
