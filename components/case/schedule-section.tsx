"use client";

import { DateInput } from "@/components/date-input";
import { showToast } from "@/components/toast";
import { useConfirm } from "@/components/use-confirm";
import { isDue } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { CaseScheduleItem } from "@/lib/types";
import { btnSectionAdd } from "@/components/case/case-ui";

export function ScheduleSection({
  caseId,
  organizationId,
  items,
  onChange
}: {
  caseId: string;
  organizationId: string;
  items: CaseScheduleItem[];
  onChange: () => Promise<void>;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const update = async (id: string, patch: Partial<CaseScheduleItem>, silent = false) => {
    const { error } = await supabase.from("case_schedule_items").update(patch).eq("id", id);
    if (error) { showToast("Nie udało się zapisać", "error"); return; }
    if (!silent) showToast("Zapisano");
    await onChange();
  };
  const add = async () => {
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
    const { error } = await supabase.from("case_schedule_items").insert({
      organization_id: organizationId,
      case_id: caseId,
      title: "Nowy etap",
      sort_order: maxSort + 10
    });
    if (error) { showToast("Nie udało się dodać etapu", "error"); return; }
    showToast("Dodano etap");
    await onChange();
  };
  const remove = async (id: string) => {
    const item = items.find((i) => i.id === id);
    const ok = await confirm({
      title: "Usunąć etap harmonogramu?",
      message: `${item?.title ? `Etap „${item.title}”` : "Etap"} zniknie z harmonogramu razem z datami i opisem.`
    });
    if (!ok) return;
    const { error } = await supabase.from("case_schedule_items").delete().eq("id", id);
    if (error) { showToast("Nie udało się usunąć", "error"); return; }
    showToast("Usunięto etap");
    await onChange();
  };
  const move = async (index: number, dir: -1 | 1) => {
    const a = items[index];
    const b = items[index + dir];
    if (!a || !b) return;
    await supabase.from("case_schedule_items").update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from("case_schedule_items").update({ sort_order: a.sort_order }).eq("id", b.id);
    await onChange();
  };

  const doneCount = items.filter((i) => i.completed).length;
  const progressPct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
        <h2 className="min-w-0 text-base font-bold text-ink sm:text-lg">Harmonogram realizacji</h2>
        <button type="button" onClick={add} className={btnSectionAdd}>
          <span className="sm:hidden">+ Etap</span>
          <span className="hidden sm:inline">Dodaj etap</span>
        </button>
      </div>

      {items.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs font-medium text-steel">
            <span>Postęp realizacji</span>
            <span>
              <span className="font-bold text-ink">{doneCount}</span> z {items.length} etapów ({progressPct}%)
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-stone-100">
            <div className="h-full rounded-full bg-moss transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Karty etapów — wspólny widok mobile i desktop */}
      <div className="grid gap-3">
        {items.length === 0 && (
          <p className="rounded-xl2 border border-dashed border-stone-200 p-4 text-center text-sm text-steel">
            Brak etapów harmonogramu. Dodaj pierwszy etap, aby rozpisać realizację.
          </p>
        )}
        {items.map((row, idx) => {
          const overdue = !row.completed && isDue(row.due_date);
          const stripe = row.completed ? "bg-emerald-400" : overdue ? "bg-amber-400" : "bg-stone-200";
          const cardTone = row.completed
            ? "border-emerald-200 bg-emerald-50/40"
            : overdue
              ? "border-amber-200 bg-amber-50/40"
              : "border-stone-200 bg-white";
          return (
            <div key={row.id} className={`relative min-w-0 overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card ${cardTone}`}>
              <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden />

              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    row.completed ? "bg-emerald-500 text-white" : "bg-stone-100 text-steel"
                  }`}
                >
                  {row.completed ? "✓" : idx + 1}
                </span>
                <input
                  key={`m-${row.id}-title-${row.title}`}
                  className="input min-w-0 flex-1 py-1.5 text-sm font-semibold text-ink"
                  defaultValue={row.title}
                  onBlur={(e) => { if (e.target.value !== row.title) void update(row.id, { title: e.target.value }); }}
                />
                <div className="flex shrink-0 flex-col">
                  <button type="button" disabled={idx === 0} onClick={() => void move(idx, -1)} aria-label="Przesuń wyżej" className="rounded px-1 text-base leading-none text-steel hover:text-ink disabled:opacity-20">▲</button>
                  <button type="button" disabled={idx === items.length - 1} onClick={() => void move(idx, 1)} aria-label="Przesuń niżej" className="rounded px-1 text-base leading-none text-steel hover:text-ink disabled:opacity-20">▼</button>
                </div>
              </div>

              <div className="mt-3 pl-10">
                <label className="grid gap-1 text-xs font-medium text-steel">
                  Opis etapu
                  <textarea
                    key={`m-${row.id}-desc`}
                    className="input min-h-[56px] w-full py-1.5 text-sm font-normal"
                    placeholder="np. zakres prac, materiały, ustalenia z klientem…"
                    defaultValue={row.description || ""}
                    onBlur={(e) => {
                      const next = e.target.value.trim() || null;
                      if (next !== (row.description || null)) void update(row.id, { description: next }, true);
                    }}
                  />
                </label>
              </div>

              <div className="mt-3 grid gap-2.5 pl-10 sm:grid-cols-[minmax(0,240px)_1fr] sm:items-end">
                <label className="grid gap-1 text-xs font-medium text-steel">
                  <span className="flex items-center justify-between">
                    Termin
                    {overdue && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Po terminie</span>}
                  </span>
                  <DateInput
                    className="w-full min-w-0 py-1.5 text-sm"
                    value={row.due_date || ""}
                    onChange={(e) => void update(row.id, { due_date: e.target.value || null }, true)}
                  />
                </label>

                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => void update(row.id, { completed: !row.completed }, true)}
                    aria-pressed={row.completed}
                    className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors sm:px-3 sm:py-2 sm:text-sm ${
                      row.completed
                        ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                        : "border-stone-300 bg-white text-steel hover:bg-stone-50"
                    }`}
                  >
                    {row.completed ? "✓ Wykonane" : "Oznacz jako wykonane"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(row.id)}
                    aria-label="Usuń etap"
                    className="shrink-0 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50 sm:px-3 sm:py-2 sm:text-sm"
                  >
                    Usuń
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {confirmDialog}
    </section>
  );
}
