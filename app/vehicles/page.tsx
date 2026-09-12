"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { showToast } from "@/components/toast";
import { useOrg } from "@/components/org-context";
import { formatDate } from "@/lib/format";
import {
  fleetAlertLabel,
  worstVehicleLevel,
  type FleetAlertLevel
} from "@/lib/ops-alerts";
import { warsawTodayIso } from "@/lib/warsaw-today";
import { supabase } from "@/lib/supabase";
import type { Vehicle } from "@/lib/types";

function badgeClass(level: FleetAlertLevel): string {
  if (level === "overdue") return "bg-rose-100 text-rose-800";
  if (level === "soon") return "bg-amber-100 text-amber-900";
  if (level === "ok") return "bg-emerald-100 text-emerald-800";
  return "bg-stone-100 text-steel";
}

export default function VehiclesPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <VehiclesInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function VehiclesInner() {
  const { organizationId } = useOrg();
  const today = warsawTodayIso();
  const [list, setList] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [registration, setRegistration] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.from("vehicles").select("*").eq("organization_id", organizationId).order("name");
    if (error) {
      const missing = error.message.includes("vehicles") || error.code === "42P01";
      setLoadError(missing ? "Uruchom migrację 0011_fleet_and_warehouse.sql w Supabase." : error.message);
      setList([]);
    } else {
      setList((data || []) as Vehicle[]);
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const alertCount = useMemo(
    () => list.filter((v) => ["soon", "overdue"].includes(worstVehicleLevel(v.insurance_oc_expires, v.insurance_ac_expires, v.inspection_expires, today))).length,
    [list, today]
  );

  const add = async () => {
    if (!organizationId || !name.trim()) return;
    const { data, error } = await supabase
      .from("vehicles")
      .insert({
        organization_id: organizationId,
        name: name.trim(),
        registration_number: registration.trim() || null
      })
      .select("id")
      .single();
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setName("");
    setRegistration("");
    showToast("Dodano pojazd");
    if (data?.id) window.location.href = `/vehicles/${data.id}`;
    else await load();
  };

  if (!organizationId) return null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Samochody</h1>
        <p className="mt-2 text-sm text-steel">
          Ubezpieczenie, przegląd techniczny i historia serwisu. W porannym mailu dostaniesz przypomnienie 30 dni przed terminem.
        </p>
        {alertCount > 0 ? (
          <p className="mt-2 text-sm font-medium text-amber-800">{alertCount} samochód(ów) wymaga uwagi przy dokumentach.</p>
        ) : null}
      </div>

      {loadError ? <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">{loadError}</section> : null}

      {!formOpen ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          aria-expanded={false}
          className="flex w-full items-center justify-center gap-2 rounded-xl2 border border-dashed border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-ink shadow-card transition hover:border-moss/60 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-auto"
        >
          <span className="text-lg leading-none">+</span> Nowy samochód
        </button>
      ) : (
        <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-ink">Nowy samochód</h2>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-steel hover:bg-stone-100 hover:text-ink">
              Zwiń
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Nazwa <span className="text-rose-500" aria-hidden>*</span>
              <input className="input text-sm font-normal" placeholder="np. Ford Transit" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Nr rejestracyjny
              <input className="input text-sm font-normal" placeholder="np. KR 12345" value={registration} onChange={(e) => setRegistration(e.target.value)} />
            </label>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => void add()} disabled={!name.trim()} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
              Dodaj samochód
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50">
              Anuluj
            </button>
          </div>
        </section>
      )}

      <section className="rounded-lg bg-white p-5 shadow-panel">
        <h2 className="text-lg font-bold text-ink">Samochody</h2>
        {loading ? (
          <p className="mt-3 text-sm text-steel">Wczytywanie…</p>
        ) : list.length === 0 ? (
          <p className="mt-3 text-sm text-steel">Brak pojazdów — dodaj pierwszy powyżej.</p>
        ) : (
          <ul className="mt-3 grid gap-2.5">
            {list.map((v) => {
              const level = worstVehicleLevel(v.insurance_oc_expires, v.insurance_ac_expires, v.inspection_expires, today);
              const stripe =
                level === "overdue" ? "bg-rose-400" : level === "soon" ? "bg-amber-400" : level === "ok" ? "bg-emerald-400" : "bg-stone-200";
              const cardTone =
                level === "overdue"
                  ? "border-rose-200 bg-rose-50/40"
                  : level === "soon"
                    ? "border-amber-200 bg-amber-50/40"
                    : "border-stone-200 bg-white";
              return (
                <li
                  key={v.id}
                  className={`relative flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card ${cardTone}`}
                >
                  <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden />
                  <div className="min-w-0">
                    <Link href={`/vehicles/${v.id}`} className="flex items-center gap-1.5 font-semibold text-ink hover:text-moss">
                      {v.name}
                    </Link>
                    {v.registration_number ? (
                      <p className="mt-0.5 inline-flex rounded-md bg-stone-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-steel">
                        {v.registration_number}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-steel">
                      OC: <span className="font-medium text-ink">{v.insurance_oc_expires ? formatDate(v.insurance_oc_expires) : "—"}</span> · AC:{" "}
                      <span className="font-medium text-ink">{v.insurance_ac_expires ? formatDate(v.insurance_ac_expires) : "—"}</span> · Przegląd:{" "}
                      <span className="font-medium text-ink">{v.inspection_expires ? formatDate(v.inspection_expires) : "—"}</span>
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass(level)}`}>{fleetAlertLabel(level)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
