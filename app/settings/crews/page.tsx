"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { canManageOrg, useOrg } from "@/components/org-context";
import { showToast } from "@/components/toast";
import { warsawTodayIso } from "@/lib/warsaw-today";
import { supabase } from "@/lib/supabase";
import type { Crew, EmployeeProfile } from "@/lib/types";

export default function CrewsSettingsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <CrewsInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function CrewsInner() {
  const { organizationId, role } = useOrg();
  const canUse = canManageOrg(role);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const [{ data: c }, { data: e }] = await Promise.all([
      supabase.from("crews").select("*").eq("organization_id", organizationId).order("name"),
      supabase.from("employee_profiles").select("*").eq("organization_id", organizationId).eq("active", true).order("full_name")
    ]);
    const list = (c || []) as Crew[];
    setCrews(list);
    setEmployees((e || []) as EmployeeProfile[]);
    setSelectedId((prev) => (prev && list.some((x) => x.id === prev) ? prev : list[0]?.id ?? null));
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!organizationId || !name.trim()) return;
    const { data, error } = await supabase.from("crews").insert({ organization_id: organizationId, name: name.trim() }).select("id").single();
    if (error || !data) {
      showToast("Nie udało się dodać ekipy", "error");
      return;
    }
    setName("");
    setSelectedId(data.id);
    showToast("Dodano ekipę");
    await load();
  };

  const rename = async (id: string, newName: string) => {
    if (!newName.trim()) return;
    const { error } = await supabase.from("crews").update({ name: newName.trim() }).eq("id", id);
    if (error) { showToast("Nie udało się zapisać nazwy", "error"); return; }
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć tę ekipę? Pracownicy przypisani do niej zostaną bez brygady.")) return;
    await supabase.from("crews").delete().eq("id", id);
    if (selectedId === id) setSelectedId(null);
    showToast("Usunięto ekipę");
    await load();
  };

  const setEmployeeCrew = async (employee: EmployeeProfile, crewId: string | null) => {
    setAssigningId(employee.id);
    const { error } = await supabase.rpc("set_employee_crew_assignment", {
      p_employee_id: employee.id,
      p_crew_id: crewId,
      p_valid_from: warsawTodayIso(),
      p_notes: null
    });
    setAssigningId(null);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    await load();
  };

  if (!organizationId) return null;
  if (!canUse) {
    return (
      <div className="rounded-xl2 border border-stone-200/80 bg-white p-6 shadow-card">
        <h1 className="text-xl font-bold text-ink">Ekipy / brygady</h1>
        <p className="mt-2 text-sm text-steel">Ten słownik jest dostępny tylko dla ról zarządczych.</p>
      </div>
    );
  }

  const selectedCrew = crews.find((c) => c.id === selectedId) || null;
  const members = selectedId ? employees.filter((e) => e.crew_id === selectedId) : [];
  const membersWithAccount = members.filter((e) => e.user_id);
  const membersWithoutAccount = members.filter((e) => !e.user_id);
  const others = selectedId ? employees.filter((e) => e.crew_id !== selectedId) : [];

  return (
    <div className="grid min-w-0 gap-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Słowniki</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Ekipy / brygady</h1>
        <p className="mt-2 max-w-2xl text-sm text-steel">
          Skład osobowy brygady. Wybór brygady na zleceniu automatycznie przypisze jej członków (posiadających konto) do realizacji.
        </p>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card">
          <h2 className="text-sm font-bold text-ink">Ekipy ({crews.length})</h2>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row lg:flex-col">
            <input
              className="input flex-1 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              placeholder="np. Ekipa elewacje — Kraków"
            />
            <button type="button" onClick={() => void add()} disabled={!name.trim()} className="shrink-0 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
              + Ekipa
            </button>
          </div>
          {loading ? (
            <p className="mt-4 text-sm text-steel">Wczytywanie...</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {crews.map((c) => {
                const count = employees.filter((e) => e.crew_id === c.id).length;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        selectedId === c.id ? "border-moss bg-moss/10" : "border-stone-200 bg-white hover:bg-stone-50"
                      }`}
                    >
                      <p className="truncate text-sm font-semibold text-ink">👷 {c.name}</p>
                      <p className="mt-0.5 text-xs text-steel">{count === 0 ? "brak osób" : count === 1 ? "1 osoba" : `${count} osoby/osób`}</p>
                    </button>
                  </li>
                );
              })}
              {crews.length === 0 && <li className="rounded-lg border border-dashed border-stone-200 p-6 text-center text-xs text-steel">Brak ekip — dodaj pierwszą powyżej.</li>}
            </ul>
          )}
        </section>

        {selectedCrew ? (
          <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <label className="grid min-w-0 flex-1 gap-1 text-xs font-semibold text-ink">
                Nazwa ekipy
                <input
                  key={`name-${selectedCrew.id}`}
                  className="input font-normal"
                  defaultValue={selectedCrew.name}
                  onBlur={(e) => { if (e.target.value !== selectedCrew.name) void rename(selectedCrew.id, e.target.value); }}
                />
              </label>
              <button type="button" onClick={() => void remove(selectedCrew.id)} className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50">
                Usuń ekipę
              </button>
            </div>

            <div className="mt-4">
              <h3 className="text-sm font-bold text-ink">Członkowie ({members.length})</h3>
              {membersWithoutAccount.length > 0 && (
                <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {membersWithoutAccount.length === 1
                    ? "1 osoba z tej ekipy nie ma konta systemowego i nie może zostać formalnie przypisana do zlecenia."
                    : `${membersWithoutAccount.length} osoby z tej ekipy nie mają konta systemowego i nie mogą zostać formalnie przypisane do zlecenia.`}
                  {" "}Skład realny na budowie może być więc szerszy niż to, co widać w systemie.
                </p>
              )}
              <ul className="mt-3 grid gap-1.5">
                {[...membersWithAccount, ...membersWithoutAccount].map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50/60 p-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{e.full_name}</p>
                      <p className="truncate text-xs text-steel">
                        {e.role_title}
                        {!e.user_id && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[0.65rem] font-bold text-amber-800">bez konta</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={assigningId === e.id}
                      onClick={() => void setEmployeeCrew(e, null)}
                      className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                    >
                      Usuń z ekipy
                    </button>
                  </li>
                ))}
                {members.length === 0 && <li className="rounded-lg border border-dashed border-stone-200 p-4 text-center text-xs text-steel">Ta ekipa nie ma jeszcze żadnych osób.</li>}
              </ul>
            </div>

            {others.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-bold text-ink">Dodaj osobę do ekipy</h3>
                <label className="mt-2 grid gap-1 text-xs font-medium text-steel">
                  Wybierz pracownika
                  <select
                    className="input"
                    defaultValue=""
                    disabled={assigningId != null}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      const emp = others.find((o) => o.id === id);
                      if (emp) void setEmployeeCrew(emp, selectedCrew.id);
                      e.target.value = "";
                    }}
                  >
                    <option value="">— wybierz pracownika —</option>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.full_name} · {o.role_title}{o.crew_id ? " (zmieni ekipę)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </section>
        ) : (
          <section className="flex min-w-0 items-center justify-center rounded-xl2 border border-dashed border-stone-300 bg-white p-10 text-center text-sm text-steel">
            {crews.length === 0 ? "Utwórz pierwszą ekipę, aby zacząć." : "Wybierz ekipę z listy po lewej."}
          </section>
        )}
      </div>
    </div>
  );
}
