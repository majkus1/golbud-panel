"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { showToast } from "@/components/toast";
import { canViewPayroll, useOrg } from "@/components/org-context";
import { supabase } from "@/lib/supabase";
import type { PieceworkActivity, Unit } from "@/lib/types";
import { UNITS } from "@/lib/types";

export default function PieceworkActivitiesSettingsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <PieceworkActivitiesInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

type EditDraft = {
  name: string;
  unit: Unit;
  rate: string;
  active: boolean;
};

function draftFromItem(item: PieceworkActivity): EditDraft {
  return { name: item.name, unit: item.unit, rate: String(item.rate), active: item.active };
}

function PieceworkActivitiesInner() {
  const { organizationId, role } = useOrg();
  const canUse = canViewPayroll(role);
  const [items, setItems] = useState<PieceworkActivity[]>([]);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>("szt.");
  const [rate, setRate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = async () => {
    if (!organizationId || !canUse) return;
    const { data } = await supabase.from("piecework_activities").select("*").eq("organization_id", organizationId).order("sort_order");
    setItems((data || []) as PieceworkActivity[]);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, canUse]);

  const add = async () => {
    if (!organizationId || !name.trim()) return;
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
    const { error } = await supabase.from("piecework_activities").insert({
      organization_id: organizationId,
      name: name.trim(),
      unit,
      rate: rate ? Number(rate) : 0,
      sort_order: maxSort + 10
    });
    if (error) {
      showToast("Nie udało się dodać czynności", "error");
      return;
    }
    setName("");
    setRate("");
    setFormOpen(false);
    showToast("Dodano czynność");
    await load();
  };

  const startEdit = (item: PieceworkActivity) => {
    setEditingId(item.id);
    setEditDraft(draftFromItem(item));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft || !editDraft.name.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("piecework_activities")
      .update({
        name: editDraft.name.trim(),
        unit: editDraft.unit,
        rate: editDraft.rate ? Number(editDraft.rate) : 0,
        active: editDraft.active
      })
      .eq("id", editingId);
    setSaving(false);
    if (error) {
      showToast("Nie udało się zapisać", "error");
      return;
    }
    showToast("Zapisano");
    cancelEdit();
    await load();
  };

  const remove = async (id: string) => {
    if (editingId === id) cancelEdit();
    const { error } = await supabase.from("piecework_activities").delete().eq("id", id);
    if (error) {
      showToast("Nie udało się usunąć — czynność ma już wpisy w dziennikach akordu", "error");
      return;
    }
    showToast("Usunięto");
    await load();
  };

  if (!organizationId) return null;
  if (!canUse) {
    return <section className="rounded-lg bg-white p-6 text-sm text-steel shadow-panel">Stawki akordowe są dostępne wyłącznie dla właściciela i kierownika.</section>;
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Ustawienia</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Czynności akordowe</h1>
        <p className="mt-2 text-sm text-steel">
          Słownik prac rozliczanych na akord — nazwa, jednostka i stawka za jednostkę. Używany przy logowaniu wykonanej pracy
          w zakładce „Czas pracy” dla pracowników rozliczanych akordowo.
        </p>
      </div>
      {!formOpen ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          aria-expanded={false}
          className="flex w-full items-center justify-center gap-2 rounded-xl2 border border-dashed border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-ink shadow-card transition hover:border-moss/60 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-auto"
        >
          <span className="text-lg leading-none">+</span> Dodaj czynność
        </button>
      ) : (
        <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-ink">Dodaj czynność</h2>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-steel hover:bg-stone-100 hover:text-ink">
              Zwiń
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-ink sm:col-span-2">
              Nazwa
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Ułożenie płytki gres" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              Jednostka
              <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              Stawka za jednostkę (PLN)
              <input className="input" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" />
            </label>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => void add()} disabled={!name.trim()} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
              Dodaj czynność
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50">
              Anuluj
            </button>
          </div>
        </section>
      )}
      <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-base font-bold text-ink">Lista ({items.length})</h2>
        <ul className="mt-4 grid gap-2.5 text-sm">
          {items.map((i) => {
            const isEditing = editingId === i.id && editDraft;
            return (
              <li key={i.id}>
                {isEditing ? (
                  <div className="grid gap-3 rounded-xl2 border border-moss/30 bg-stone-50/80 p-3.5">
                    <p className="text-xs font-semibold uppercase text-steel">Edycja czynności</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1 text-sm font-semibold text-ink sm:col-span-2">
                        Nazwa
                        <input className="input" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} />
                      </label>
                      <label className="grid gap-1 text-sm font-semibold text-ink">
                        Jednostka
                        <select className="input" value={editDraft.unit} onChange={(e) => setEditDraft({ ...editDraft, unit: e.target.value as Unit })}>
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm font-semibold text-ink">
                        Stawka za jednostkę (PLN)
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={editDraft.rate}
                          onChange={(e) => setEditDraft({ ...editDraft, rate: e.target.value })}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                        <input type="checkbox" checked={editDraft.active} onChange={(e) => setEditDraft({ ...editDraft, active: e.target.checked })} />
                        Aktywna (widoczna przy logowaniu)
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={saving || !editDraft.name.trim()}
                        onClick={() => void saveEdit()}
                        className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50"
                      >
                        {saving ? "Zapisywanie…" : "Zapisz"}
                      </button>
                      <button type="button" disabled={saving} onClick={cancelEdit} className="rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-ink hover:bg-stone-50">
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl2 border border-stone-200 bg-white p-3.5 shadow-card">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{i.name}</p>
                        {!i.active && (
                          <span className="inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-steel">nieaktywna</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-steel">
                        {i.unit} · {i.rate} PLN / {i.unit}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50" onClick={() => startEdit(i)}>
                        Edytuj
                      </button>
                      <button type="button" className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50" onClick={() => void remove(i.id)}>
                        Usuń
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {items.length === 0 && <p className="rounded-xl2 border border-dashed border-stone-300 p-6 text-center text-sm text-steel">Brak czynności akordowych. Dodaj pierwszą powyżej.</p>}
        </ul>
      </section>
    </div>
  );
}
