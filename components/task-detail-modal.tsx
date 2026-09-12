"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showToast } from "@/components/toast";
import { formatDate } from "@/lib/format";
import { notify } from "@/lib/notify-client";
import { supabase } from "@/lib/supabase";
import type { CaseTask, CaseTaskComment, CaseTaskCommentAttachment, OrgMemberProfile, TaskPriority } from "@/lib/types";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const PRIORITY_TONE: Record<TaskPriority, string> = {
  niski: "bg-sky-100 text-sky-700",
  normalny: "bg-stone-100 text-stone-600",
  wysoki: "bg-amber-100 text-amber-800",
  pilne: "bg-red-100 text-red-700"
};

type Props = {
  task: CaseTask;
  organizationId: string;
  userId: string;
  members: OrgMemberProfile[];
  onClose: () => void;
  /** Wywoływane po oznaczeniu wątku jako przeczytany (do wyzerowania licznika w liście). */
  onRead?: (taskId: string) => void;
};

function PaperclipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function TaskDetailModal({ task, organizationId, userId, members, onClose, onRead }: Props) {
  const [comments, setComments] = useState<CaseTaskComment[]>([]);
  const [attByComment, setAttByComment] = useState<Record<string, CaseTaskCommentAttachment[]>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const memberEmail = useCallback(
    (id: string | null) => {
      if (!id) return "(system)";
      if (id === userId) return "Ty";
      return members.find((m) => m.user_id === id)?.email || "(użytkownik)";
    },
    [members, userId]
  );

  const markRead = useCallback(async () => {
    await supabase
      .from("case_task_reads")
      .upsert({ organization_id: organizationId, task_id: task.id, user_id: userId, last_read_at: new Date().toISOString() });
    onReadRef.current?.(task.id);
  }, [organizationId, task.id, userId]);

  const refreshAttachments = useCallback(async () => {
    const { data } = await supabase
      .from("case_task_comment_attachments")
      .select("*")
      .eq("task_id", task.id)
      .order("created_at");
    const list = (data || []) as CaseTaskCommentAttachment[];
    const map: Record<string, CaseTaskCommentAttachment[]> = {};
    for (const a of list) (map[a.comment_id] ??= []).push(a);
    setAttByComment(map);

    const images = list.filter((a) => a.mime_type?.startsWith("image/"));
    if (images.length > 0) {
      const { data: signed } = await supabase.storage
        .from("case-attachments")
        .createSignedUrls(images.map((a) => a.storage_path), 3600);
      if (signed) {
        const u: Record<string, string> = {};
        signed.forEach((s, i) => {
          if (s.signedUrl) u[images[i].id] = s.signedUrl;
        });
        setUrls((prev) => ({ ...prev, ...u }));
      }
    }
  }, [task.id]);

  // Ładowanie tylko przy otwarciu / zmianie zadania — bez zależności od onRead (unika pętli renderów).
  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("case_task_comments")
        .select("*")
        .eq("task_id", task.id)
        .order("created_at");
      if (!active) return;
      setComments((data || []) as CaseTaskComment[]);
      await refreshAttachments();
      if (!active) return;
      setLoading(false);
      await markRead();
    })();

    return () => {
      active = false;
    };
  }, [task.id, refreshAttachments, markRead]);

  // Realtime: nowe komentarze w tym zadaniu pojawiają się na żywo.
  useEffect(() => {
    const channel = supabase
      .channel(`task-comments-${task.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "case_task_comments", filter: `task_id=eq.${task.id}` },
        (payload) => {
          const c = payload.new as CaseTaskComment;
          setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
          void refreshAttachments();
          void markRead();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [task.id, refreshAttachments, markRead]);

  // Auto-scroll na dół wątku przy nowych wiadomościach.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [comments]);

  // Escape zamyka.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    setErr("");
    for (const f of picked) {
      if (f.size > MAX_UPLOAD_BYTES) {
        setErr(`Plik „${f.name}" za duży (max 15 MB).`);
        return;
      }
      if (!ALLOWED_MIME.has(f.type)) {
        setErr("Dozwolone: JPG, PNG, WebP, PDF.");
        return;
      }
    }
    setFiles((prev) => [...prev, ...picked]);
  };

  const send = async () => {
    if (!body.trim() && files.length === 0) return;
    setSending(true);
    setErr("");
    const { data: inserted, error } = await supabase
      .from("case_task_comments")
      .insert({ organization_id: organizationId, task_id: task.id, user_id: userId, body: body.trim() })
      .select("*")
      .single();
    if (error || !inserted) {
      setErr(error?.message || "Nie udało się wysłać.");
      setSending(false);
      return;
    }
    const comment = inserted as CaseTaskComment;

    for (const file of files) {
      const safe = file.name.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]+/g, "_").slice(0, 120);
      const path = `${organizationId}/tasks/${task.id}/${crypto.randomUUID()}_${safe}`;
      const { error: upErr } = await supabase.storage
        .from("case-attachments")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        setErr(upErr.message);
        continue;
      }
      await supabase.from("case_task_comment_attachments").insert({
        organization_id: organizationId,
        comment_id: comment.id,
        task_id: task.id,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size
      });
    }

    setComments((prev) => (prev.some((x) => x.id === comment.id) ? prev : [...prev, comment]));
    await refreshAttachments();
    await markRead();
    void notify({ type: "task_comment", commentId: comment.id });
    setBody("");
    setFiles([]);
    setSending(false);
  };

  const removeComment = async (id: string) => {
    if (!confirm("Usunąć komentarz?")) return;
    const { error } = await supabase.from("case_task_comments").delete().eq("id", id);
    if (error) {
      showToast("Nie udało się usunąć", "error");
      return;
    }
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  const initial = (id: string | null) => (memberEmail(id)[0] || "?").toUpperCase();

  const sorted = useMemo(() => [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at)), [comments]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-panel sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Nagłówek */}
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide ${PRIORITY_TONE[task.priority]}`}>
                {task.priority}
              </span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[0.7rem] font-semibold text-steel">{task.status}</span>
            </div>
            <h2 className="mt-2 text-lg font-bold leading-snug text-ink">{task.title}</h2>
            {task.description && <p className="mt-1 text-sm leading-relaxed text-steel">{task.description}</p>}
            {task.due_date && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-stone-50 px-2.5 py-1 text-xs font-medium text-steel">
                <span aria-hidden>📅</span> Termin: {formatDate(task.due_date)}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="shrink-0 rounded-lg px-2.5 py-1.5 text-steel hover:bg-stone-100 hover:text-ink">
            ✕
          </button>
        </div>

        {/* Wątek */}
        <div ref={threadRef} className="min-h-[200px] flex-1 space-y-3 overflow-y-auto bg-stone-50/60 px-4 py-4 sm:min-h-[240px] sm:px-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-steel">Wczytywanie dyskusji…</p>
          ) : sorted.length === 0 ? (
            <p className="rounded-xl2 border border-dashed border-stone-300 bg-white p-6 text-center text-sm text-steel">
              Brak komentarzy. Rozpocznij dyskusję — dodaj wiadomość lub zdjęcie z budowy.
            </p>
          ) : (
            sorted.map((c) => {
              const mine = c.user_id === userId;
              const atts = attByComment[c.id] || [];
              return (
                <div key={c.id} className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-moss text-xs font-bold text-white">
                    {initial(c.user_id)}
                  </span>
                  <div className={`min-w-0 max-w-[80%] ${mine ? "items-end text-right" : ""}`}>
                    <div className={`inline-block rounded-2xl px-3.5 py-2 text-left text-sm shadow-card ${mine ? "bg-moss/15 text-ink" : "bg-white text-ink"}`}>
                      <p className="text-[0.7rem] font-semibold text-steel">
                        {memberEmail(c.user_id)} · {new Date(c.created_at).toLocaleString("pl-PL")}
                      </p>
                      {c.body && <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>}
                      {atts.length > 0 && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {atts.map((a) => {
                            const isImg = a.mime_type?.startsWith("image/");
                            return isImg && urls[a.id] ? (
                              <a key={a.id} href={urls[a.id]} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-stone-200">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={urls[a.id]} alt={a.file_name} className="h-24 w-full object-cover" />
                              </a>
                            ) : (
                              <a
                                key={a.id}
                                href={urls[a.id] || "#"}
                                onClick={async (e) => {
                                  if (urls[a.id]) return;
                                  e.preventDefault();
                                  const { data } = await supabase.storage.from("case-attachments").createSignedUrl(a.storage_path, 3600);
                                  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
                                }}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-xs font-medium text-moss hover:bg-stone-50"
                              >
                                📄 <span className="min-w-0 truncate">{a.file_name}</span>
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {mine && (
                      <button type="button" onClick={() => void removeComment(c.id)} className="mt-0.5 block text-[0.65rem] text-stone-400 hover:text-rose-500">
                        usuń
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pole nowej wiadomości */}
        <div className="border-t border-stone-200 px-4 py-3 sm:px-5">
          {err && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-600">{err}</p>}
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-ink">
                  {f.type.startsWith("image/") ? "🖼" : "📄"} <span className="max-w-[140px] truncate">{f.name}</span>
                  <button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Usuń plik" className="text-stone-400 hover:text-rose-500">
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <label
              className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-stone-300 text-steel transition hover:bg-stone-50 hover:text-ink"
              title="Dodaj zdjęcie / plik"
              aria-label="Dodaj załącznik"
            >
              <PaperclipIcon />
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={onPickFiles} />
            </label>
            <textarea
              className="input min-h-[44px] max-h-32 flex-1 resize-y py-2 text-sm font-normal"
              placeholder="Napisz komentarz…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || (!body.trim() && files.length === 0)}
              className="h-10 shrink-0 rounded-lg bg-ink px-4 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50"
            >
              {sending ? "…" : "Wyślij"}
            </button>
          </div>
          <p className="mt-1 text-[0.65rem] text-stone-400">Ctrl/⌘ + Enter wysyła. Zdjęcia/PDF do 15 MB.</p>
        </div>
      </div>
    </div>
  );
}
