"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { showToast } from "@/components/toast";
import { canUseAssistant } from "@/components/org-context";
import { postAuthenticatedBlob, postAuthenticatedForm, postAuthenticatedJson } from "@/lib/authed-fetch";
import { supabase } from "@/lib/supabase";
import type { AiConversation, AiMessage, AiMessageAttachment, MemberRole } from "@/lib/types";

type MessageWithAttachments = AiMessage & { attachments?: AiMessageAttachment[] };
type ConversationWithMessages = AiConversation & { messages: MessageWithAttachments[] };

type ChatResponse = {
  conversation: AiConversation;
  userMessage: AiMessage;
  assistantMessage: AiMessage;
};

type AssistantStatus = {
  openaiConfigured: boolean;
  model: string;
  localFallbackEnabled: boolean;
};

type UploadResponse = {
  conversation: AiConversation;
  attachments: AiMessageAttachment[];
};

// Historia rozmów jest prywatna: użytkownik widzi wyłącznie własne rozmowy, więc
// każda wiadomość z rolą "user" należy zawsze do niego samego ("Ty").
function authorLabel(userId: string | null): string {
  return userId ? "Ty" : "Asystent AI";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function GolbudAiMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`relative shrink-0 ${compact ? "h-11 w-11" : "h-14 w-14"}`} aria-hidden="true">
      <div className="absolute inset-0 rounded-2xl bg-amberline/20" />
      <div className="absolute inset-1 rounded-2xl bg-ink shadow-lg shadow-ink/20 ring-1 ring-white/15">
        <div className="absolute left-1/2 top-1/2 h-1/2 w-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-moss/80 blur-md" />
        <div className="absolute inset-0 grid place-items-center">
          <span className={`${compact ? "text-sm" : "text-base"} font-black tracking-[0.18em] text-amberline`}>AI</span>
        </div>
      </div>
      <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-white" />
    </div>
  );
}

