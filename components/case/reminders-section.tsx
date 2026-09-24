"use client";

import { DateInput } from "@/components/date-input";
import { useState } from "react";
import { formatDate, isDue } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Reminder } from "@/lib/types";

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
  const [title, setTitle] = useState("Kontakt z klientem");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const add = async () => {
    if (!date) return;
    await supabase.from("reminders").insert({
      organization_id: organizationId,
      case_id: caseId,
      remind_at: date,
      title: title.trim() || "Przypomnienie",
      note: note.trim() || null
    });
    setNote("");
    await onChange();
  };
  const complete = async (id: string) => {
    await supabase.from("reminders").update({ completed_at: new Date().toISOString() }).eq("id", id);
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
          return (
            <li
              key={r.id}
              className={`relative flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card ${
                r.completed_at ? "border-stone-200 bg-stone-50/60" : overdue ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-white"
              }`}
            >
              <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={`font-semibold text-ink ${r.completed_at ? "line-through opacity-70" : ""}`}>{r.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-steel">
                  <span className={overdue ? "font-semibold text-amber-800" : ""}>{formatDate(r.remind_at)}</span>
                  {r.note ? <span>— {r.note}</span> : null}
                </p>
              </div>
              {r.completed_at ? (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[0.7rem] font-semibold text-emerald-700">
                  ✓ {new Date(r.completed_at).toLocaleDateString("pl-PL")}
                </span>
              ) : (
                <button type="button" onClick={() => complete(r.id)} className="shrink-0 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-moss hover:bg-moss/10">
                  Oznacz jako wykonane
                </button>
              )}
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-steel">Brak przypomnień.</li>
        )}
      </ul>
    </section>
  );
}
