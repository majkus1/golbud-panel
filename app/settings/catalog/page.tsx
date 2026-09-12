"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { showToast } from "@/components/toast";
import { useOrg } from "@/components/org-context";
import { parseAmount } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { CatalogItem, Unit } from "@/lib/types";
import { UNITS } from "@/lib/types";

export default function CatalogSettingsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <CatalogInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

type EditDraft = {
  label: string;
  unit: Unit;
  category: "material" | "labor";
  rate: string;
};

function draftFromItem(item: CatalogItem): EditDraft {
  return {
    label: item.label,
    unit: item.default_unit,
    category: item.category,
    rate: item.suggested_rate != null ? String(item.suggested_rate) : ""
  };
}

function CatalogInner() {
  const { organizationId } = useOrg();
  const searchParams = useSearchParams();
  const initialFilter = searchParams.get("category") === "labor" ? "labor" : searchParams.get("category") === "material" ? "material" : "all";
  const [filter, setFilter] = useState<"all" | "material" | "labor">(initialFilter);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState<Unit>("m²");
  const [category, setCategory] = useState<"material" | "labor">(initialFilter === "labor" ? "labor" : "material");
  const [rate, setRate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = async () => {
    if (!organizationId) return;
    const { data } = await supabase.from("catalog_items").select("*").eq("organization_id", organizationId).order("sort_order");
    setItems((data || []) as CatalogItem[]);
  };

  useEffect(() => {
    void load();
  }, [organizationId]);

  const add = async () => {
    if (!organizationId || !label.trim()) return;
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
    const { error } = await supabase.from("catalog_items").insert({
      organization_id: organizationId,
      label: label.trim(),
      default_unit: unit,
      category,
      suggested_rate: rate.trim() ? parseAmount(rate) : null,
      sort_order: maxSort + 10
    });
    if (error) {
      showToast("Nie udało się dodać pozycji", "error");
      return;
    }
    setLabel("");
    setRate("");
    setFormOpen(false);
    showToast("Dodano pozycję");
    await load();
  };

  const startEdit = (item: CatalogItem) => {
    setEditingId(item.id);
    setEditDraft(draftFromItem(item));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft || !editDraft.label.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("catalog_items")
      .update({
        label: editDraft.label.trim(),
        default_unit: editDraft.unit,
        category: editDraft.category,
        suggested_rate: editDraft.rate.trim() ? parseAmount(editDraft.rate) : null
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
    const { error } = await supabase.from("catalog_items").delete().eq("id", id);
    if (error) {
      showToast("Nie udało się usunąć", "error");
      return;
    }
    showToast("Usunięto");
    await load();
  };

  if (!organizationId) return null;

  const visibleItems = items.filter((i) => filter === "all" || i.category === filter);

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Ustawienia</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Baza pozycji kosztorysowych</h1>
        <p className="mt-2 text-sm text-steel">
          Gotowe pozycje do wstawiania w ofertach (materiał / robocizna). Domyślne pozycje można edytować — np. dopisać stawkę.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "all", label: "Wszystkie" },
            { id: "material", label: "Materiały" },
            { id: "labor", label: "Usługi / robocizna" }
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              filter === f.id ? "bg-ink text-white" : "border border-stone-300 text-ink hover:bg-stone-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {!formOpen ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          aria-expanded={false}
          className="flex w-full items-center justify-center gap-2 rounded-xl2 border border-dashed border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-ink shadow-card transition hover:border-moss/60 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-auto"
        >
          <span className="text-lg leading-none">+</span> Dodaj pozycję
        </button>
      ) : (
        <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-ink">Dodaj pozycję</h2>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-steel hover:bg-stone-100 hover:text-ink">
              Zwiń
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-ink">
              Nazwa
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="np. Tynk gipsowy maszynowy" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              Sugerowana stawka (PLN)
              <input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="np. 300 albo 12,50" />
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
              Typ
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value as "material" | "labor")}>
                <option value="material">Materiał</option>
                <option value="labor">Robocizna</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => void add()} disabled={!label.trim()} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
              Dodaj do katalogu
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50">
              Anuluj
            </button>
          </div>
        </section>
      )}
      <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-base font-bold text-ink">Lista ({visibleItems.length})</h2>
        <ul className="mt-4 grid gap-2.5 text-sm">
          {visibleItems.map((i) => {
            const isEditing = editingId === i.id && editDraft;
            return (
              <li key={i.id}>
                {isEditing ? (
                  <div className="grid gap-3 rounded-xl2 border border-moss/30 bg-stone-50/80 p-3.5">
                    <p className="text-xs font-semibold uppercase text-steel">Edycja pozycji</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1 text-sm font-semibold text-ink">
                        Nazwa
                        <input
                          className="input"
                          value={editDraft.label}
                          onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })}
                        />
                      </label>
                      <label className="grid gap-1 text-sm font-semibold text-ink">
                        Sugerowana stawka (PLN)
                        <input
                          className="input"
                          inputMode="decimal"
                          value={editDraft.rate}
                          onChange={(e) => setEditDraft({ ...editDraft, rate: e.target.value })}
                          placeholder="opcjonalnie"
                        />
                      </label>
                      <label className="grid gap-1 text-sm font-semibold text-ink">
                        Jednostka
                        <select
                          className="input"
                          value={editDraft.unit}
                          onChange={(e) => setEditDraft({ ...editDraft, unit: e.target.value as Unit })}
                        >
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm font-semibold text-ink">
                        Typ
                        <select
                          className="input"
                          value={editDraft.category}
                          onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value as "material" | "labor" })}
                        >
                          <option value="material">Materiał</option>
                          <option value="labor">Robocizna</option>
                        </select>
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={saving || !editDraft.label.trim()}
                        onClick={() => void saveEdit()}
                        className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50"
                      >
                        {saving ? "Zapisywanie…" : "Zapisz"}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={cancelEdit}
                        className="rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-ink hover:bg-stone-50"
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl2 border border-stone-200 bg-white p-3.5 shadow-card">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{i.label}</p>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide ${i.category === "labor" ? "bg-sky-100 text-sky-700" : "bg-moss/12 text-moss-dark"}`}>
                          {i.category === "labor" ? "robocizna" : "materiał"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-steel">
                        {i.default_unit}
                        {i.suggested_rate != null ? ` · ${i.suggested_rate} PLN` : " · brak stawki"}
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
        </ul>
      </section>
    </div>
  );
}
