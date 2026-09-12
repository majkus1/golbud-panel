"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { showToast } from "@/components/toast";
import { canManageOrg, useOrg } from "@/components/org-context";
import { supabase } from "@/lib/supabase";
import type { JobPosition } from "@/lib/types";

export default function JobPositionsSettingsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <JobPositionsInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function JobPositionsInner() {
  const { organizationId, role } = useOrg();
  const canUse = canManageOrg(role);
  const [positions, setPositions] = useState<JobPosition[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const { data } = await supabase.from("job_positions").select("*").eq("organization_id", organizationId).order("sort_order").order("name");
    setPositions((data || []) as JobPosition[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [organizationId]);

  const add = async () => {
    if (!organizationId || !name.trim()) return;
    const maxSort = positions.reduce((m, p) => Math.max(m, p.sort_order), -1);
    const { error } = await supabase.from("job_positions").insert({ organization_id: organizationId, name: name.trim(), sort_order: maxSort + 10 });
    if (error) {
      showToast(error.message.includes("duplicate") ? "Takie stanowisko już istnieje" : "Nie udało się dodać stanowiska", "error");
      return;
    }
    setName("");
    showToast("Dodano stanowisko");
    await load();
  };

  const startEdit = (position: JobPosition) => {
    setEditingId(position.id);
    setEditName(position.name);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    const { error } = await supabase.from("job_positions").update({ name: editName.trim() }).eq("id", editingId);
    if (error) {
      showToast("Nie udało się zapisać", "error");
      return;
    }
    setEditingId(null);
    setEditName("");
    showToast("Zapisano");
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć stanowisko ze słownika? Pracownicy, którzy je mają, zachowają nazwę na swojej karcie.")) return;
    const { error } = await supabase.from("job_positions").delete().eq("id", id);
    if (error) {
      showToast("Nie udało się usunąć", "error");
      return;
    }
    showToast("Usunięto stanowisko");
    await load();
  };

  if (!organizationId) return null;
  if (!canUse) {
    return (
      <div className="rounded-xl2 border border-stone-200/80 bg-white p-6 shadow-card">
        <h1 className="text-xl font-bold text-ink">Stanowiska pracowników</h1>
        <p className="mt-2 text-sm text-steel">Ten słownik jest dostępny tylko dla ról zarządczych.</p>
      </div>
    );
  }

  return (
    <div className="grid max-w-2xl gap-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Słowniki</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Stanowiska pracowników</h1>
        <p className="mt-2 text-sm text-steel">Wykorzystywane w polu „Funkcja” na karcie pracownika — porządkuje nazewnictwo w raportach i rozliczeniach.</p>
      </div>
      <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-base font-bold text-ink">Nowe stanowisko</h2>
        <label className="mt-3 grid gap-1 text-xs font-semibold text-ink">
          Nazwa stanowiska
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="input flex-1 text-sm font-normal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              placeholder="np. Brygadzista, Kierownik budowy, Pomocnik"
            />
            <button type="button" onClick={() => void add()} disabled={!name.trim()} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
              Dodaj
            </button>
          </div>
        </label>
      </section>
      <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-base font-bold text-ink">Lista ({positions.length})</h2>
        {loading ? (
          <p className="mt-4 text-sm text-steel">Wczytywanie...</p>
        ) : (
          <ul className="mt-4 grid gap-2.5 text-sm">
            {positions.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl2 border border-stone-200 bg-white p-3.5 shadow-card">
                {editingId === p.id ? (
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                    <input
                      className="input flex-1 text-sm font-normal"
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void saveEdit()}
                    />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void saveEdit()} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-moss">
                        Zapisz
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50">
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="flex items-center gap-2 font-semibold text-ink">🪪 {p.name}</span>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50" onClick={() => startEdit(p)}>
                        Edytuj
                      </button>
                      <button type="button" className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50" onClick={() => void remove(p.id)}>
                        Usuń
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
            {positions.length === 0 && <li className="rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-steel">Brak stanowisk — dodaj pierwsze.</li>}
          </ul>
        )}
      </section>
    </div>
  );
}
