"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconPaperclip } from "@/components/case/mail-icons";
import { MailComposer, type ComposerPayload } from "@/components/case/mail-composer";
import { showToast } from "@/components/toast";
import { getAuthenticatedJson, postAuthenticatedForm, postAuthenticatedJson } from "@/lib/authed-fetch";
import { downloadAuthenticatedFile } from "@/lib/download-authenticated-pdf";
import { formatDateTime } from "@/lib/format";
import type { MailThread, MailThreadMessage, ThreadOrder } from "@/lib/mail/thread-model";

/**
 * Historia korespondencji z klientem przy zleceniu.
 *
 * Wejście w zakładkę wczytuje historię **z bazy** — natychmiast i bez łączenia się
 * ze skrzynką. Dopiero „Synchronizuj wiadomości" sięga po pocztę i **dopisuje wyłącznie
 * nowe** wiadomości; już zapisane są pomijane po stronie bazy, więc nic się nie dubluje.
 */

/** Historia zapisana w bazie — wczytywana od razu, bez łączenia się z pocztą. */
type StoredResponse = {
  clientEmail: string | null;
  threads: MailThread[];
  messageCount: number;
  lastSyncedAt: string | null;
};

/** Wynik pobrania nowych wiadomości ze skrzynki. */
type SyncResponse = StoredResponse & {
  /** Adres skrzynki zalogowanego użytkownika — nigdy cudzej. */
  mailbox: string;
  /** Ile wiadomości faktycznie dopisano; powtórki są pomijane. */
  added: number;
  fetched: number;
};

type Props = {
  caseId: string;
  clientEmail: string | null;
  clientName: string;
};

/** Powody, dla których zakładka jest pusta — każdy wymaga innej reakcji użytkownika. */
type Blocker = "no_client_email" | "no_mailbox" | null;

type View = "threads" | "attachments";

/** Załącznik z informacją, z której wiadomości pochodzi — do wspólnej listy plików. */
type AttachmentEntry = {
  key: string;
  uid: number;
  partId: string;
  fileName: string;
  size: number | null;
  date: string;
  threadSubject: string;
  fromLabel: string;
};

function initials(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "?";
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function senderLabel(message: MailThreadMessage): string {
  if (message.direction === "outgoing") return "My";
  return message.from?.name || message.from?.address || "Klient";
}

function AttachmentChip({
  fileName,
  size,
  onDownload
}: {
  fileName: string;
  size: number | null;
  onDownload: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onDownload}
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-ink transition hover:border-moss/40 hover:bg-stone-50"
    >
      <IconPaperclip className="text-steel" />
      <span className="truncate">{fileName}</span>
      {size ? <span className="shrink-0 text-stone-400">{formatBytes(size)}</span> : null}
    </button>
  );
}

