"use client";

import { useEffect, useState } from "react";
import { DateInput } from "@/components/date-input";
import { showToast } from "@/components/toast";
import { useConfirm } from "@/components/use-confirm";
import { ENTRY_PRIORITY_OPTIONS, PRIORITY_TONE_CLASSES, formatTime, priorityTone } from "@/lib/calendar";
import { supabase } from "@/lib/supabase";
import type { CaseTask, TaskPriority } from "@/lib/types";
import type { CalendarCaseOption } from "@/components/calendar/use-calendar-data";

type Draft = {
  title: string;
  date: string;
  time: string;
  priority: TaskPriority;
  caseId: string;
  note: string;
};

export type CalendarEntryTarget = { mode: "new"; date: string } | { mode: "edit"; entry: CaseTask };

/**
 * Dodanie lub poprawienie wpisu w kalendarzu firmy (data, godzina, tytuł, priorytet,
 * opcjonalnie sprawa i notatka). Wpis to wiersz `case_tasks` z `kind = 'wpis'` —
 * nie pojawia się na liście „Zadania pracowników”.
 */
export function CalendarEntryDialog({
  target,
  organizationId,
  userId,
  canDelete,
  cases,
  onClose,
  onSaved
}: {
  target: CalendarEntryTarget | null;
  organizationId: string;
  userId: string;
  /** Usuwa autor wpisu albo właściciel/biuro/kierownik (RLS pilnuje tego samego). */
  canDelete: boolean;
  cases: CalendarCaseOption[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<Draft>({ title: "", date: "", time: "", priority: "normalny", caseId: "", note: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    if (target.mode === "new") {
      setDraft({ title: "", date: target.date, time: "", priority: "normalny", caseId: "", note: "" });
    } else {
      const e = target.entry;
      setDraft({
        title: e.title,
        date: e.due_date || "",
        time: formatTime(e.due_time) || "",
        priority: e.priority === "niski" ? "normalny" : e.priority,
        caseId: e.case_id || "",
        note: e.description || ""
      });
    }
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  if (!target) return null;

  const editing = target.mode === "edit" ? target.entry : null;
  const done = editing?.status === "zrobione";

  const save = async () => {
    const title = draft.title.trim();
    if (!title) {
      showToast("Wpisz, czego dotyczy wpis", "error");
      return;
    }
    if (!draft.date) {
      showToast("Wybierz datę", "error");
      return;
    }
    setSaving(true);
    const fields = {
      title,
      due_date: draft.date,
      due_time: draft.time || null,
      priority: draft.priority,
      case_id: draft.caseId || null,
      description: draft.note.trim() || null
    };
    const { error } = editing
      ? await supabase.from("case_tasks").update(fields).eq("id", editing.id)
      : await supabase.from("case_tasks").insert({ ...fields, organization_id: organizationId, kind: "wpis", status: "do zrobienia", created_by: userId });
    setSaving(false);
    if (error) {
      showToast("Nie udało się zapisać wpisu", "error");
      return;
    }
    showToast(editing ? "Zapisano zmiany" : "Dodano wpis do kalendarza");
    await onSaved();
    onClose();
  };

  const toggleDone = async () => {
    if (!editing) return;
    setSaving(true);
    const { error } = await supabase
      .from("case_tasks")
      .update(done ? { status: "do zrobienia", completed_at: null } : { status: "zrobione", completed_at: new Date().toISOString() })
      .eq("id", editing.id);
    setSaving(false);
    if (error) {
      showToast("Nie udało się zapisać", "error");
      return;
    }
    await onSaved();
    onClose();
  };

  const remove = async () => {
    if (!editing) return;
    const ok = await confirm({ title: "Usunąć wpis?", message: `„${editing.title}” zniknie z kalendarza.` });
    if (!ok) return;
    const { error, count } = await supabase.from("case_tasks").delete({ count: "exact" }).eq("id", editing.id);
    if (error || count === 0) {
      showToast("Nie udało się usunąć wpisu", "error");
      return;
    }
    showToast("Usunięto wpis");
    await onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 px-4 py-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="calendar-entry-title" className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-panel">
        <h2 id="calendar-entry-title" className="text-lg font-bold text-ink">
          {editing ? "Wpis w kalendarzu" : "Nowy wpis w kalendarzu"}
        </h2>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm font-semibold text-ink">
            Co i gdzie
            <input
              className="input"
              autoFocus
              value={draft.title}
              placeholder="np. Pomiar u klienta, spotkanie z dostawcą"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-ink">
              Data
              <DateInput value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <span>
                Godzina <span className="text-xs font-normal text-steel">(opcjonalnie)</span>
              </span>
              <input type="time" className="input" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
            </label>
          </div>
          <fieldset className="grid gap-1">
            <legend className="text-sm font-semibold text-ink">Ważność</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {ENTRY_PRIORITY_OPTIONS.map((option) => {
                const tone = PRIORITY_TONE_CLASSES[priorityTone(option.value)];
                const active = draft.priority === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDraft({ ...draft, priority: option.value })}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                      active ? `${tone.chip} border-current ring-1 ring-current` : "border-stone-200 text-ink hover:bg-stone-50"
                    }`}
                  >
                    <span className={`size-2.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="grid gap-1 text-sm font-semibold text-ink">
            <span>
              Sprawa <span className="text-xs font-normal text-steel">(opcjonalnie)</span>
            </span>
            <select className="input" value={draft.caseId} onChange={(e) => setDraft({ ...draft, caseId: e.target.value })}>
              <option value="">— bez sprawy —</option>
              {/* Wpis podpięty do sprawy, której użytkownik już nie widzi, zachowuje powiązanie. */}
              {draft.caseId && !cases.some((c) => c.id === draft.caseId) ? <option value={draft.caseId}>(sprawa niedostępna)</option> : null}
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.client_name}
                  {c.location ? ` — ${c.location}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-ink">
            <span>
              Notatka <span className="text-xs font-normal text-steel">(opcjonalnie)</span>
            </span>
            <textarea className="input min-h-[72px]" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {editing && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void toggleDone()}
                className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold text-moss hover:bg-moss/10 disabled:opacity-60"
              >
                {done ? "Cofnij „wykonane”" : "Oznacz jako wykonane"}
              </button>
            )}
            {editing && canDelete && (
              <button type="button" disabled={saving} onClick={() => void remove()} className="rounded-md px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                Usuń
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-ink hover:bg-stone-100 disabled:opacity-60">
              Anuluj
            </button>
            <button type="button" onClick={() => void save()} disabled={saving} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-moss disabled:opacity-60">
              {saving ? "Zapisywanie…" : editing ? "Zapisz" : "Dodaj wpis"}
            </button>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
