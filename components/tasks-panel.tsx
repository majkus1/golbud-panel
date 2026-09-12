"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DateInput } from "@/components/date-input";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOrg } from "@/components/org-context";
import { TaskDetailModal } from "@/components/task-detail-modal";
import { showToast } from "@/components/toast";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/domain";
import { formatDate, isDue } from "@/lib/format";
import { notify } from "@/lib/notify-client";
import { supabase } from "@/lib/supabase";
import type { CaseRow, CaseTask, OrgMemberProfile, TaskPriority, TaskStatus } from "@/lib/types";

type Props = {
  caseId?: string;
  filterPreset?: "active" | "overdue" | null;
  initialTaskId?: string | null;
  openDiscussion?: boolean;
};

type TaskAssignees = Record<string, string[]>;

const PRIORITY_TONE: Record<TaskPriority, string> = {
  niski: "bg-sky-100 text-sky-700",
  normalny: "bg-stone-100 text-stone-600",
  wysoki: "bg-amber-100 text-amber-800",
  pilne: "bg-red-100 text-red-700"
};

const STATUS_TONE: Record<TaskStatus, string> = {
  "do zrobienia": "bg-stone-100 text-stone-600",
  "w toku": "bg-sky-100 text-sky-700",
  zrobione: "bg-emerald-100 text-emerald-700",
  anulowane: "bg-stone-100 text-stone-400"
};

