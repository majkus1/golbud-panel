"use client";

import { DateInput } from "@/components/date-input";
import { showToast } from "@/components/toast";
import { useConfirm } from "@/components/use-confirm";
import { UNITS } from "@/lib/domain";
import { formatMoney } from "@/lib/format";
import { formatPlMoney } from "@/lib/money-vat";
import { supabase } from "@/lib/supabase";
import type { ExtraWork, Unit } from "@/lib/types";
import { btnSectionAdd } from "@/components/case/case-ui";

export function ExtrasSection({
  caseId,
  organizationId,
  items,
  onChange
}: {
  caseId: string;
  organizationId: string;
  items: ExtraWork[];
  onChange: () => Promise<void>;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const add = async () => {
    const { error } = await supabase.from("extra_works").insert({
      organization_id: organizationId,
      case_id: caseId,
      description: "Opis pracy dodatkowej",
      quantity: 1,
      unit: "szt.",
      unit_rate: 0,
      accepted: false
    });
    if (error) { showToast("Nie udało się dodać pozycji", "error"); return; }
    showToast("Dodano pozycję");
    await onChange();
  };
  const update = async (id: string, patch: Partial<ExtraWork>, silent = false) => {
    const { error } = await supabase.from("extra_works").update(patch).eq("id", id);
    if (error) { showToast("Nie udało się zapisać", "error"); return; }
    if (!silent) showToast("Zapisano");
    await onChange();
  };
  const remove = async (x: ExtraWork) => {
    const ok = await confirm({
      title: "Usunąć robotę dodatkową?",
      message: `„${x.description}” — ${formatPlMoney(Number(x.line_total || 0))}. Pozycja zniknie też z aneksu o roboty dodatkowe przygotowanego z wzoru.`
    });
    if (!ok) return;
    const { error } = await supabase.from("extra_works").delete().eq("id", x.id);
    if (error) { showToast("Nie udało się usunąć pozycji", "error"); return; }
    showToast("Usunięto pozycję");
    await onChange();
  };
  const extrasTotal = items.reduce((s, x) => s + Number(x.line_total || 0), 0);
  const acceptedTotal = items.filter((x) => x.accepted).reduce((s, x) => s + Number(x.line_total || 0), 0);

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-base font-bold text-ink sm:text-lg">Roboty dodatkowe</h2>
        <button type="button" onClick={add} className={btnSectionAdd}>
          <span className="sm:hidden">+ Pozycja</span>
          <span className="hidden sm:inline">Dodaj robotę dodatkową</span>
        </button>
      </div>

      {items.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl2 border border-stone-200/80 bg-stone-50 p-3">
            <p className="text-[0.7rem] font-medium uppercase tracking-wide text-steel">Wartość łączna</p>
            <p className="mt-0.5 text-sm font-bold text-ink sm:text-base">{formatMoney(extrasTotal)}</p>
          </div>
          <div className="rounded-xl2 border border-emerald-200/70 bg-emerald-50/60 p-3">
            <p className="text-[0.7rem] font-medium uppercase tracking-wide text-emerald-700">Zaakceptowane</p>
            <p className="mt-0.5 text-sm font-bold text-emerald-700 sm:text-base">{formatMoney(acceptedTotal)}</p>
          </div>
        </div>
      )}

      {/* Mobile card view */}
      <div className="grid gap-3 sm:hidden">
        {items.length === 0 && (
          <p className="rounded-xl2 border border-dashed border-stone-200 p-4 text-center text-sm text-steel">Brak prac dodatkowych.</p>
        )}
        {items.map((x) => (
          <div
            key={x.id}
            className={`relative grid gap-2.5 overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card ${
              x.accepted ? "border-emerald-200 bg-emerald-50/40" : "border-stone-200 bg-white"
            }`}
          >
            <span className={`absolute inset-y-0 left-0 w-1.5 ${x.accepted ? "bg-emerald-400" : "bg-stone-200"}`} aria-hidden />
            <input key={`m-${x.id}-desc-${x.description}`} className="input py-1.5 text-sm font-semibold text-ink" defaultValue={x.description} placeholder="Opis pracy" onBlur={(e) => { if (e.target.value !== x.description) void update(x.id, { description: e.target.value }); }} />
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-0.5 text-xs font-medium text-steel">
                Data
                <DateInput className="py-1.5 text-sm" value={x.work_date} onChange={(e) => void update(x.id, { work_date: e.target.value }, true)} />
              </label>
              <label className="grid gap-0.5 text-xs font-medium text-steel">
                Ilość
                <input key={`m-${x.id}-qty-${x.quantity}`} type="number" min="0" step="0.01" className="input py-1.5 text-sm" defaultValue={x.quantity} onBlur={(e) => { if (Number(e.target.value) !== x.quantity) void update(x.id, { quantity: Number(e.target.value) }); }} />
              </label>
              <label className="grid gap-0.5 text-xs font-medium text-steel">
                Jedn.
                <select className="input py-1.5 text-sm" value={x.unit} onChange={(e) => void update(x.id, { unit: e.target.value as Unit }, true)}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label className="grid gap-0.5 text-xs font-medium text-steel">
                Stawka
                <input key={`m-${x.id}-rate-${x.unit_rate}`} type="number" min="0" className="input py-1.5 text-sm" defaultValue={x.unit_rate} onBlur={(e) => { if (Number(e.target.value) !== x.unit_rate) void update(x.id, { unit_rate: Number(e.target.value) }); }} />
              </label>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-stone-100 pt-2">
              <button
                type="button"
                onClick={() => void update(x.id, { accepted: !x.accepted }, true)}
                aria-pressed={x.accepted}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  x.accepted ? "border-emerald-300 bg-emerald-100 text-emerald-800" : "border-stone-300 bg-white text-steel hover:bg-stone-50"
                }`}
              >
                {x.accepted ? "✓ Zaakceptowana" : "Zaakceptuj"}
              </button>
              <span className="flex items-center gap-2">
                <span className="text-base font-bold text-ink">{formatMoney(x.line_total)}</span>
                <button type="button" onClick={() => void remove(x)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-rose-500 hover:bg-rose-50">
                  Usuń
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-xs uppercase text-steel">
            <tr>
              <th className="py-2">Data</th>
              <th className="py-2">Opis</th>
              <th className="py-2">Ilość</th>
              <th className="py-2">Jedn.</th>
              <th className="py-2">Stawka</th>
              <th className="py-2">Wartość</th>
              <th className="py-2">Akceptacja klienta</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((x) => (
              <tr key={x.id}>
                <td className="py-2">
                  <DateInput className="py-1 text-xs" value={x.work_date} onChange={(e) => void update(x.id, { work_date: e.target.value }, true)} />
                </td>
                <td className="py-2">
                  <input key={`d-${x.id}-desc-${x.description}`} className="input py-1 text-xs" defaultValue={x.description} onBlur={(e) => { if (e.target.value !== x.description) void update(x.id, { description: e.target.value }); }} />
                </td>
                <td className="py-2">
                  <input key={`d-${x.id}-qty-${x.quantity}`} type="number" min="0" step="0.01" className="input w-20 py-1 text-xs" defaultValue={x.quantity} onBlur={(e) => { if (Number(e.target.value) !== x.quantity) void update(x.id, { quantity: Number(e.target.value) }); }} />
                </td>
                <td className="py-2">
                  <select className="input py-1 text-xs" value={x.unit} onChange={(e) => void update(x.id, { unit: e.target.value as Unit }, true)}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </td>
                <td className="py-2">
                  <input key={`d-${x.id}-rate-${x.unit_rate}`} type="number" min="0" className="input w-24 py-1 text-xs" defaultValue={x.unit_rate} onBlur={(e) => { if (Number(e.target.value) !== x.unit_rate) void update(x.id, { unit_rate: Number(e.target.value) }); }} />
                </td>
                <td className="py-2 font-medium">{formatMoney(x.line_total)}</td>
                <td className="py-2 text-center">
                  <input type="checkbox" checked={x.accepted} onChange={(e) => void update(x.id, { accepted: e.target.checked }, true)} />
                </td>
                <td className="py-2 text-right">
                  <button type="button" onClick={() => void remove(x)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-rose-500 hover:bg-rose-50">
                    Usuń
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirmDialog}
    </section>
  );
}
