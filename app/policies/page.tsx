"use client";

import { DateInput } from "@/components/date-input";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { showToast } from "@/components/toast";
import { useOrg } from "@/components/org-context";
import { formatDate, formatMoney } from "@/lib/format";
import { fleetAlertLabel, worstLevelOf, type FleetAlertLevel } from "@/lib/ops-alerts";
import { warsawTodayIso } from "@/lib/warsaw-today";
import { supabase } from "@/lib/supabase";
import { COMPANY_POLICY_TYPES } from "@/lib/types";
import type { CompanyPolicy } from "@/lib/types";

function badgeClass(level: FleetAlertLevel): string {
  if (level === "overdue") return "bg-rose-100 text-rose-800";
  if (level === "soon") return "bg-amber-100 text-amber-900";
  if (level === "ok") return "bg-emerald-100 text-emerald-800";
  return "bg-stone-100 text-steel";
}

export default function PoliciesPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <PoliciesInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function PoliciesInner() {
  const { organizationId } = useOrg();
  const today = warsawTodayIso();
  const [list, setList] = useState<CompanyPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [policyType, setPolicyType] = useState<string>(COMPANY_POLICY_TYPES[0]);
  const [policyNumber, setPolicyNumber] = useState("");
  const [insurer, setInsurer] = useState("");
  const [coverageEnd, setCoverageEnd] = useState("");
  const [paymentDue, setPaymentDue] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("company_policies")
      .select("*")
      .eq("organization_id", organizationId)
      .order("coverage_end", { ascending: true, nullsFirst: false });
    if (error) {
      const missing = error.message.includes("company_policies") || error.code === "42P01";
      setLoadError(missing ? "Uruchom migrację 0016_fleet_insurance_policies.sql w Supabase (SQL Editor)." : error.message);
      setList([]);
    } else {
      setList((data || []) as CompanyPolicy[]);
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const alertCount = useMemo(
    () => list.filter((p) => ["soon", "overdue"].includes(worstLevelOf([p.coverage_end, p.payment_due], today))).length,
    [list, today]
  );

  const resetForm = () => {
    setPolicyType(COMPANY_POLICY_TYPES[0]);
    setPolicyNumber("");
    setInsurer("");
    setCoverageEnd("");
    setPaymentDue("");
    setAmount("");
    setNotes("");
  };

  const add = async () => {
    if (!organizationId || !policyType.trim()) return;
    const { error } = await supabase.from("company_policies").insert({
      organization_id: organizationId,
      policy_type: policyType.trim(),
      policy_number: policyNumber.trim() || null,
      insurer: insurer.trim() || null,
      coverage_end: coverageEnd || null,
      payment_due: paymentDue || null,
      amount: amount ? Number(amount) : null,
      notes: notes.trim() || null
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    resetForm();
    setFormOpen(false);
    showToast("Dodano polisę");
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć polisę?")) return;
    const { error } = await supabase.from("company_policies").delete().eq("id", id);
    if (error) showToast(error.message, "error");
    else await load();
  };

  if (!organizationId) return null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Polisy firmowe</h1>
        <p className="mt-2 text-sm text-steel">
          Ubezpieczenia firmy: OC działalności, polisy majątkowe i inne. Terminy końca ochrony i płatności trafiają do porannego maila z przypomnieniami.
        </p>
        {alertCount > 0 ? <p className="mt-2 text-sm font-medium text-amber-800">{alertCount} polis(y) wymaga uwagi (termin w ciągu 30 dni lub po terminie).</p> : null}
      </div>

      {loadError ? <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">{loadError}</section> : null}

      {!formOpen ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          aria-expanded={false}
          className="flex w-full items-center justify-center gap-2 rounded-xl2 border border-dashed border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-ink shadow-card transition hover:border-moss/60 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-auto"
        >
          <span className="text-lg leading-none">+</span> Nowa polisa
        </button>
      ) : (
        <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-ink">Nowa polisa firmowa</h2>
            <button type="button" onClick={() => { setFormOpen(false); resetForm(); }} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-steel hover:bg-stone-100 hover:text-ink">
              Zwiń
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Rodzaj polisy <span className="text-rose-500" aria-hidden>*</span>
              <select className="input text-sm font-normal" value={policyType} onChange={(e) => setPolicyType(e.target.value)}>
                {COMPANY_POLICY_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Numer polisy
              <input className="input text-sm font-normal" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Ubezpieczyciel
              <input className="input text-sm font-normal" placeholder="np. PZU, Warta" value={insurer} onChange={(e) => setInsurer(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Składka (zł)
              <input type="number" min={0} step="0.01" className="input text-sm font-normal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Koniec ochrony
              <DateInput className="text-sm font-normal" value={coverageEnd} onChange={(e) => setCoverageEnd(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Termin płatności
              <DateInput className="text-sm font-normal" value={paymentDue} onChange={(e) => setPaymentDue(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink sm:col-span-2">
              Notatki
              <textarea className="input min-h-[60px] text-sm font-normal" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => void add()} disabled={!policyType.trim()} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
              Dodaj polisę
            </button>
            <button type="button" onClick={() => { setFormOpen(false); resetForm(); }} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50">
              Anuluj
            </button>
          </div>
        </section>
      )}

      <section className="rounded-lg bg-white p-5 shadow-panel">
        <h2 className="text-lg font-bold text-ink">Wykaz polis</h2>
        {loading ? (
          <p className="mt-3 text-sm text-steel">Wczytywanie…</p>
        ) : list.length === 0 ? (
          <p className="mt-3 text-sm text-steel">Brak polis — dodaj pierwszą powyżej.</p>
        ) : (
          <ul className="mt-3 grid gap-2.5">
            {list.map((p) => {
              const level = worstLevelOf([p.coverage_end, p.payment_due], today);
              const stripe =
                level === "overdue" ? "bg-rose-400" : level === "soon" ? "bg-amber-400" : level === "ok" ? "bg-emerald-400" : "bg-stone-200";
              const cardTone =
                level === "overdue" ? "border-rose-200 bg-rose-50/40" : level === "soon" ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-white";
              return (
                <li key={p.id} className={`relative rounded-xl2 border p-3.5 pl-4 shadow-card ${cardTone}`}>
                  <span className={`absolute inset-y-0 left-0 w-1.5 rounded-l-xl2 ${stripe}`} aria-hidden />
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{p.policy_type}</p>
                        {p.policy_number ? (
                          <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs font-medium text-steel">nr {p.policy_number}</span>
                        ) : null}
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass(level)}`}>{fleetAlertLabel(level)}</span>
                      </div>
                      <p className="mt-1 text-xs text-steel">
                        {p.insurer ? `${p.insurer} · ` : ""}
                        Koniec ochrony: <span className="font-medium text-ink">{p.coverage_end ? formatDate(p.coverage_end) : "—"}</span> · Płatność:{" "}
                        <span className="font-medium text-ink">{p.payment_due ? formatDate(p.payment_due) : "—"}</span>
                        {p.amount != null && Number(p.amount) > 0 ? ` · ${formatMoney(Number(p.amount))}` : ""}
                      </p>
                      {p.notes ? <p className="mt-1 text-xs text-steel">{p.notes}</p> : null}
                    </div>
                    <button type="button" onClick={() => void remove(p.id)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-rose-500 hover:bg-rose-50">
                      Usuń
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
