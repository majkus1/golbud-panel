"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { showToast } from "@/components/toast";
import { canEditWorkHours, canViewPayroll, useOrg } from "@/components/org-context";
import { supabase } from "@/lib/supabase";
import { warsawTodayIso } from "@/lib/warsaw-today";
import { currency, formatDate } from "@/lib/format";
import type { Crew, EmployeeProfile, CaseRow, OperationalEmployeePieceworkEntry, OperationalPieceworkActivity, WorkHour } from "@/lib/types";

const DAY_LABELS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Ndz"];

function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}
function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/** Poniedziałek tygodnia dla danej daty ISO. */
function mondayOf(iso: string): string {
  const d = isoToDate(iso);
  const dow = (d.getDay() + 6) % 7; // 0 = poniedziałek
  d.setDate(d.getDate() - dow);
  return dateToIso(d);
}
function addDays(iso: string, n: number): string {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + n);
  return dateToIso(d);
}
function formatDayLabel(iso: string): string {
  return isoToDate(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
}

export default function TimePage() {
  return (
    <AuthGate>
      {(session) => (
        <AppShell>
          <TimeInner userId={session.user.id} />
        </AppShell>
      )}
    </AuthGate>
  );
}

function TimeInner({ userId }: { userId: string }) {
  const { organizationId, role } = useOrg();
  const canEdit = canEditWorkHours(role);
  const [activeTab, setActiveTab] = useState<"hours" | "akord">("hours");
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(warsawTodayIso()));
  const [caseId, setCaseId] = useState<string>("");
  const [siteLabel, setSiteLabel] = useState<string>("");

  const [cases, setCases] = useState<Pick<CaseRow, "id" | "client_name" | "location">[]>([]);
  const [entries, setEntries] = useState<WorkHour[]>([]);
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newWorker, setNewWorker] = useState("");

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = weekDays[6];

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setLoadError(null);
    const [casesRes, whRes, employeeRes] = await Promise.all([
      supabase.from("cases").select("id, client_name, location").eq("organization_id", organizationId).order("client_name").limit(200),
      supabase
        .from("work_hours")
        .select("*")
        .eq("organization_id", organizationId)
        .gte("work_date", weekStart)
        .lte("work_date", weekEnd)
        .order("worker_name"),
      supabase.from("employee_profiles").select("*").eq("organization_id", organizationId).eq("active", true).order("full_name")
    ]);
    setCases((casesRes.data || []) as Pick<CaseRow, "id" | "client_name" | "location">[]);
    setEmployees((employeeRes.data || []) as EmployeeProfile[]);
    if (whRes.error) {
      const missing = whRes.error.message.includes("work_hours") || whRes.error.code === "42P01";
      setLoadError(missing ? "Uruchom migrację 0019_work_hours.sql w Supabase (SQL Editor)." : whRes.error.message);
      setEntries([]);
    } else {
      setEntries((whRes.data || []) as WorkHour[]);
    }
    setLoading(false);
  }, [organizationId, weekStart, weekEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  // Wpisy dla wybranej budowy (case_id lub site_label).
  const buildEntries = useMemo(() => {
    return entries.filter((e) => {
      if (caseId) return e.case_id === caseId;
      if (siteLabel.trim()) return !e.case_id && (e.site_label || "") === siteLabel.trim();
      return !e.case_id && !e.site_label;
    });
  }, [entries, caseId, siteLabel]);

  const workers = useMemo(() => {
    const set = new Set<string>();
    buildEntries.forEach((e) => set.add(e.worker_name));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pl"));
  }, [buildEntries]);

  const cellOf = (worker: string, day: string): WorkHour | undefined =>
    buildEntries.find((e) => e.worker_name === worker && e.work_date === day);

  const employeeForName = (name: string) => employees.find((employee) => employee.full_name.trim().toLocaleLowerCase("pl-PL") === name.trim().toLocaleLowerCase("pl-PL"));

  const buildScopeValid = !!caseId || !!siteLabel.trim() || buildEntries.length > 0;

  const saveCell = async (worker: string, day: string, raw: string) => {
    if (!organizationId || !canEdit) return;
    const hours = raw.trim() === "" ? 0 : Number(raw.replace(",", "."));
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      showToast("Godziny: 0–24", "error");
      return;
    }
    const existing = cellOf(worker, day);
    if (existing) {
      if (hours === 0) {
        const { error } = await supabase.from("work_hours").delete().eq("id", existing.id);
        if (error) showToast(error.message, "error");
      } else if (hours !== Number(existing.hours)) {
        const { error } = await supabase.from("work_hours").update({ hours, employee_id: existing.employee_id || employeeForName(worker)?.id || null }).eq("id", existing.id);
        if (error) showToast(error.message, "error");
      } else {
        return;
      }
    } else if (hours > 0) {
      const { error } = await supabase.from("work_hours").insert({
        organization_id: organizationId,
        case_id: caseId || null,
        site_label: caseId ? null : siteLabel.trim() || null,
        worker_name: worker,
        employee_id: employeeForName(worker)?.id || null,
        work_date: day,
        hours,
        created_by: userId
      });
      if (error) showToast(error.message, "error");
    } else {
      return;
    }
    await load();
  };

  const addWorker = () => {
    const name = newWorker.trim();
    if (!name) return;
    if (workers.includes(name)) {
      showToast("Taki pracownik już jest na liście", "error");
      return;
    }
    if (!caseId && !siteLabel.trim()) {
      showToast("Najpierw wybierz budowę", "error");
      return;
    }
    // Pusty wpis (0 h) na poniedziałek, by pracownik pojawił się w siatce.
    void (async () => {
      if (!organizationId) return;
      const { error } = await supabase.from("work_hours").insert({
        organization_id: organizationId,
        case_id: caseId || null,
        site_label: caseId ? null : siteLabel.trim() || null,
        worker_name: name,
        employee_id: employeeForName(name)?.id || null,
        work_date: weekStart,
        hours: 0,
        created_by: userId
      });
      if (error) {
        showToast(error.message, "error");
        return;
      }
      setNewWorker("");
      await load();
    })();
  };

  const removeWorker = async (worker: string) => {
    if (!confirm(`Usunąć wszystkie wpisy „${worker}" z tego tygodnia i budowy?`)) return;
    const ids = buildEntries.filter((e) => e.worker_name === worker).map((e) => e.id);
    if (ids.length === 0) return;
    const { error } = await supabase.from("work_hours").delete().in("id", ids);
    if (error) showToast(error.message, "error");
    else await load();
  };

  const rowTotal = (worker: string) => weekDays.reduce((s, d) => s + Number(cellOf(worker, d)?.hours || 0), 0);
  const dayTotal = (day: string) => workers.reduce((s, w) => s + Number(cellOf(w, day)?.hours || 0), 0);
  const grandTotal = workers.reduce((s, w) => s + rowTotal(w), 0);

  if (!organizationId) return null;

  if (role && !canEdit) {
    return (
      <div className="grid min-w-0 gap-4 rounded-lg bg-white p-6 shadow-panel">
        <h1 className="text-xl font-bold text-ink sm:text-2xl">Ewidencja czasu pracy</h1>
        <p className="text-sm text-steel">
          Godziny na budowie wpisuje <span className="font-semibold">brygadzista</span> lub biuro. Jako pracownik nie prowadzisz tu
          własnej ewidencji — jeśli coś jest nie tak, zgłoś to brygadziście.
        </p>
      </div>
    );
  }

  const weekNav = (
    <div className="grid grid-cols-3 gap-2">
      <button
        type="button"
        onClick={() => setWeekStart((w) => addDays(w, -7))}
        className="rounded-lg border border-stone-300 px-2 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50 sm:px-3"
      >
        <span className="sm:hidden">←</span>
        <span className="hidden sm:inline">← poprzedni</span>
      </button>
      <button
        type="button"
        onClick={() => setWeekStart(mondayOf(warsawTodayIso()))}
        className="rounded-lg border border-stone-300 px-2 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50 sm:px-3"
      >
        dziś
      </button>
      <button
        type="button"
        onClick={() => setWeekStart((w) => addDays(w, 7))}
        className="rounded-lg border border-stone-300 px-2 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50 sm:px-3"
      >
        <span className="sm:hidden">→</span>
        <span className="hidden sm:inline">następny →</span>
      </button>
    </div>
  );

  const hourInput = (worker: string, day: string, className = "") => {
    const cell = cellOf(worker, day);
    return (
      <input
        key={`${worker}-${day}-${cell?.hours ?? ""}`}
        type="number"
        inputMode="decimal"
        min={0}
        max={24}
        step="0.5"
        defaultValue={cell && Number(cell.hours) > 0 ? Number(cell.hours) : ""}
        onBlur={(e) => void saveCell(worker, day, e.target.value)}
        className={`input font-normal ${className}`}
        aria-label={`Godziny ${worker}, ${formatDayLabel(day)}`}
      />
    );
  };

  return (
    <div className="grid min-w-0 gap-5 sm:gap-6">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-ink sm:text-2xl">Ewidencja czasu pracy</h1>
        <p className="mt-2 text-sm text-steel">
          Tygodniowa karta godzin per pracownik na danej budowie. Wpisuj godziny dla każdego dnia — sumy liczą się automatycznie.
        </p>
      </div>

      {loadError ? <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">{loadError}</section> : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "hours", label: "Godziny" },
            { id: "akord", label: "Akord" }
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
              activeTab === tab.id ? "bg-ink text-white" : "border border-stone-300 text-ink hover:bg-stone-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
        <div className="grid gap-4">
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-ink">
            Budowa (zlecenie)
            <select
              className="input min-w-0 font-normal"
              value={caseId}
              onChange={(e) => {
                setCaseId(e.target.value);
                if (e.target.value) setSiteLabel("");
              }}
            >
              <option value="">— inna budowa / bez zlecenia —</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.client_name}
                  {c.location ? ` — ${c.location}` : ""}
                </option>
              ))}
            </select>
          </label>
          {!caseId && (
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-ink">
              Nazwa budowy (gdy brak zlecenia)
              <input
                className="input min-w-0 font-normal"
                placeholder="np. Remont — ul. Polna 4"
                value={siteLabel}
                onChange={(e) => setSiteLabel(e.target.value)}
              />
            </label>
          )}
          {weekNav}
        </div>
        <p className="mt-3 text-sm font-semibold text-steel">
          Tydzień: {formatDayLabel(weekStart)} – {formatDayLabel(weekEnd)} {isoToDate(weekStart).getFullYear()}
        </p>
      </section>

      {activeTab === "hours" && (
      <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
        {loading ? (
          <p className="text-sm text-steel">Wczytywanie…</p>
        ) : !buildScopeValid ? (
          <p className="text-sm text-steel">Wybierz budowę powyżej, aby rozpocząć ewidencję.</p>
        ) : (
          <>
            {/* Mobile / tablet — karta na pracownika */}
            <div className="grid gap-3 lg:hidden">
              {workers.length === 0 && (
                <p className="rounded-xl2 border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-steel">
                  Brak pracowników w tym tygodniu — dodaj poniżej.
                </p>
              )}
              {workers.map((w) => (
                <article key={w} className="overflow-hidden rounded-xl2 border border-stone-200">
                  <div className="flex items-center justify-between gap-2 border-b border-stone-100 bg-stone-50 px-3 py-2.5">
                    <p className="min-w-0 truncate font-semibold text-ink">{w}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-moss/10 px-2 py-0.5 text-xs font-bold text-moss-dark">
                        {rowTotal(w)} h
                      </span>
                      <button
                        type="button"
                        onClick={() => void removeWorker(w)}
                        aria-label={`Usuń ${w}`}
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        Usuń
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {weekDays.map((d, i) => (
                      <div key={d} className="flex items-center gap-3 px-3 py-2">
                        <div className="w-16 shrink-0">
                          <p className="text-xs font-semibold text-ink">{DAY_LABELS[i]}</p>
                          <p className="text-[0.65rem] text-stone-400">{formatDayLabel(d)}</p>
                        </div>
                        <div className="flex flex-1 items-center justify-end gap-2">
                          {hourInput(w, d, "w-20 py-2 text-center text-sm")}
                          <span className="w-4 text-xs text-stone-400">h</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}

              {workers.length > 0 && (
                <div className="rounded-xl2 border border-stone-200 bg-stone-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-steel">Suma dnia</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                    {weekDays.map((d, i) => (
                      <div key={d} className="flex items-baseline justify-between gap-1 text-sm">
                        <dt className="text-steel">
                          {DAY_LABELS[i]} {formatDayLabel(d)}
                        </dt>
                        <dd className="font-bold text-moss-dark">{dayTotal(d) || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 border-t border-stone-200 pt-2 text-sm font-bold text-ink">
                    Razem tygodniowo: <span className="text-moss-dark">{grandTotal || 0} h</span>
                  </p>
                </div>
              )}
            </div>

            {/* Desktop — tabela */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-steel">
                    <th className="px-2 py-2 text-left font-semibold">Pracownik</th>
                    {weekDays.map((d, i) => (
                      <th key={d} className="px-1 py-2 text-center font-semibold">
                        <div>{DAY_LABELS[i]}</div>
                        <div className="text-[0.65rem] font-normal text-stone-400">{formatDayLabel(d)}</div>
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center font-semibold">Razem</th>
                    <th className="px-1 py-2" aria-label="akcje" />
                  </tr>
                </thead>
                <tbody>
                  {workers.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-2 py-4 text-center text-steel">
                        Brak pracowników w tym tygodniu — dodaj poniżej.
                      </td>
                    </tr>
                  )}
                  {workers.map((w) => (
                    <tr key={w} className="border-b border-stone-100">
                      <td className="px-2 py-2 font-semibold text-ink">{w}</td>
                      {weekDays.map((d) => (
                        <td key={d} className="px-1 py-1.5 text-center">
                          {hourInput(w, d, "w-14 px-1 py-1 text-center text-sm")}
                        </td>
                      ))}
                      <td className="px-2 py-2 text-center font-bold text-ink">{rowTotal(w) || ""}</td>
                      <td className="px-1 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => void removeWorker(w)}
                          aria-label={`Usuń ${w}`}
                          className="rounded px-1.5 py-1 text-xs text-rose-500 hover:bg-rose-50"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-stone-200 text-sm font-bold text-ink">
                    <td className="px-2 py-2">Suma dnia</td>
                    {weekDays.map((d) => (
                      <td key={d} className="px-1 py-2 text-center text-moss-dark">
                        {dayTotal(d) || ""}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center text-moss-dark">{grandTotal || ""}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}

        {buildScopeValid && (
          <div className="mt-4 grid gap-2 rounded-xl2 bg-stone-50 p-3 sm:flex sm:items-center">
            <input
              list="active-employees"
              className="input min-w-0 flex-1 font-normal"
              placeholder="Imię i nazwisko pracownika"
              value={newWorker}
              onChange={(e) => setNewWorker(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addWorker();
              }}
            />
            <datalist id="active-employees">
              {employees.map((employee) => <option key={employee.id} value={employee.full_name}>{employee.role_title}</option>)}
            </datalist>
            <button
              type="button"
              onClick={addWorker}
              disabled={!newWorker.trim()}
              className="w-full shrink-0 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50 sm:w-auto"
            >
              Dodaj pracownika
            </button>
          </div>
        )}
      </section>
      )}

      {activeTab === "akord" && (
        <PieceworkTab
          organizationId={organizationId}
          caseId={caseId}
          weekStart={weekStart}
          weekEnd={weekEnd}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

function PieceworkTab({
  organizationId,
  caseId,
  weekStart,
  weekEnd,
  canEdit
}: {
  organizationId: string | null;
  caseId: string;
  weekStart: string;
  weekEnd: string;
  canEdit: boolean;
}) {
  const { role } = useOrg();
  const showPayroll = canViewPayroll(role);
  const [activities, setActivities] = useState<(OperationalPieceworkActivity & { rate?: number })[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [akordEmployees, setAkordEmployees] = useState<EmployeeProfile[]>([]);
  const [pieceworkEntries, setPieceworkEntries] = useState<(OperationalEmployeePieceworkEntry & { unit_rate_snapshot?: number })[]>([]);
  const [loading, setLoading] = useState(true);

  const [activityId, setActivityId] = useState("");
  const [entryDate, setEntryDate] = useState(warsawTodayIso());
  const [mode, setMode] = useState<"single" | "crew">("single");
  const [employeeId, setEmployeeId] = useState("");
  const [crewId, setCrewId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [crewQuantities, setCrewQuantities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const [activityRes, crewRes, employeeRes, entryRes] = await Promise.all([
      showPayroll
        ? supabase.from("piecework_activities").select("*").eq("organization_id", organizationId).eq("active", true).order("sort_order")
        : supabase.rpc("piecework_activities_operational", { target_org: organizationId }),
      supabase.from("crews").select("*").eq("organization_id", organizationId).order("sort_order"),
      supabase.rpc("employee_work_profiles_visible", { target_org: organizationId }),
      showPayroll
        ? supabase.from("employee_piecework_entries").select("*").eq("organization_id", organizationId).gte("entry_date", weekStart).lte("entry_date", weekEnd).order("entry_date", { ascending: false })
        : supabase.rpc("employee_piecework_entries_operational", { target_org: organizationId, date_from: weekStart, date_to: weekEnd })
    ]);
    setActivities((activityRes.data || []) as (OperationalPieceworkActivity & { rate?: number })[]);
    setCrews((crewRes.data || []) as Crew[]);
    setAkordEmployees(((employeeRes.data || []) as EmployeeProfile[]).filter((employee) => employee.employment_type === "akord"));
    setPieceworkEntries((entryRes.data || []) as (OperationalEmployeePieceworkEntry & { unit_rate_snapshot?: number })[]);
    setLoading(false);
  }, [organizationId, weekStart, weekEnd, showPayroll]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildEntries = useMemo(
    () => pieceworkEntries.filter((e) => (caseId ? e.case_id === caseId : !e.case_id)),
    [pieceworkEntries, caseId]
  );

  const crewMembers = useMemo(
    () => akordEmployees.filter((e) => e.crew_id === crewId),
    [akordEmployees, crewId]
  );

  const activityById = new Map(activities.map((a) => [a.id, a]));
  const employeeById = new Map(akordEmployees.map((e) => [e.id, e]));
  const selectedActivity = activityById.get(activityId);

  const resetForm = () => {
    setQuantity("");
    setCrewQuantities({});
  };

  const addSingle = async () => {
    if (!organizationId || !activityId || !employeeId) return;
    const qty = Number(quantity.replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast("Podaj ilość większą od zera", "error");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("add_employee_piecework_entry", {
      target_org: organizationId,
      target_employee: employeeId,
      target_activity: activityId,
      target_case: caseId || null,
      target_quantity: qty,
      target_date: entryDate,
      target_note: null
    });
    setSaving(false);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Dodano wpis akordowy");
    resetForm();
    await load();
  };

  const addForCrew = async () => {
    if (!organizationId || !activityId || crewMembers.length === 0) return;
    const rows = crewMembers
      .map((member) => {
        const raw = crewQuantities[member.id] ?? quantity;
        const qty = Number((raw || "").replace(",", "."));
        return { member, qty };
      })
      .filter((row) => Number.isFinite(row.qty) && row.qty > 0);
    if (rows.length === 0) {
      showToast("Podaj ilość dla przynajmniej jednej osoby", "error");
      return;
    }
    setSaving(true);
    const results = await Promise.all(rows.map((row) => supabase.rpc("add_employee_piecework_entry", {
      target_org: organizationId,
      target_employee: row.member.id,
      target_activity: activityId,
      target_case: caseId || null,
      target_quantity: row.qty,
      target_date: entryDate,
      target_note: null
    })));
    const error = results.find((result) => result.error)?.error || null;
    setSaving(false);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast(`Dodano ${rows.length} wpis(ów) dla brygady`);
    resetForm();
    await load();
  };

  const removeEntry = async (id: string) => {
    if (!confirm("Usunąć ten wpis akordowy?")) return;
    const { error } = await supabase.rpc("delete_employee_piecework_entry", { target_id: id });
    if (error) showToast(error.message, "error");
    else await load();
  };

  if (!canEdit) {
    return (
      <section className="rounded-lg bg-white p-4 shadow-panel sm:p-5">
        <p className="text-sm text-steel">Wpisywanie akordu jest dostępne dla brygadzisty i biura.</p>
      </section>
    );
  }

  if (akordEmployees.length === 0 && !loading) {
    return (
      <section className="rounded-lg bg-white p-4 shadow-panel sm:p-5">
        <p className="text-sm text-steel">
          Brak aktywnych pracowników z typem zatrudnienia „akord”. Ustaw ten typ w{" "}
          <Link href="/settings/organization" className="font-semibold text-moss-dark underline underline-offset-2">
            kartach pracowników
          </Link>
          , aby móc logować tu ich pracę.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
        <h2 className="text-base font-bold text-ink">Nowy wpis akordowy</h2>
        <p className="mt-1 text-xs text-steel">
          {showPayroll ? (
            <>
              Stawka zostaje zapisana automatycznie ze{" "}
              <Link href="/settings/piecework-activities" className="font-semibold text-moss-dark underline underline-offset-2">
                słownika czynności
              </Link>{" "}
              w momencie dodania wpisu.
            </>
          ) : (
            <>Rozliczenie jest wyliczane automatycznie na podstawie chronionej stawki czynności.</>
          )}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              { id: "single", label: "Pojedynczy pracownik" },
              { id: "crew", label: "Cała brygada" }
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                mode === m.id ? "bg-ink text-white" : "border border-stone-300 text-ink hover:bg-stone-50"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-ink">
            Czynność
            <select className="input font-normal" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
              <option value="">— wybierz —</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.unit}{showPayroll && a.rate != null ? ` · ${currency.format(a.rate)}` : ""})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-ink">
            Data wykonania
            <input type="date" className="input font-normal" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </label>

          {mode === "single" ? (
            <>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Pracownik
                <select className="input font-normal" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  <option value="">— wybierz —</option>
                  {akordEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Ilość {selectedActivity ? `(${selectedActivity.unit})` : ""}
                <input className="input font-normal" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="np. 25" />
              </label>
            </>
          ) : (
            <>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Brygada
                <select className="input font-normal" value={crewId} onChange={(e) => setCrewId(e.target.value)}>
                  <option value="">— wybierz —</option>
                  {crews.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Ilość domyślna dla wszystkich {selectedActivity ? `(${selectedActivity.unit})` : ""}
                <input className="input font-normal" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="np. 25" />
              </label>
            </>
          )}
        </div>

        {mode === "crew" && crewId && (
          <div className="mt-4 grid gap-2 rounded-xl2 border border-stone-200 p-3">
            <p className="text-xs font-semibold uppercase text-steel">Korekta ilości per osoba (opcjonalnie)</p>
            {crewMembers.length === 0 ? (
              <p className="text-sm text-steel">Ta brygada nie ma aktywnych pracowników akordowych.</p>
            ) : (
              crewMembers.map((member) => (
                <div key={member.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink">{member.full_name}</span>
                  <input
                    className="input w-28 font-normal"
                    inputMode="decimal"
                    placeholder={quantity || "0"}
                    value={crewQuantities[member.id] ?? ""}
                    onChange={(e) => setCrewQuantities((prev) => ({ ...prev, [member.id]: e.target.value }))}
                  />
                </div>
              ))
            )}
          </div>
        )}

        <button
          type="button"
          disabled={saving || !activityId || (mode === "single" ? !employeeId || !quantity : !crewId)}
          onClick={() => void (mode === "single" ? addSingle() : addForCrew())}
          className="mt-4 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50"
        >
          {saving ? "Zapisywanie…" : mode === "single" ? "Dodaj wpis" : "Zapisz dla brygady"}
        </button>
      </section>

      <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
        <h2 className="text-base font-bold text-ink">
          Wpisy w tym tygodniu {caseId ? "" : "(bez przypisanego zlecenia)"} ({buildEntries.length})
        </h2>
        <div className="mt-3 grid gap-2">
          {buildEntries.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{employeeById.get(entry.employee_id)?.full_name || "—"}</p>
                <p className="text-xs text-steel">
                  {formatDate(entry.entry_date)} · {activityById.get(entry.activity_id)?.name || "—"} · ilość: {entry.quantity}{showPayroll && entry.unit_rate_snapshot != null ? ` × ${currency.format(entry.unit_rate_snapshot)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {showPayroll && entry.unit_rate_snapshot != null ? <span className="font-bold text-ink">{currency.format(Number(entry.quantity) * Number(entry.unit_rate_snapshot))}</span> : null}
                <button type="button" onClick={() => void removeEntry(entry.id)} className="rounded px-1.5 py-1 text-xs text-rose-500 hover:bg-rose-50">
                  Usuń
                </button>
              </div>
            </div>
          ))}
          {buildEntries.length === 0 && <p className="rounded-xl2 border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-steel">Brak wpisów akordowych w tym tygodniu.</p>}
        </div>
      </section>
    </>
  );
}