export function TasksPanel({ caseId, filterPreset, initialTaskId, openDiscussion }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organizationId, userId } = useOrg();
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", due_date: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [assigneesByTask, setAssigneesByTask] = useState<TaskAssignees>({});
  const [members, setMembers] = useState<OrgMemberProfile[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normalny");
  const [linkedCase, setLinkedCase] = useState(caseId || "");

  const [filterStatus, setFilterStatus] = useState<TaskStatus | "wszystkie">("wszystkie");
  const [filterAssignee, setFilterAssignee] = useState<string>("");
  const [filterMine, setFilterMine] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const [openTask, setOpenTask] = useState<CaseTask | null>(null);
  const [unreadByTask, setUnreadByTask] = useState<Record<string, number>>({});
  const [pinnedTaskId, setPinnedTaskId] = useState<string | null>(null);
  const deepLinkHandledRef = useRef(false);

  const computeUnread = useCallback(
    async (taskIds: string[]) => {
      if (!userId || taskIds.length === 0) {
        setUnreadByTask({});
        return;
      }
      const [{ data: cmts }, { data: reads }] = await Promise.all([
        supabase.from("case_task_comments").select("task_id, user_id, created_at").in("task_id", taskIds),
        supabase.from("case_task_reads").select("task_id, last_read_at").eq("user_id", userId).in("task_id", taskIds)
      ]);
      const lastRead = new Map<string, string>();
      for (const r of (reads || []) as { task_id: string; last_read_at: string }[]) lastRead.set(r.task_id, r.last_read_at);
      const map: Record<string, number> = {};
      for (const c of (cmts || []) as { task_id: string; user_id: string | null; created_at: string }[]) {
        if (c.user_id === userId) continue;
        const lr = lastRead.get(c.task_id);
        if (!lr || c.created_at > lr) map[c.task_id] = (map[c.task_id] || 0) + 1;
      }
      setUnreadByTask(map);
    },
    [userId]
  );

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    let q = supabase
      .from("case_tasks")
      .select("*")
      .eq("organization_id", organizationId)
      .order("status", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false });
    if (caseId) q = q.eq("case_id", caseId);

    const [{ data: t }, { data: m }, { data: c }] = await Promise.all([
      q,
      supabase.from("org_member_profiles").select("*").eq("organization_id", organizationId),
      caseId
        ? Promise.resolve({ data: [] as CaseRow[] })
        : supabase.from("cases").select("id,client_name,location,status").eq("organization_id", organizationId).order("created_at", { ascending: false })
    ]);

    const loadedTasks = (t || []) as CaseTask[];
    setTasks(loadedTasks);
    setMembers((m || []) as OrgMemberProfile[]);
    setCases((c || []) as CaseRow[]);

    if (loadedTasks.length > 0) {
      const { data: ta } = await supabase
        .from("case_task_assignees")
        .select("task_id, user_id")
        .in("task_id", loadedTasks.map((x) => x.id));
      const map: TaskAssignees = {};
      for (const row of (ta || []) as { task_id: string; user_id: string }[]) {
        (map[row.task_id] ??= []).push(row.user_id);
      }
      setAssigneesByTask(map);
      void computeUnread(loadedTasks.map((x) => x.id));
    } else {
      setAssigneesByTask({});
      setUnreadByTask({});
    }

    setLoading(false);
  }, [organizationId, caseId, computeUnread]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: nowy komentarz w dowolnym zadaniu podbija licznik nieprzeczytanych.
  useEffect(() => {
    if (!organizationId) return;
    const channel = supabase
      .channel(`tasks-unread-${organizationId}-${caseId || "all"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "case_task_comments", filter: `organization_id=eq.${organizationId}` },
        (payload) => {
          const c = payload.new as { task_id: string; user_id: string | null };
          if (c.user_id === userId) return;
          if (openTask?.id === c.task_id) return; // otwarte = czytane
          setUnreadByTask((prev) => ({ ...prev, [c.task_id]: (prev[c.task_id] || 0) + 1 }));
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId, caseId, userId, openTask?.id]);

  const openTaskModal = (t: CaseTask) => {
    setOpenTask(t);
    setUnreadByTask((prev) => ({ ...prev, [t.id]: 0 }));
  };

  const handleTaskRead = useCallback((id: string) => {
    setUnreadByTask((prev) => ({ ...prev, [id]: 0 }));
  }, []);

  useEffect(() => {
    if (!initialTaskId || loading || deepLinkHandledRef.current) return;
    const task = tasks.find((t) => t.id === initialTaskId);
    if (!task) return;

    deepLinkHandledRef.current = true;
    setPinnedTaskId(initialTaskId);

    if (openDiscussion) {
      setOpenTask(task);
      setUnreadByTask((prev) => ({ ...prev, [task.id]: 0 }));
    }

    window.setTimeout(() => {
      document.getElementById(`task-card-${initialTaskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);

    const params = new URLSearchParams(searchParams.toString());
    params.delete("task");
    params.delete("discussion");
    const qs = params.toString();
    const base = caseId ? `/cases/${caseId}` : "/tasks";
    router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
  }, [initialTaskId, openDiscussion, loading, tasks, searchParams, router, caseId]);

  const memberEmail = (id: string) => {
    const m = members.find((x) => x.user_id === id);
    return m?.email || "(użytkownik)";
  };

  const caseLabel = (id: string | null) => {
    if (!id) return null;
    const c = cases.find((x) => x.id === id);
    return c ? `${c.client_name}${c.location ? ` — ${c.location}` : ""}` : "Sprawa";
  };

  const add = async () => {
    if (!organizationId || !title.trim()) return;
    const { data: newTask, error } = await supabase
      .from("case_tasks")
      .insert({
        organization_id: organizationId,
        case_id: linkedCase || null,
        title: title.trim(),
        description: description.trim() || null,
        assignee_id: assignees[0] || null,
        due_date: dueDate || null,
        priority,
        status: "do zrobienia" as TaskStatus,
        created_by: userId
      })
      .select("id")
      .single();

    if (error) {
      showToast("Nie udało się dodać zadania", "error");
      return;
    }
    if (newTask && assignees.length > 0) {
      await supabase.from("case_task_assignees").insert(
        assignees.map((uid) => ({ task_id: newTask.id, user_id: uid }))
      );
      void notify({ type: "task_created", taskId: newTask.id });
    }
    setTitle("");
    setDescription("");
    setAssignees([]);
    setDueDate("");
    setPriority("normalny");
    if (!caseId) setLinkedCase("");
    setFormOpen(false);
    await load();
  };

  const updateTaskAssignees = async (taskId: string, newIds: string[]) => {
    await supabase.from("case_task_assignees").delete().eq("task_id", taskId);
    if (newIds.length > 0) {
      await supabase.from("case_task_assignees").insert(newIds.map((uid) => ({ task_id: taskId, user_id: uid })));
    }
    await supabase.from("case_tasks").update({ assignee_id: newIds[0] || null }).eq("id", taskId);
    await load();
  };

  const update = async (task: CaseTask, patch: Partial<CaseTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...patch } : t)));
    const { error } = await supabase
      .from("case_tasks")
      .update({ ...patch, completed_at: patch.status === "zrobione" ? new Date().toISOString() : task.completed_at })
      .eq("id", task.id);
    if (error) {
      showToast("Nie udało się zapisać", "error");
      await load();
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć zadanie?")) return;
    await supabase.from("case_tasks").delete().eq("id", id);
    await load();
  };

  /** Zapis edycji zadania. Status, priorytet i przypisanie mają własne kontrolki na karcie. */
  const saveTaskEdit = async (task: CaseTask) => {
    const title = editForm.title.trim();
    if (!title) {
      showToast("Tytuł zadania nie może być pusty", "error");
      return;
    }
    setSavingEdit(true);
    const { error } = await supabase
      .from("case_tasks")
      .update({
        title,
        description: editForm.description.trim() || null,
        due_date: editForm.due_date || null
      })
      .eq("id", task.id);
    setSavingEdit(false);
    if (error) {
      showToast("Nie udało się zapisać zmiany", "error");
      return;
    }
    setEditingId(null);
    await load();
  };

  const filtered = useMemo(() => {
    const list = tasks.filter((t) => {
      if (filterPreset === "active" && !["do zrobienia", "w toku"].includes(t.status)) return false;
      if (filterPreset === "overdue") {
        if (!(t.due_date && t.status !== "zrobione" && t.status !== "anulowane" && isDue(t.due_date))) return false;
      }
      const statusOk = filterStatus === "wszystkie" || t.status === filterStatus;
      const ids = assigneesByTask[t.id] || [];
      const assigneeOk = !filterAssignee || ids.includes(filterAssignee);
      const mineOk = !filterMine || ids.includes(userId || "") || t.created_by === userId;
      return statusOk && assigneeOk && mineOk;
    });
    if (pinnedTaskId && !list.some((t) => t.id === pinnedTaskId)) {
      const pinned = tasks.find((t) => t.id === pinnedTaskId);
      if (pinned) return [pinned, ...list];
    }
    return list;
  }, [tasks, assigneesByTask, filterStatus, filterAssignee, filterMine, userId, filterPreset, pinnedTaskId]);

  if (!organizationId) return null;

  return (
    <div className="grid min-w-0 gap-4">
      {filterPreset && !caseId && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-moss/30 bg-moss/10 px-4 py-3 text-sm">
          <p className="text-ink">
            <span className="font-semibold">Filtr z pulpitu:</span>{" "}
            {filterPreset === "active" ? "Aktywne zadania (do zrobienia / w toku)" : "Zadania przeterminowane"}
          </p>
          <button type="button" onClick={() => router.push("/tasks")} className="font-semibold text-moss hover:underline">
            Pokaż wszystkie zadania
          </button>
        </div>
      )}

      {!formOpen ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          aria-expanded={false}
          className="flex w-full items-center justify-center gap-2 rounded-xl2 border border-dashed border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-ink shadow-card transition hover:border-moss/60 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-auto"
        >
          <span className="text-lg leading-none">+</span> Nowe zadanie
        </button>
      ) : (
      <section className="grid gap-3 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-ink">Nowe zadanie</h2>
          <button
            type="button"
            onClick={() => setFormOpen(false)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-steel hover:bg-stone-100 hover:text-ink"
          >
            Zwiń
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-ink md:col-span-2">
            Co trzeba zrobić? <span className="text-rose-500" aria-hidden>*</span>
            <input className="input text-sm font-normal" placeholder="np. Zadzwonić do klienta w sprawie terminu" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-ink">
            Termin
            <DateInput className="text-sm font-normal" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-ink">
            Priorytet
            <select className="input text-sm font-normal" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          {!caseId && (
            <label className="grid gap-1 text-xs font-semibold text-ink md:col-span-2">
              Powiązana sprawa
              <select className="input text-sm font-normal" value={linkedCase} onChange={(e) => setLinkedCase(e.target.value)}>
                <option value="">— bez powiązania ze sprawą —</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}{c.location ? ` · ${c.location}` : ""}</option>
                ))}
              </select>
            </label>
          )}
          <div className="md:col-span-2">
            <p className="mb-1 text-xs font-semibold text-ink">Przypisz osoby <span className="font-normal text-steel">(można kilka)</span></p>
            <div className="max-h-28 overflow-y-auto rounded-lg border border-stone-300 bg-white p-2 space-y-0.5">
              {members.length === 0 && <p className="text-xs text-steel px-1">Brak członków zespołu.</p>}
              {members.map((m) => (
                <label key={m.user_id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-stone-50">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-moss"
                    checked={assignees.includes(m.user_id)}
                    onChange={(e) => setAssignees(e.target.checked ? [...assignees, m.user_id] : assignees.filter((id) => id !== m.user_id))}
                  />
                  {m.email || "(brak email)"}
                  <span className="text-stone-400">({m.role})</span>
                </label>
              ))}
            </div>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-ink md:col-span-2">
            Opis / kontekst <span className="font-normal text-steel">(opcjonalnie)</span>
            <textarea
              className="input text-sm font-normal"
              placeholder="Dodatkowe szczegóły, ustalenia, numer telefonu…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => void add()} disabled={!title.trim()} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
            Dodaj zadanie
          </button>
          <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50">
            Anuluj
          </button>
        </div>
      </section>
      )}

      <section className="grid min-w-0 gap-3 rounded-lg bg-white p-4 shadow-panel">
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <select className="input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as TaskStatus | "wszystkie")}>
            <option value="wszystkie">wszystkie statusy</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
            <option value="">wszystkie osoby</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.email || "(brak email)"}</option>)}
          </select>
          <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${filterMine ? "border-moss bg-moss/10 text-moss-dark" : "border-stone-300 text-steel hover:bg-stone-50"}`}>
            <input type="checkbox" checked={filterMine} onChange={(e) => setFilterMine(e.target.checked)} className="h-4 w-4 accent-moss" />
            tylko moje
          </label>
        </div>

        {loading ? (
          <p className="text-sm text-steel">Wczytywanie...</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl2 border border-dashed border-stone-300 p-6 text-center text-sm text-steel">
            Brak zadań spełniających filtry.
          </p>
        ) : (
          <ul className="grid min-w-0 gap-3 text-sm">
            {filtered.map((t) => {
              const overdue = !!(t.due_date && t.status !== "zrobione" && t.status !== "anulowane" && isDue(t.due_date));
              const done = t.status === "zrobione";
              const cancelled = t.status === "anulowane";
              const taskAssigneeIds = assigneesByTask[t.id] || [];
              const unread = unreadByTask[t.id] || 0;
              const stripe = done ? "bg-emerald-400" : cancelled ? "bg-stone-300" : overdue ? "bg-red-500" : t.status === "w toku" ? "bg-sky-400" : "bg-stone-200";
              const cardTone = done
                ? "border-emerald-200 bg-emerald-50/40"
                : overdue
                  ? "border-red-200 bg-red-50/50"
                  : "border-stone-200 bg-white";
              const assigneeLabel = taskAssigneeIds.length === 0
                ? "Brak przypisania"
                : taskAssigneeIds.length === 1
                  ? memberEmail(taskAssigneeIds[0])
                  : `${taskAssigneeIds.length} osoby`;

              const stop = (e: React.SyntheticEvent) => e.stopPropagation();

              // W trybie edycji karta przestaje być klikalna — inaczej każde kliknięcie
              // w pole tekstowe otwierałoby dyskusję zadania.
              if (editingId === t.id) {
                return (
                  <li key={t.id} id={`task-card-${t.id}`} className="min-w-0 scroll-mt-24">
                    <article className={`min-w-0 rounded-xl2 border p-3 shadow-card sm:p-4 ${cardTone}`}>
                      <div className="grid gap-2">
                        <label className="grid gap-1 text-xs font-semibold text-ink">
                          Tytuł
                          <input
                            className="input text-sm font-normal"
                            value={editForm.title}
                            onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-semibold text-ink">
                          Opis
                          <textarea
                            className="input min-h-20 text-sm font-normal"
                            value={editForm.description}
                            onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                            placeholder="Szczegóły, ustalenia…"
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-semibold text-ink sm:max-w-56">
                          Termin
                          <DateInput
                            className="font-normal"
                            value={editForm.due_date}
                            onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))}
                          />
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={savingEdit}
                            onClick={() => void saveTaskEdit(t)}
                            className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-moss disabled:opacity-50"
                          >
                            {savingEdit ? "Zapis…" : "Zapisz"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50"
                          >
                            Anuluj
                          </button>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              }

              return (
                <li key={t.id} id={`task-card-${t.id}`} className="min-w-0 scroll-mt-24">
                  <article
                    role="button"
                    tabIndex={0}
                    onClick={() => openTaskModal(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openTaskModal(t);
                      }
                    }}
                    className={`group relative min-w-0 cursor-pointer overflow-hidden rounded-xl2 border shadow-card transition hover:border-moss/40 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss ${cardTone} ${cancelled ? "opacity-60" : ""}`}
                    aria-label={`Otwórz dyskusję: ${t.title}`}
                  >
                    <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden />

                    <div className="min-w-0 p-3 pl-4 sm:p-4 sm:pl-5">
                      {/* Nagłówek: checkbox + tytuł + dyskusja */}
                      <div className="flex min-w-0 items-start gap-2.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            stop(e);
                            void update(t, { status: done ? "do zrobienia" : "zrobione" });
                          }}
                          aria-label={done ? "Oznacz jako niewykonane" : "Oznacz jako zrobione"}
                          aria-pressed={done}
                          className={`relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
                            done ? "border-emerald-500 bg-emerald-500 text-white" : "border-stone-300 text-transparent hover:border-moss"
                          }`}
                        >
                          ✓
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <h3 className={`min-w-0 break-words text-base font-semibold leading-snug text-ink group-hover:text-moss ${done || cancelled ? "line-through opacity-70" : ""}`}>
                              {t.title}
                            </h3>
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-stone-100 px-2 py-1 text-[0.65rem] font-semibold text-steel group-hover:bg-moss/15 group-hover:text-moss">
                              Dyskusja
                              {unread > 0 && (
                                <span className="inline-flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[0.6rem] font-bold leading-none text-white">
                                  {unread > 9 ? "9+" : unread}
                                </span>
                              )}
                            </span>
                          </div>

                          {t.description && (
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-steel">{t.description}</p>
                          )}
                        </div>
                      </div>

                      {/* Meta: termin, osoby, sprawa */}
                      <div className="mt-2.5 flex min-w-0 flex-wrap gap-1.5 pl-9 text-xs sm:pl-10">
                        {overdue && (
                          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 font-bold uppercase tracking-wide text-red-700">
                            Po terminie
                          </span>
                        )}
                        <span className={`inline-flex max-w-full items-center rounded-full bg-stone-100 px-2 py-0.5 font-medium ${overdue ? "text-red-700" : "text-steel"}`}>
                          {t.due_date ? formatDate(t.due_date) : "Bez terminu"}
                        </span>
                        <span className="inline-flex max-w-full truncate rounded-full bg-stone-100 px-2 py-0.5 font-medium text-steel">
                          {assigneeLabel}
                        </span>
                        {!caseId && t.case_id && (
                          <Link
                            href={`/cases/${t.case_id}`}
                            onClick={stop}
                            className="inline-flex max-w-full min-w-0 truncate rounded-full bg-moss/10 px-2 py-0.5 font-medium text-moss-dark hover:bg-moss/20"
                          >
                            {caseLabel(t.case_id) || "Sprawa"}
                          </Link>
                        )}
                      </div>

                      {/* Szybka edycja — pełna szerokość na mobile */}
                      <div
                        className="relative z-10 mt-3 grid min-w-0 grid-cols-1 gap-2 border-t border-stone-200/80 pt-3 pl-9 sm:grid-cols-3 sm:pl-10"
                        onClick={stop}
                        onKeyDown={stop}
                      >
                        <label className="grid min-w-0 gap-0.5">
                          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-stone-400">Status</span>
                          <select
                            value={t.status}
                            onChange={(e) => void update(t, { status: e.target.value as TaskStatus })}
                            className={`w-full min-w-0 rounded-lg border-0 px-2.5 py-2 text-xs font-semibold ring-1 ring-inset ring-stone-200 focus:ring-2 focus:ring-moss ${STATUS_TONE[t.status]}`}
                          >
                            {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                        <label className="grid min-w-0 gap-0.5">
                          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-stone-400">Priorytet</span>
                          <select
                            value={t.priority}
                            onChange={(e) => void update(t, { priority: e.target.value as TaskPriority })}
                            className={`w-full min-w-0 rounded-lg border-0 px-2.5 py-2 text-xs font-semibold ring-1 ring-inset ring-stone-200 focus:ring-2 focus:ring-moss ${PRIORITY_TONE[t.priority]}`}
                          >
                            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </label>
                        <div className="grid min-w-0 gap-0.5">
                          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-stone-400">Przypisanie</span>
                          <AssigneePopover
                            assigneeIds={taskAssigneeIds}
                            members={members}
                            memberEmail={memberEmail}
                            onUpdate={(newIds) => void updateTaskAssignees(t.id, newIds)}
                          />
                        </div>
                      </div>

                      <div className="mt-2 flex justify-end gap-1 pl-9 sm:pl-10">
                        <button
                          type="button"
                          onClick={(e) => {
                            stop(e);
                            setEditingId(t.id);
                            setEditForm({
                              title: t.title,
                              description: t.description || "",
                              due_date: t.due_date || ""
                            });
                          }}
                          aria-label="Edytuj zadanie"
                          className="relative z-10 rounded-lg px-2 py-1 text-xs font-medium text-steel hover:bg-stone-100 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                        >
                          Edytuj
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            stop(e);
                            void remove(t.id);
                          }}
                          aria-label="Usuń zadanie"
                          className="relative z-10 rounded-lg px-2 py-1 text-xs font-medium text-rose-500 hover:bg-rose-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                        >
                          Usuń
                        </button>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {openTask && (
        <TaskDetailModal
          task={openTask}
          organizationId={organizationId}
          userId={userId || ""}
          members={members}
          onClose={() => setOpenTask(null)}
          onRead={handleTaskRead}
        />
      )}
    </div>
  );
}

function AssigneePopover({
  assigneeIds,
  members,
  memberEmail,
  onUpdate,
  className = ""
}: {
  assigneeIds: string[];
  members: OrgMemberProfile[];
  memberEmail: (id: string) => string;
  onUpdate: (ids: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const label = assigneeIds.length === 0
    ? "Brak przypisania"
    : assigneeIds.length === 1
      ? memberEmail(assigneeIds[0])
      : `${assigneeIds.length} osoby`;

  useEffect(() => setMounted(true), []);

  const updatePosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const menuWidth = Math.max(rect.width, 224);
    const menuHeight = menuRef.current?.offsetHeight ?? 180;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(menuWidth, vw - margin * 2);

    let left = rect.left;
    left = Math.max(margin, Math.min(left, vw - width - margin));

    let top = rect.bottom + 4;
    if (top + menuHeight > vh - margin) {
      top = rect.top - menuHeight - 4;
    }
    top = Math.max(margin, top);

    setPos({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(raf);
  }, [open, members.length, assigneeIds.length, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onReposition = () => updatePosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menu =
    open && mounted
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? 8,
              width: pos?.width ?? 224,
              zIndex: 9999,
              visibility: pos ? "visible" : "hidden"
            }}
            className="rounded-lg border border-stone-200 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="max-h-40 space-y-0.5 overflow-y-auto p-2">
              {members.map((m) => (
                <label key={m.user_id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-stone-50">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 accent-moss"
                    checked={assigneeIds.includes(m.user_id)}
                    onChange={(e) => {
                      const newIds = e.target.checked
                        ? [...assigneeIds, m.user_id]
                        : assigneeIds.filter((id) => id !== m.user_id);
                      onUpdate(newIds);
                    }}
                  />
                  <span className="min-w-0 truncate">{m.email || "(brak)"}</span>
                </label>
              ))}
            </div>
            <div className="border-t border-stone-100 p-2">
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-steel hover:text-ink">
                Zamknij
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div className={`relative min-w-0 text-xs ${className}`}>
        <button
          ref={buttonRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="flex w-full min-w-0 items-center gap-1.5 truncate rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-left text-xs font-medium text-ink hover:bg-stone-50"
        >
          <span className="shrink-0 text-stone-400">Osoby</span>
          <span className="min-w-0 truncate">{label}</span>
        </button>
      </div>
      {menu}
    </>
  );
}
