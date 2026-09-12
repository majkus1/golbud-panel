import { NextResponse } from "next/server";
import { canAccessAssistantCase, resolveAssistantAccess } from "@/lib/ai-assistant";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { AiConversation, AiMessage, AiMessageAttachment } from "@/lib/types";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  const { supabase } = auth;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { organizationId?: string; conversationId?: string; caseId?: string | null };
  const conversationId = (body.conversationId || "").trim();
  if (!conversationId) return NextResponse.json({ error: "Brak conversationId." }, { status: 400 });

  const access = await resolveAssistantAccess(supabase, user.id, body.organizationId);
  if (!access) return NextResponse.json({ error: "Brak dostępu do organizacji." }, { status: 403 });

  if (!access.canUseAssistant) return NextResponse.json({ error: "Asystent AI nie jest dostępny dla Twojej roli." }, { status: 403 });

  // Rozmowa jest prywatna — można usunąć wyłącznie własną (created_by = user.id).
  const { data: conversation, error: convoError } = await supabase
    .from("ai_conversations")
    .select("id, organization_id, case_id, created_by")
    .eq("id", conversationId)
    .eq("organization_id", access.organizationId)
    .eq("created_by", user.id)
    .maybeSingle();
  if (convoError) return NextResponse.json({ error: convoError.message }, { status: 400 });
  if (!conversation) return NextResponse.json({ error: "Nie znaleziono rozmowy." }, { status: 404 });

  // Dodatkowe zabezpieczenie: jeśli UI jest w trybie sprawy, nie pozwól skasować rozmowy z innej sprawy.
  if (typeof body.caseId !== "undefined") {
    const requestedCaseId = body.caseId || null;
    const convoCaseId = (conversation.case_id as string | null) || null;
    if (requestedCaseId !== convoCaseId) {
      return NextResponse.json({ error: "Ta rozmowa nie należy do wskazanej sprawy." }, { status: 400 });
    }
  }

  const { error: deleteError } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("organization_id", access.organizationId)
    .eq("created_by", user.id)
    .select("id")
    .maybeSingle();
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 });
  const { data: stillExists, error: verifyError } = await supabase
    .from("ai_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", access.organizationId)
    .eq("created_by", user.id)
    .maybeSingle();
  if (verifyError) return NextResponse.json({ error: verifyError.message }, { status: 400 });
  if (stillExists) {
    return NextResponse.json(
      { error: "Nie udało się usunąć rozmowy. Uruchom migrację 0045_ai_assistant_delete_conversations.sql w Supabase." },
      { status: 409 }
    );
  }

  // Rozmowy z Asystentem AI są w pełni prywatne (patrz migracja 0050) — usunięcie rozmowy
  // też nie trafia do ogólnofirmowego Dziennika zmian.

  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  const { supabase } = auth;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  const caseId = url.searchParams.get("caseId");
  const access = await resolveAssistantAccess(supabase, user.id, organizationId);
  if (!access) return NextResponse.json({ error: "Brak dostępu do organizacji." }, { status: 403 });
  if (!access.canUseAssistant) return NextResponse.json({ error: "Asystent AI nie jest dostępny dla Twojej roli." }, { status: 403 });
  if (caseId && !(await canAccessAssistantCase(supabase, access, user.id, caseId))) {
    return NextResponse.json({ error: "Brak dostępu do tej sprawy." }, { status: 403 });
  }

  // Prywatna historia: każdy widzi wyłącznie rozmowy, które sam założył.
  let query = supabase
    .from("ai_conversations")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("created_by", user.id)
    .order("last_message_at", { ascending: false })
    .limit(30);
  if (caseId) query = query.eq("case_id", caseId);
  else query = query.is("case_id", null);

  const { data: conversations, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const ids = ((conversations || []) as AiConversation[]).map((c) => c.id);
  const { data: messages } = ids.length
    ? await supabase.from("ai_messages").select("*").in("conversation_id", ids).order("created_at", { ascending: true })
    : { data: [] };
  const messageIds = ((messages || []) as AiMessage[]).map((message) => message.id);
  const { data: attachments } = messageIds.length
    ? await supabase.from("ai_message_attachments").select("*").in("message_id", messageIds).order("created_at", { ascending: true })
    : { data: [] };

  const attachmentsByMessage = new Map<string, AiMessageAttachment[]>();
  for (const attachment of ((attachments || []) as AiMessageAttachment[])) {
    if (!attachment.message_id) continue;
    attachmentsByMessage.set(attachment.message_id, [...(attachmentsByMessage.get(attachment.message_id) || []), attachment]);
  }

  const byConversation = new Map<string, Array<AiMessage & { attachments?: AiMessageAttachment[] }>>();
  for (const message of ((messages || []) as AiMessage[])) {
    byConversation.set(message.conversation_id, [
      ...(byConversation.get(message.conversation_id) || []),
      { ...message, attachments: attachmentsByMessage.get(message.id) || [] }
    ]);
  }

  return NextResponse.json({
    conversations: ((conversations || []) as AiConversation[]).map((conversation) => ({
      ...conversation,
      messages: byConversation.get(conversation.id) || []
    }))
  });
}