function MessageBubble({
  message,
  onDownload
}: {
  message: MailThreadMessage;
  onDownload: (uid: number, partId: string, fileName: string) => void;
}) {
  const outgoing = message.direction === "outgoing";

  return (
    <li className={`flex ${outgoing ? "justify-end" : "justify-start"}`}>
      <div
        className={`min-w-0 max-w-[92%] rounded-xl2 border p-3 shadow-card sm:max-w-[78%] ${
          outgoing ? "border-moss/30 bg-moss/10" : "border-stone-200 bg-white"
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="font-bold text-ink">{senderLabel(message)}</span>
          <span className="text-stone-400">{formatDateTime(message.date)}</span>
        </div>

        {message.html ? (
          // Treść jest czyszczona na serwerze (`sanitizeIncomingHtml`) — bez skryptów,
          // stylów i obrazków zdalnych. Do przeglądarki trafia już bezpieczna.
          <div
            className="mt-1.5 break-words text-sm text-ink [&_a]:text-moss [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-stone-200 [&_blockquote]:pl-3 [&_li]:ml-4 [&_ol]:my-1 [&_ol]:list-decimal [&_p]:my-1 [&_table]:block [&_table]:overflow-x-auto [&_ul]:my-1 [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: message.html }}
          />
        ) : (
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink">
            {message.text || <span className="text-steel">(pusta treść)</span>}
          </p>
        )}

        {message.attachments.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5 border-t border-stone-200/70 pt-2">
            {message.attachments.map((attachment) => (
              <li key={attachment.partId}>
                <AttachmentChip
                  fileName={attachment.fileName}
                  size={attachment.size}
                  onDownload={() => onDownload(message.uid, attachment.partId, attachment.fileName)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export function CaseEmailsSection({ caseId, clientEmail, clientName }: Props) {
  const [data, setData] = useState<StoredResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [blocker, setBlocker] = useState<Blocker>(null);
  /** Kolejność dotyczy wiadomości w otwartym wątku. Lista tematów jest zawsze
   *  od ostatnio aktywnych — tam kolejność nie jest kwestią gustu, tylko przydatności. */
  const [messageOrder, setMessageOrder] = useState<ThreadOrder>("oldest");
  const [view, setView] = useState<View>("threads");
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [composingNew, setComposingNew] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [sending, setSending] = useState(false);

  const hasClientEmail = !!clientEmail?.trim();

  /** Historia z bazy — natychmiastowa, bez kontaktu ze skrzynką. Leci przy wejściu w zakładkę. */
  const loadStored = useCallback(async () => {
    setLoading(true);
    const result = await getAuthenticatedJson<StoredResponse>(`/api/cases/${caseId}/emails`);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setData(result.data);
    setOpenThreadId((current) => current ?? result.data.threads[0]?.id ?? null);
  }, [caseId]);

  useEffect(() => {
    void loadStored();
  }, [loadStored]);

  /** Pobranie nowych wiadomości ze skrzynki i dopisanie ich do historii. */
  const sync = useCallback(async () => {
    setSyncing(true);
    setError("");
    setBlocker(null);
    const result = await postAuthenticatedJson<SyncResponse>(`/api/cases/${caseId}/emails/sync`, {});
    setSyncing(false);

    if (!result.ok) {
      const reason = (result as { body?: { reason?: string } }).body?.reason;
      if (reason === "no_client_email" || reason === "no_mailbox") setBlocker(reason);
      else setError(result.error);
      return;
    }
    setData(result.data);
    setOpenThreadId((current) => current ?? result.data.threads[0]?.id ?? null);
    showToast(
      result.data.added > 0
        ? `Pobrano ${result.data.added} ${result.data.added === 1 ? "nową wiadomość" : "nowych wiadomości"}`
        : "Brak nowych wiadomości"
    );
  }, [caseId]);

  /** Tematy zawsze od ostatnio aktywnych — świeża rozmowa ma być na wierzchu. */
  const threads = useMemo(() => {
    if (!data) return [];
    return [...data.threads].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }, [data]);

  /** Wszystkie pliki z całej korespondencji, najnowsze pierwsze. */
  const allAttachments = useMemo<AttachmentEntry[]>(() => {
    const entries: AttachmentEntry[] = [];
    for (const thread of data?.threads ?? []) {
      for (const message of thread.messages) {
        for (const attachment of message.attachments) {
          entries.push({
            key: `${message.uid}-${attachment.partId}`,
            uid: message.uid,
            partId: attachment.partId,
            fileName: attachment.fileName,
            size: attachment.size,
            date: message.date,
            threadSubject: thread.subject,
            fromLabel: senderLabel(message)
          });
        }
      }
    }
    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }, [data]);

  const openThread = threads.find((thread) => thread.id === openThreadId) ?? null;

  /** Wiadomości w otwartym wątku — kolejność sterowana przełącznikiem. */
  const openThreadMessages = useMemo(() => {
    if (!openThread) return [];
    return messageOrder === "oldest" ? openThread.messages : [...openThread.messages].reverse();
  }, [openThread, messageOrder]);

  const download = async (uid: number, partId: string, fileName: string) => {
    const ok = await downloadAuthenticatedFile(
      `/api/cases/${caseId}/emails/attachments?uid=${uid}&part=${encodeURIComponent(partId)}`,
      fileName
    );
    if (!ok) showToast("Nie udało się pobrać załącznika", "error");
  };

  const send = async (payload: ComposerPayload, options: { subject?: string; thread?: MailThread }) => {
    setSending(true);
    const form = new FormData();
    form.append("html", payload.html);
    if (options.subject) form.append("subject", options.subject);
    if (options.thread) form.append("thread", JSON.stringify(options.thread));
    payload.files.forEach((file) => form.append("files", file));

    const result = await postAuthenticatedForm(`/api/cases/${caseId}/emails`, form);
    setSending(false);

    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    showToast("Wiadomość wysłana");
    setComposingNew(false);
    setNewSubject("");
    // Wysłana wiadomość pojawi się w wątku dopiero po ponownym pobraniu ze skrzynki.
    await sync();
  };

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-ink">Historia korespondencji</h2>
          <p className="mt-1 text-sm text-steel">
            {hasClientEmail ? (
              <>
                Wiadomości wymienione z adresem <span className="font-semibold text-ink">{clientEmail}</span>
              </>
            ) : (
              "Zlecenie nie ma adresu e-mail klienta."
            )}
          </p>
          {data?.lastSyncedAt && (
            <p className="mt-1 text-xs text-stone-400">
              Zapisanych wiadomości: {data.messageCount} · ostatnia synchronizacja:{" "}
              {formatDateTime(data.lastSyncedAt)}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={!hasClientEmail || syncing}
          onClick={() => void sync()}
          className="shrink-0 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-moss disabled:opacity-50 sm:px-4 sm:py-2.5 sm:text-sm"
        >
          {syncing ? "Synchronizuję…" : "Synchronizuj wiadomości"}
        </button>
      </div>

      {!hasClientEmail && (
        <div className="mt-4 rounded-xl2 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Uzupełnij adres e-mail klienta w danych zlecenia, żeby zobaczyć korespondencję.{" "}
          <Link href={`/cases/${caseId}/edit`} className="font-semibold underline">
            Edytuj dane zlecenia
          </Link>
        </div>
      )}

      {blocker === "no_mailbox" && (
        <div className="mt-4 rounded-xl2 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Nie masz jeszcze podłączonej skrzynki pocztowej. Historia korespondencji pokazuje wiadomości
          wymienione z klientem <span className="font-semibold">z Twojej skrzynki</span>.{" "}
          <Link href="/settings/mail" className="font-semibold underline">
            Skonfiguruj swoją pocztę
          </Link>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl2 border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</div>
      )}

      {!loading && data?.threads.length === 0 && !syncing && !error && blocker === null && hasClientEmail && (
        <div className="mt-4 rounded-xl2 border border-dashed border-stone-200 p-8 text-center text-sm text-steel">
          Brak zapisanej korespondencji. Kliknij „Synchronizuj wiadomości&rdquo;, żeby pobrać wiadomości
          wymienione z adresem {clientEmail}.
        </div>
      )}

      {(loading || syncing) && !data?.threads.length && (
        <div className="mt-4 grid gap-2">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-16 animate-pulse rounded-xl2 bg-stone-100" />
          ))}
        </div>
      )}

      {data && data.threads.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-3">
            <div className="inline-flex overflow-hidden rounded-lg border border-stone-300 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setView("threads")}
                className={`px-3 py-1.5 transition ${view === "threads" ? "bg-ink text-white" : "bg-white text-steel hover:bg-stone-50"}`}
              >
                Wątki ({threads.length})
              </button>
              <button
                type="button"
                onClick={() => setView("attachments")}
                className={`px-3 py-1.5 transition ${view === "attachments" ? "bg-ink text-white" : "bg-white text-steel hover:bg-stone-50"}`}
              >
                Załączniki ({allAttachments.length})
              </button>
            </div>

            <div className="flex items-center gap-2">
              {view === "threads" && (
                <>
                  <label className="whitespace-nowrap text-xs text-steel" htmlFor="mail-order">
                    Wiadomości
                  </label>
                  <select
                    id="mail-order"
                    value={messageOrder}
                    onChange={(e) => setMessageOrder(e.target.value as ThreadOrder)}
                    className="input w-auto py-1 text-xs"
                  >
                    <option value="oldest">od najstarszych</option>
                    <option value="newest">od najnowszych</option>
                  </select>
                </>
              )}
              {view === "threads" && (
                <button
                  type="button"
                  onClick={() => setComposingNew((v) => !v)}
                  className="shrink-0 whitespace-nowrap rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50"
                >
                  {composingNew ? "Anuluj" : "Nowy temat"}
                </button>
              )}
            </div>
          </div>

          {view === "attachments" ? (
            <div className="mt-3">
              {allAttachments.length === 0 ? (
                <p className="rounded-xl2 border border-dashed border-stone-200 p-8 text-center text-sm text-steel">
                  W tej korespondencji nie ma załączników.
                </p>
              ) : (
                <ul className="grid gap-1.5">
                  {allAttachments.map((entry) => (
                    <li
                      key={entry.key}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl2 border border-stone-200 bg-white p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{entry.fileName}</p>
                        <p className="mt-0.5 truncate text-xs text-steel">
                          {entry.threadSubject} · {entry.fromLabel} · {formatDateTime(entry.date)}
                          {entry.size ? ` · ${formatBytes(entry.size)}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void download(entry.uid, entry.partId, entry.fileName)}
                        className="shrink-0 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50"
                      >
                        Pobierz
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              {composingNew && (
                <div className="mt-3 grid gap-2">
                  <input
                    className="input text-sm"
                    placeholder={`Temat — np. Oferta dla: ${clientName}`}
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                  />
                  <MailComposer
                    placeholder="Treść wiadomości…"
                    submitLabel="Wyślij"
                    sending={sending}
                    onSend={(payload) => send(payload, { subject: newSubject })}
                  />
                </div>
              )}

              <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                {/*
                  `content-start` jest tu konieczne: siatka rozciąga się na wysokość
                  sąsiedniej kolumny z wątkiem, a bez tego wiersze rosłyby razem z nią
                  i kafelki tematów miałyby różne odstępy przy dłuższych rozmowach.
                */}
                <ul className="grid min-w-0 content-start gap-1.5 lg:max-h-[32rem] lg:overflow-y-auto">
                  {threads.map((thread) => {
                    const active = thread.id === openThreadId;
                    const files = thread.messages.reduce((sum, m) => sum + m.attachments.length, 0);
                    return (
                      <li key={thread.id}>
                        <button
                          type="button"
                          onClick={() => setOpenThreadId(thread.id)}
                          className={`w-full rounded-xl2 border p-3 text-left transition ${
                            active ? "border-ink bg-ink/5" : "border-stone-200 bg-white hover:bg-stone-50"
                          }`}
                        >
                          <p className="truncate text-sm font-bold text-ink">{thread.subject}</p>
                          <p className="mt-0.5 truncate text-xs text-steel">
                            {thread.participants.join(", ") || clientEmail}
                          </p>
                          <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.7rem] text-stone-400">
                            <span className="rounded-full bg-stone-100 px-2 py-0.5 font-semibold">
                              {thread.messageCount} wiad.
                            </span>
                            {files > 0 && (
                              <span className="inline-flex items-center gap-1">
                                <IconPaperclip className="size-3" />
                                {files}
                              </span>
                            )}
                            <span>{formatDateTime(thread.lastMessageAt)}</span>
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {openThread && (
                  <div className="min-w-0 rounded-xl2 border border-stone-200 bg-stone-50/60 p-3">
                    <div className="flex items-center gap-2 border-b border-stone-200 pb-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-moss text-sm font-bold text-white">
                        {initials(openThread.participants[0] || clientName)}
                      </span>
                      <p className="min-w-0 truncate text-sm font-bold text-ink">{openThread.subject}</p>
                    </div>

                    <ul className="mt-3 grid gap-2.5 lg:max-h-[24rem] lg:overflow-y-auto">
                      {openThreadMessages.map((message) => (
                        <MessageBubble
                          key={`${message.uid}-${message.messageId ?? ""}`}
                          message={message}
                          onDownload={download}
                        />
                      ))}
                    </ul>

                    <div className="mt-3 border-t border-stone-200 pt-3">
                      <MailComposer
                        placeholder="Odpowiedz w tym wątku…"
                        submitLabel="Wyślij odpowiedź"
                        sending={sending}
                        onSend={(payload) => send(payload, { thread: openThread })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
