"use client";

import { DateInput } from "@/components/date-input";
import { showToast } from "@/components/toast";
import { useConfirm } from "@/components/use-confirm";
import { formatMoney, isDue } from "@/lib/format";
import { formatPlMoney } from "@/lib/money-vat";
import { supabase } from "@/lib/supabase";
import type { Payment } from "@/lib/types";
import { btnSectionAdd } from "@/components/case/case-ui";

export function PaymentsSection({
  caseId,
  organizationId,
  items,
  onChange
}: {
  caseId: string;
  organizationId: string;
  items: Payment[];
  onChange: () => Promise<void>;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const add = async () => {
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
    const { error } = await supabase.from("payments").insert({
      organization_id: organizationId,
      case_id: caseId,
      title: "Płatność",
      amount_due: 0,
      amount_paid: 0,
      sort_order: maxSort + 10
    });
    if (error) { showToast("Nie udało się dodać płatności", "error"); return; }
    showToast("Dodano pozycję");
    await onChange();
  };
  const update = async (id: string, patch: Partial<Payment>, silent = false) => {
    const { error } = await supabase.from("payments").update(patch).eq("id", id);
    if (error) { showToast("Nie udało się zapisać", "error"); return; }
    if (!silent) showToast("Zapisano");
    await onChange();
  };
  // Usunięcie pozycji płatności (np. dodanej omyłkowo). Saldo sprawy przelicza się od razu.
  const remove = async (p: Payment) => {
    const ok = await confirm({
      title: "Usunąć płatność?",
      message: `„${p.title}” — należność ${formatPlMoney(Number(p.amount_due || 0))}, wpłacono ${formatPlMoney(Number(p.amount_paid || 0))}. Saldo sprawy przeliczy się bez tej pozycji.`
    });
    if (!ok) return;
    const { error } = await supabase.from("payments").delete().eq("id", p.id);
    if (error) { showToast("Nie udało się usunąć płatności", "error"); return; }
    showToast("Usunięto płatność");
    await onChange();
  };
  const totalDue = items.reduce((s, p) => s + Number(p.amount_due || 0), 0);
  const totalPaid = items.reduce((s, p) => s + Number(p.amount_paid || 0), 0);
  const totalBalance = totalDue - totalPaid;

  const payInfo = (p: Payment): { label: string; badge: string; stripe: string } => {
    const due = Number(p.amount_due || 0);
    const paid = Number(p.amount_paid || 0);
    const balance = due - paid;
    if (due > 0 && balance <= 0) return { label: "Opłacona", badge: "bg-emerald-100 text-emerald-700", stripe: "bg-emerald-400" };
    if (balance > 0 && isDue(p.due_date)) return { label: "Po terminie", badge: "bg-red-100 text-red-700", stripe: "bg-red-400" };
    if (paid > 0 && balance > 0) return { label: "Częściowo", badge: "bg-amber-100 text-amber-800", stripe: "bg-amber-400" };
    return { label: "Do zapłaty", badge: "bg-stone-100 text-stone-600", stripe: "bg-stone-300" };
  };

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-base font-bold text-ink sm:text-lg">Płatności klienta</h2>
        <button type="button" onClick={add} className={btnSectionAdd}>
          <span className="sm:hidden">+ Pozycja</span>
          <span className="hidden sm:inline">Dodaj planowaną płatność</span>
        </button>
      </div>

      {items.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl2 border border-stone-200/80 bg-stone-50 p-3">
            <p className="text-[0.7rem] font-medium uppercase tracking-wide text-steel">Należność</p>
            <p className="mt-0.5 text-sm font-bold text-ink sm:text-base">{formatMoney(totalDue)}</p>
          </div>
          <div className="rounded-xl2 border border-emerald-200/70 bg-emerald-50/60 p-3">
            <p className="text-[0.7rem] font-medium uppercase tracking-wide text-emerald-700">Wpłacono</p>
            <p className="mt-0.5 text-sm font-bold text-emerald-700 sm:text-base">{formatMoney(totalPaid)}</p>
          </div>
          <div className={`rounded-xl2 border p-3 ${totalBalance > 0 ? "border-amber-200/70 bg-amber-50/60" : "border-stone-200/80 bg-stone-50"}`}>
            <p className={`text-[0.7rem] font-medium uppercase tracking-wide ${totalBalance > 0 ? "text-amber-700" : "text-steel"}`}>Saldo</p>
            <p className={`mt-0.5 text-sm font-bold sm:text-base ${totalBalance > 0 ? "text-amber-700" : "text-ink"}`}>{formatMoney(totalBalance)}</p>
          </div>
        </div>
      )}

      {/* Mobile card view */}
      <div className="grid gap-3 sm:hidden">
        {items.length === 0 && (
          <p className="rounded-xl2 border border-dashed border-stone-200 p-4 text-center text-sm text-steel">
            Brak pozycji płatności. Kliknij „Dodaj planowaną płatność” u góry, żeby wpisać zaliczkę, ratę albo rozliczenie końcowe — każdą pozycję uzupełnia się bezpośrednio na liście.
          </p>
        )}
        {items.map((p) => {
          const info = payInfo(p);
          const balance = Number(p.amount_due || 0) - Number(p.amount_paid || 0);
          return (
            <div key={p.id} className="relative grid gap-2.5 overflow-hidden rounded-xl2 border border-stone-200 bg-white p-3.5 pl-4 shadow-card">
              <span className={`absolute inset-y-0 left-0 w-1.5 ${info.stripe}`} aria-hidden />
              <div className="flex items-center justify-between gap-2">
                <input
                  key={`m-${p.id}-title-${p.title}`}
                  className="input min-w-0 flex-1 py-1.5 text-sm font-semibold text-ink"
                  defaultValue={p.title}
                  placeholder="Tytuł"
                  onBlur={(e) => { if (e.target.value !== p.title) void update(p.id, { title: e.target.value }); }}
                />
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide ${info.badge}`}>{info.label}</span>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="grid min-w-0 gap-0.5 text-xs font-medium text-steel">
                  Termin
                  <DateInput className="py-1.5 text-sm" value={p.due_date || ""} onChange={(e) => void update(p.id, { due_date: e.target.value || null }, true)} />
                </label>
                <label className="grid min-w-0 gap-0.5 text-xs font-medium text-steel">
                  Zapłacono dnia
                  <DateInput className="py-1.5 text-sm" value={p.paid_at ? p.paid_at.slice(0, 10) : ""} onChange={(e) => void update(p.id, { paid_at: e.target.value ? `${e.target.value}T00:00:00.000Z` : null }, true)} />
                </label>
                <label className="grid gap-0.5 text-xs font-medium text-steel">
                  Należność (PLN)
                  <input key={`m-${p.id}-due-${p.amount_due}`} type="number" min="0" className="input py-1.5 text-sm" defaultValue={p.amount_due} onBlur={(e) => { if (Number(e.target.value) !== p.amount_due) void update(p.id, { amount_due: Number(e.target.value) }); }} />
                </label>
                <label className="grid gap-0.5 text-xs font-medium text-steel">
                  Wpłacono (PLN)
                  <input key={`m-${p.id}-paid-${p.amount_paid}`} type="number" min="0" className="input py-1.5 text-sm" defaultValue={p.amount_paid} onBlur={(e) => { if (Number(e.target.value) !== p.amount_paid) void update(p.id, { amount_paid: Number(e.target.value) }); }} />
                </label>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-steel">
                  {balance > 0 ? (
                    <>
                      Pozostało: <span className="text-amber-700">{formatMoney(balance)}</span>
                    </>
                  ) : null}
                </p>
                <button type="button" onClick={() => void remove(p)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-rose-500 hover:bg-rose-50">
                  Usuń
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="text-xs uppercase text-steel">
            <tr>
              <th className="py-2 text-left">Tytuł</th>
              <th className="py-2 text-left">Status</th>
              <th className="py-2">Termin</th>
              <th className="py-2">Należność</th>
              <th className="py-2">Wpłacono</th>
              <th className="py-2">Zapłacono dnia</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((p) => {
              const info = payInfo(p);
              return (
                <tr key={p.id}>
                  <td className="py-2">
                    <input key={`d-${p.id}-title-${p.title}`} className="input py-1 text-sm" defaultValue={p.title} onBlur={(e) => { if (e.target.value !== p.title) void update(p.id, { title: e.target.value }); }} />
                  </td>
                  <td className="py-2">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide ${info.badge}`}>{info.label}</span>
                  </td>
                  <td className="py-2">
                    <DateInput className="py-1 text-sm" value={p.due_date || ""} onChange={(e) => void update(p.id, { due_date: e.target.value || null }, true)} />
                  </td>
                  <td className="py-2">
                    <input key={`d-${p.id}-due-${p.amount_due}`} type="number" min="0" className="input w-28 py-1 text-sm" defaultValue={p.amount_due} onBlur={(e) => { if (Number(e.target.value) !== p.amount_due) void update(p.id, { amount_due: Number(e.target.value) }); }} />
                  </td>
                  <td className="py-2">
                    <input key={`d-${p.id}-paid-${p.amount_paid}`} type="number" min="0" className="input w-28 py-1 text-sm" defaultValue={p.amount_paid} onBlur={(e) => { if (Number(e.target.value) !== p.amount_paid) void update(p.id, { amount_paid: Number(e.target.value) }); }} />
                  </td>
                  <td className="py-2">
                    <DateInput className="py-1 text-sm" value={p.paid_at ? p.paid_at.slice(0, 10) : ""} onChange={(e) => void update(p.id, { paid_at: e.target.value ? `${e.target.value}T00:00:00.000Z` : null }, true)} />
                  </td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => void remove(p)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-rose-500 hover:bg-rose-50">
                      Usuń
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-stone-200 font-bold text-ink">
                <td className="py-2" colSpan={3}>RAZEM</td>
                <td className="py-2 text-center">{formatMoney(totalDue)}</td>
                <td className="py-2 text-center">{formatMoney(totalPaid)}</td>
                <td className="py-2" colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {confirmDialog}
    </section>
  );
}