function messageProvider(message: AiMessage): string {
  if (message.role !== "assistant") return "";
  const meta = message.meta as { provider?: string; model?: string } | null;
  if (meta?.provider === "openai") return meta.model ? `OpenAI · ${meta.model}` : "OpenAI";
  if (meta?.provider === "local") return "Lokalny fallback";
  return "";
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*?\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${part}-${index}`} className="font-bold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={`${part}-${index}`} className="italic text-ink">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function MarkdownMessage({ content, role }: { content: string; role: AiMessage["role"] }) {
  if (role !== "assistant") {
    return <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{content}</p>;
  }

  const lines = content.split("\n");
  return (
    <div className="space-y-2 text-sm leading-6 text-ink">
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div key={`space-${index}`} className="h-1" />;

        const heading = line.match(/^#{1,4}\s+(.+)$/);
        if (heading) {
          return (
            <h3 key={`heading-${index}`} className="pt-1 text-base font-extrabold text-ink">
              {renderInlineMarkdown(heading[1])}
            </h3>
          );
        }

        const numbered = line.match(/^(\d+)\.\s+(.+)$/);
        if (numbered) {
          return (
            <div key={`numbered-${index}`} className="flex gap-2 pt-2 font-semibold text-ink first:pt-0">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[0.7rem] font-bold text-white">{numbered[1]}</span>
              <p>{renderInlineMarkdown(numbered[2])}</p>
            </div>
          );
        }

        const bullet = line.match(/^[-*]\s+(.+)$/);
        if (bullet) {
          return (
            <div key={`bullet-${index}`} className="flex gap-2 pl-1">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-moss" />
              <p>{renderInlineMarkdown(bullet[1])}</p>
            </div>
          );
        }

        return <p key={`paragraph-${index}`}>{renderInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

function detectReportIntent(text: string): "pdf" | "xlsx" | null {
  const lower = text.toLocaleLowerCase("pl-PL");
  const wantsReport = lower.includes("raport") && (lower.includes("wygeneruj") || lower.includes("stwórz") || lower.includes("zrób") || lower.includes("przygotuj"));
  if (!wantsReport) return null;
  if (lower.includes("excel") || lower.includes("xlsx") || lower.includes("arkusz")) return "xlsx";
  if (lower.includes("pdf")) return "pdf";
  return null;
}

async function getAuthenticatedJson<T>(apiPath: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data } = await supabase.auth.refreshSession();
    session = data.session ?? null;
  }
  if (!session?.access_token) return { ok: false, error: "Sesja wygasła — odśwież stronę." };
  const res = await fetch(apiPath, {
    credentials: "include",
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) return { ok: false, error: json.error || `Błąd ${res.status}` };
  return { ok: true, data: json as T };
}

async function sendAuthenticatedJson<T>(
  apiPath: string,
  options: { method: "POST" | "DELETE"; body?: unknown }
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data } = await supabase.auth.refreshSession();
    session = data.session ?? null;
  }
  if (!session?.access_token) return { ok: false, error: "Sesja wygasła — odśwież stronę." };

  let res: Response;
  try {
    res = await fetch(apiPath, {
      method: options.method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch {
    return { ok: false, error: "Brak połączenia z serwerem." };
  }

  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) return { ok: false, error: json.error || `Błąd ${res.status}` };
  return { ok: true, data: json as T };
}

export function AiAssistantPanel({
  organizationId,
  caseId,
  role,
  compact = false
}: {
  organizationId: string;
  caseId?: string | null;
  role: MemberRole | null;
  compact?: boolean;
}) {
  const [conversations, setConversations] = useState<ConversationWithMessages[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [newChatDraft, setNewChatDraft] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState<"pdf" | "xlsx" | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<MessageWithAttachments[] | null>(null);

  // Dostęp do asystenta (globalnie i przy sprawie) — wszystkie role oprócz podwykonawcy
  // i zwykłego pracownika. Widoczność konkretnych danych (finanse, kadry, flota...)
  // w treści odpowiedzi jest dalej zawężana po stronie API wg roli i RLS.
  const hasAssistantAccess = canUseAssistant(role);
  const activeConversation = useMemo(
    () => (newChatDraft ? null : conversations.find((c) => c.id === conversationId) || conversations[0] || null),
    [conversationId, conversations, newChatDraft]
  );
  const messages = activeConversation?.messages || [];
  const visibleMessages = optimisticMessages || messages;

  const startNewChat = () => {
    setConversationId(null);
    setNewChatDraft(true);
    setOptimisticMessages(null);
    setDraft("");
    setSelectedFiles([]);
  };

  const deleteConversation = async (conversationIdToDelete: string) => {
    const target = conversations.find((c) => c.id === conversationIdToDelete);
    const title = target?.title || "rozmowę";
    if (!window.confirm(`Usunąć rozmowę „${title}”? Tej operacji nie da się cofnąć.`)) return;

    setBusy(true);
    const result = await sendAuthenticatedJson<{ ok: true }>("/api/ai/assistant/conversations", {
      method: "DELETE",
      body: {
        organizationId,
        caseId: typeof caseId === "undefined" ? undefined : (caseId || null),
        conversationId: conversationIdToDelete
      }
    });
    setBusy(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    await load();
    setConversationId((prev) => (prev === conversationIdToDelete ? null : prev));
    showToast("Usunięto rozmowę");
  };

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ organizationId, ...(caseId ? { caseId } : {}) });
    const result = await getAuthenticatedJson<{ conversations: ConversationWithMessages[] }>(
      `/api/ai/assistant/conversations?${qs.toString()}`
    );
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    setConversations(result.data.conversations);
    if (!newChatDraft) setConversationId((prev) => prev || result.data.conversations[0]?.id || null);
  }, [organizationId, caseId, newChatDraft]);

  const loadStatus = useCallback(async () => {
    const qs = new URLSearchParams({ organizationId });
    const result = await getAuthenticatedJson<AssistantStatus>(`/api/ai/assistant/status?${qs.toString()}`);
    if (result.ok) setAssistantStatus(result.data);
  }, [organizationId]);

  useEffect(() => {
    if (organizationId && (caseId || hasAssistantAccess)) {
      void load();
      void loadStatus();
    }
  }, [organizationId, caseId, hasAssistantAccess, load, loadStatus]);

  const uploadSelectedFiles = async (conversationIdForUpload: string | null): Promise<{ conversation: AiConversation; attachments: AiMessageAttachment[] } | null> => {
    if (selectedFiles.length === 0) return null;
    setUploadBusy(true);
    const form = new FormData();
    form.append("organizationId", organizationId);
    if (caseId) form.append("caseId", caseId);
    if (conversationIdForUpload) form.append("conversationId", conversationIdForUpload);
    if (newChatDraft && !conversationIdForUpload) form.append("forceNew", "true");
    selectedFiles.slice(0, 5).forEach((file) => form.append("files", file));
    const result = await postAuthenticatedForm<UploadResponse>("/api/ai/assistant/attachments", form);
    setUploadBusy(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return null;
    }
    return result.data;
  };

  const send = async (message: string) => {
    const text = message.trim() || (selectedFiles.length > 0 ? "Przeanalizuj załączone pliki i podsumuj najważniejsze informacje biznesowo." : "");
    if (!text) return;
    setBusy(true);
    const uploaded = await uploadSelectedFiles(activeConversation?.id || null);
    if (selectedFiles.length > 0 && !uploaded) {
      setBusy(false);
      return;
    }
    const attachmentIds = uploaded?.attachments.map((attachment) => attachment.id) || [];
    const attachmentNames = uploaded?.attachments.map((attachment) => attachment.file_name) || selectedFiles.map((file) => file.name);
    if (uploaded?.attachments.some((attachment) => attachment.extraction_status === "failed")) {
      showToast("Część plików nie została odczytana przez OCR. AI użyje dostępnych danych z załączników.", "error");
    }
    const conversationForSend = uploaded?.conversation.id || activeConversation?.id || null;
    const now = new Date().toISOString();
    const tempUserId = `tmp-user-${Date.now()}`;
    const tempAssistantId = `tmp-assistant-${Date.now()}`;
    setOptimisticMessages([
      ...messages,
      {
        id: tempUserId,
        organization_id: organizationId,
        conversation_id: activeConversation?.id || "pending",
        case_id: caseId || null,
        role: "user",
        content: text,
        meta: { optimistic: true, attachmentNames },
        created_by: "__current__",
        created_at: now
      },
      {
        id: tempAssistantId,
        organization_id: organizationId,
        conversation_id: activeConversation?.id || "pending",
        case_id: caseId || null,
        role: "assistant",
        content: "",
        meta: {
          optimistic: true,
          thinking: true,
          provider: assistantStatus?.openaiConfigured ? "openai" : "local",
          model: assistantStatus?.openaiConfigured ? assistantStatus.model : undefined
        },
        created_by: null,
        created_at: now
      }
    ]);
    setDraft("");
    setSelectedFiles([]);
    const result = await postAuthenticatedJson<ChatResponse>("/api/ai/assistant/chat", {
      organizationId,
      caseId: caseId || null,
      conversationId: conversationForSend,
      message: text,
      attachmentIds,
      forceNew: newChatDraft && !conversationForSend && !uploaded
    });
    setBusy(false);
    if (!result.ok) {
      setOptimisticMessages(null);
      showToast(result.error, "error");
      return;
    }
    const answer = result.data.assistantMessage.content;
    const step = Math.max(16, Math.ceil(answer.length / 90));
    for (let i = step; i < answer.length; i += step) {
      setOptimisticMessages((current) =>
        current?.map((item) =>
          item.id === tempAssistantId
            ? {
                ...item,
                content: answer.slice(0, i),
                meta: { ...(item.meta || {}), thinking: false }
              }
            : item
        ) || null
      );
      await sleep(14);
    }
    setOptimisticMessages((current) =>
      current?.map((item) =>
        item.id === tempAssistantId
          ? {
              ...item,
              content: answer,
              meta: { ...(item.meta || {}), thinking: false }
            }
          : item
      ) || null
    );
    await load();
    setOptimisticMessages(null);
    setConversationId(result.data.conversation.id);
    setNewChatDraft(false);
    const reportFormat = detectReportIntent(text);
    if (reportFormat) {
      await generateReport(reportFormat, text, attachmentIds);
      showToast(`Wygenerowano raport ${reportFormat === "pdf" ? "PDF" : "Excel"} z prośby w czacie`);
    }
  };

  const generateSummary = async () => {
    if (!caseId) return;
    setBusy(true);
    const result = await postAuthenticatedJson<ChatResponse>("/api/ai/assistant/case-summary", {
      organizationId,
      caseId,
      conversationId: activeConversation?.id || null
    });
    setBusy(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    await load();
    setConversationId(result.data.conversation.id);
    showToast("Wygenerowano podsumowanie AI");
  };

  const generateReport = async (format: "pdf" | "xlsx", customPrompt?: string, attachmentIds?: string[]) => {
    setReportBusy(format);
    const result = await postAuthenticatedBlob("/api/ai/assistant/report", {
      organizationId,
      caseId: caseId || null,
      conversationId: activeConversation?.id || null,
      reportType: caseId ? "case_summary" : "monthly_owner",
      format,
      prompt: customPrompt,
      attachmentIds: attachmentIds?.length ? attachmentIds : undefined
    });
    setReportBusy(null);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    downloadBlob(result.blob, `golbud-ai-${caseId ? "sprawa" : "firma"}.${format}`);
    showToast(`Pobrano raport ${format.toUpperCase()}`);
  };

  if (!hasAssistantAccess) {
    return (
      <section className="rounded-2xl bg-white p-5 shadow-panel">
        <div className="flex items-center gap-3">
          <GolbudAiMark compact />
          <div>
            <h1 className="text-xl font-bold text-ink">GolBud AI</h1>
            <p className="mt-1 text-sm text-steel">Firmowy asystent nie jest dostępny dla Twojej roli.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`grid min-w-0 gap-4 rounded-2xl bg-white p-3 shadow-panel ring-1 ring-stone-100 ${compact ? "sm:p-4" : "sm:p-5"}`}>
      <div className="relative overflow-hidden rounded-2xl bg-ink p-4 text-white shadow-lg shadow-ink/10 sm:p-5">
        <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="relative flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 gap-3">
            <GolbudAiMark />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amberline">GolBud AI</p>
              <h2 className="mt-1 text-2xl font-black tracking-normal text-white sm:text-3xl">
                {caseId ? "Asystent tej budowy" : "Firmowy asystent AI"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/75">
                {caseId
                  ? "Czyta dane tego zlecenia, wyłapuje ryzyka, terminy, zadania i finanse dostępne dla Twojej roli."
                  : "Analizuje zlecenia, zadania i dane dostępne dla Twojej roli — pyta się i odpowiada zwykłym językiem, bez technicznego raportu."}
              </p>
            </div>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-3 xl:flex">
            {caseId && (
              <button type="button" onClick={() => void generateSummary()} disabled={busy} className="rounded-xl bg-amberline px-4 py-2.5 text-sm font-bold text-ink shadow-sm hover:bg-white disabled:opacity-60">
                {busy ? "Generuję..." : "Podsumowanie AI"}
              </button>
            )}
            <button type="button" onClick={() => void generateReport("pdf")} disabled={!!reportBusy} className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-ink shadow-sm hover:bg-amberline disabled:opacity-60">
              {reportBusy === "pdf" ? "Generuję raport PDF..." : caseId ? "Raport sprawy PDF" : "Raport właścicielski PDF"}
            </button>
            <button type="button" onClick={() => void generateReport("xlsx")} disabled={!!reportBusy} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/20 disabled:opacity-60">
              {reportBusy === "xlsx" ? "Generuję raport Excel..." : caseId ? "Raport sprawy Excel" : "Raport właścicielski Excel"}
            </button>
          </div>
        </div>
        <div className="relative mt-4 grid gap-2 text-xs font-semibold text-white/75 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">Kontekst: {caseId ? "zlecenie" : "cała firma"}</div>
          <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">Tryb: analiza i raporty</div>
          <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">Dane: zgodnie z rolą użytkownika</div>
        </div>
      </div>

      {assistantStatus && (
        <div
          className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
            assistantStatus.openaiConfigured
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {assistantStatus.openaiConfigured
            ? `OpenAI aktywny · model: ${assistantStatus.model}`
            : assistantStatus.localFallbackEnabled
              ? "OpenAI nie jest skonfigurowane · działa lokalny fallback"
              : "OpenAI nie jest skonfigurowane · asystent zwróci błąd konfiguracji"}
        </div>
      )}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-2xl border border-stone-200 bg-stone-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-steel">Twoje rozmowy</p>
            <button
              type="button"
              onClick={startNewChat}
              disabled={busy || uploadBusy}
              className="rounded-lg bg-ink px-2.5 py-1.5 text-xs font-bold text-white hover:bg-moss disabled:opacity-60"
            >
              Nowy czat
            </button>
          </div>
          <p className="mt-1 text-[0.7rem] leading-4 text-steel">Widoczne tylko dla Ciebie — inni pracownicy nie widzą Twojej historii czatu.</p>
          <div className="mt-2 grid max-h-72 gap-2 overflow-y-auto pr-1">
            {newChatDraft && (
              <div className="rounded-xl bg-amberline px-3 py-2 text-sm text-ink shadow-sm">
                <span className="block font-bold">Nowy czat</span>
                <span className="block text-xs opacity-80">Wyślij wiadomość, aby zapisać rozmowę.</span>
              </div>
            )}
            {conversations.length === 0 && !newChatDraft ? (
              <p className="rounded-xl bg-white p-3 text-sm text-steel">Brak rozmów. Zadaj pierwsze pytanie firmowemu AI.</p>
            ) : (
              conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
                    activeConversation?.id === conversation.id ? "bg-ink text-white shadow-sm" : "bg-white text-ink hover:bg-stone-100"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setNewChatDraft(false);
                      setConversationId(conversation.id);
                    }}
                    className="min-w-0 text-left"
                  >
                    <span className="block truncate font-semibold">{conversation.title}</span>
                    <span className="block text-xs opacity-75">{new Date(conversation.last_message_at).toLocaleString("pl-PL")}</span>
                  </button>
                  <button
                    type="button"
                    title="Usuń rozmowę"
                    aria-label="Usuń rozmowę"
                    disabled={busy}
                    onClick={() => void deleteConversation(conversation.id)}
                    className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                      activeConversation?.id === conversation.id ? "bg-white/10 text-white hover:bg-white/20" : "bg-stone-100 text-ink hover:bg-stone-200"
                    } disabled:opacity-60`}
                  >
                    Usuń
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        <div className="grid min-w-0 gap-3">
          <div className="grid max-h-[560px] min-h-[24rem] content-start gap-3 overflow-y-auto rounded-2xl border border-stone-200 bg-stone-50 p-3">
            {visibleMessages.length === 0 ? (
              <div className="rounded-2xl bg-white p-5 text-sm text-steel shadow-sm">
                <div className="flex items-center gap-3">
                  <GolbudAiMark compact />
                  <div>
                    <p className="font-bold text-ink">GolBud AI jest gotowy.</p>
                    <p className="mt-1 leading-6">Napisz własne pytanie o firmę, zlecenie, terminy, płatności, rentowność albo raport.</p>
                  </div>
                </div>
              </div>
            ) : (
              visibleMessages.map((message) => (
                <article
                  key={message.id}
                  className={`rounded-2xl p-4 shadow-sm ${
                    message.role === "assistant"
                      ? "border border-stone-200 bg-white"
                      : "ml-auto max-w-[92%] border border-moss/15 bg-moss/10"
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-steel">
                      {message.id.startsWith("tmp-user") ? "Ty" : message.role === "assistant" ? "GolBud AI" : authorLabel(message.created_by)}
                      {messageProvider(message) ? <span className="ml-2 normal-case tracking-normal text-moss">{messageProvider(message)}</span> : null}
                    </p>
                    <p className="text-xs text-steel">{new Date(message.created_at).toLocaleString("pl-PL")}</p>
                  </div>
                  {((message.attachments && message.attachments.length > 0) || Array.isArray((message.meta as { attachmentNames?: string[] } | null)?.attachmentNames)) && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {(message.attachments && message.attachments.length > 0
                        ? message.attachments.map((attachment) => ({
                            id: attachment.id,
                            name: attachment.file_name,
                            status: attachment.extraction_status
                          }))
                        : ((message.meta as { attachmentNames?: string[] } | null)?.attachmentNames || []).map((name) => ({
                            id: name,
                            name,
                            status: "ready"
                          }))
                      ).map((attachment) => (
                        <span key={attachment.id} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-steel ring-1 ring-stone-200">
                          {attachment.name}
                          {attachment.status === "failed" ? " · OCR nieudany" : attachment.status === "partial" ? " · zapisany" : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {message.meta && (message.meta as { thinking?: boolean }).thinking ? (
                    <div className="flex items-center gap-2 text-sm font-semibold text-steel">
                      <span>Asystent analizuje dane i pisze odpowiedź</span>
                      <span className="inline-flex gap-1" aria-hidden="true">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-moss [animation-delay:-0.2s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-moss [animation-delay:-0.1s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-moss" />
                      </span>
                    </div>
                  ) : (
                    <MarkdownMessage content={message.content} role={message.role} />
                  )}
                </article>
              ))
            )}
          </div>

          <form
            className="grid min-w-0 gap-2 rounded-2xl border border-stone-200 bg-white p-2 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            {selectedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 px-1 pt-1">
                {selectedFiles.map((file) => (
                  <span key={`${file.name}-${file.size}`} className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-ink">
                    {file.name}
                    <button
                      type="button"
                      onClick={() => setSelectedFiles((files) => files.filter((item) => item !== file))}
                      className="text-steel hover:text-rose-600"
                      aria-label={`Usuń ${file.name}`}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                className="min-h-24 resize-y rounded-xl border-0 bg-stone-50 px-3 py-3 text-sm leading-6 outline-none ring-1 ring-stone-200 focus:bg-white focus:ring-2 focus:ring-moss"
                placeholder={caseId ? "Napisz do GolBud AI o tej budowie..." : "Napisz do GolBud AI o zleceniach, finansach, HR, terminach albo raportach..."}
              />
              <div className="grid gap-2">
                <label className="flex cursor-pointer items-center justify-center rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-ink hover:bg-stone-50">
                  Dodaj pliki
                  <input
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.csv,.txt,.md,.json,.xml,.pdf,image/*"
                    className="sr-only"
                    onChange={(event) => {
                      const files = Array.from(event.target.files || []).slice(0, 5);
                      setSelectedFiles(files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button type="submit" disabled={busy || uploadBusy || (!draft.trim() && selectedFiles.length === 0)} className="rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-moss disabled:opacity-60">
                  {uploadBusy ? "Czytam pliki..." : busy ? "Analizuję..." : "Wyślij"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
