"use client";

import { DateInput } from "@/components/date-input";
import { useState } from "react";
import { showToast } from "@/components/toast";
import { useConfirm } from "@/components/use-confirm";
import { formatDate, isDue } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Reminder } from "@/lib/types";

type Draft = { id: string; title: string; date: string; note: string };

/**
 * Przypomnienia o kontakcie z klientem. Poza dodawaniem i oznaczaniem jako wykonane
 * można je poprawić (tytuł, data, notatka), usunąć i cofnąć „wykonane” kliknięte omyłkowo —
 * wcześniej żadnej z tych rzeczy nie dało się zrobić.
 */
export function RemindersSection({
  caseId,
  organizationId,
  items,
  onChange
}: {
  caseId: string;
  organizationId: string;
  items: Reminder[];
  onChange: () => Promise<void>;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [title, setTitle] = useState("Kontakt z klientem");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);

  const add = async () => {
    if (!date) return;
    const { error } = await supabase.from("reminders").insert({
      organization_id: organizationId,
      case_id: caseId,
      remind_at: date,
      title: title.trim() || "Przypomnienie",
      note: note.trim() || null
    });
    if (error) {
      showToast("Nie udało się dodać przypomnienia", "error");
      return;
    }
    setNote("");
    await onChange();
  };

  const setCompleted = async (id: string, completed: boolean) => {
    const { error } = await supabase
      .from("reminders")
      .update({ completed_at: completed ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) {
      showToast("Nie udało się zapisać", "error");
      return;
    }
    if (!completed) showToast("Przywrócono przypomnienie");
    await onChange();
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.date) {
      showToast("Wybierz datę przypomnienia", "error");
      return;
    }
    const { error } = await supabase
      .from("reminders")
      .update({ title: editing.title.trim() || "Przypomnienie", remind_at: editing.date, note: editing.note.trim() || null })
      .eq("id", editing.id);
    if (error) {
      showToast("Nie udało się zapisać zmian", "error");
      return;
    }
    setEditing(null);
    showToast("Zapisano");
    await onChange();
  };

  const remove = async (r: Reminder) => {
    const ok = await confirm({ title: "Usunąć przypomnienie?", message: `„${r.title}” z dnia ${formatDate(r.remind_at)} zniknie z listy i z kalendarza.` });
    if (!ok) return;
    const { error } = await supabase.from("reminders").delete().eq("id", r.id);
    if (error) {
      showToast("Nie udało się usunąć przypomnienia", "error");
      return;
    }
    showToast("Usunięto przypomnienie");
    await onChange();
  };

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <h2 className="text-lg font-bold text-ink">Przypomnienia o kontakcie</h2>
      <div className="mt-4 grid gap-3 rounded-xl2 bg-stone-50 p-4 md:grid-cols-4">
        <input className="input" placeholder="Tytuł" value={title} onChange={(e) => setTitle(e.target.value)} />
        <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="input md:col-span-2" placeholder="Notatka (opcjonalnie)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" onClick={add} disabled={!date} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-moss disabled:opacity-50 sm:px-4 sm:py-2.5 sm:text-sm md:col-span-4">
          <span className="sm:hidden">+ Przypomnienie</span>
          <span className="hidden sm:inline">Dodaj przypomnienie</span>
        </button>
      </div>
      <ul className="mt-5 grid gap-2.5 text-sm">
        {items.map((r) => {
          const overdue = !r.completed_at && isDue(r.remind_at);
          const stripe = r.completed_at ? "bg-emerald-400" : overdue ? "bg-amber-400" : "bg-stone-200";
          const isEditing = editing?.id === r.id;
          return (
            <li
              key={r.id}
              className={`relative overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card ${
                r.completed_at ? "border-stone-200 bg-stone-50/60" : overdue ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-white"
              }`}
            >
              <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden />
              {isEditing && editing ? (
                <div className="grid gap-2 md:grid-cols-4">
                  <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} aria-label="Tytuł" />
                  <DateInput value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} aria-label="Data" />
                  <input className="input md:col-span-2" value={editing.note} placeholder="Notatka" onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
                  <div className="flex gap-2 md:col-span-4">
                    <button type="button" onClick={() => void saveEdit()} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-moss">
                      Zapisz
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50">
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`font-semibold text-ink ${r.completed_at ? "line-through opacity-70" : ""}`}>{r.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-steel">
                      <span className={overdue ? "font-semibold text-amber-800" : ""}>{formatDate(r.remind_at)}</span>
                      {r.note ? <span>— {r.note}</span> : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {r.completed_at ? (
                      <>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[0.7rem] font-semibold text-emerald-700">
                          ✓ {new Date(r.completed_at).toLocaleDateString("pl-PL")}
                        </span>
                        <button type="button" onClick={() => void setCompleted(r.id, false)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-steel hover:bg-stone-100 hover:text-ink">
                          Cofnij
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => void setCompleted(r.id, true)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-moss hover:bg-moss/10">
                        Oznacz jako wykonane
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing({ id: r.id, title: r.title, date: (r.remind_at || "").slice(0, 10), note: r.note || "" })}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-steel hover:bg-stone-100 hover:text-ink"
                    >
                      Edytuj
                    </button>
                    <button type="button" onClick={() => void remove(r)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50">
                      Usuń
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-steel">Brak przypomnień.</li>
        )}
      </ul>
      {confirmDialog}
    </section>
  );
}
