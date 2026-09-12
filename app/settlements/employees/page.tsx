"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { DateInput } from "@/components/date-input";
import { canViewPayroll, useOrg } from "@/components/org-context";
import { showToast } from "@/components/toast";
import { downloadAuthenticatedFile } from "@/lib/download-authenticated-pdf";
import {
  calculateEmployeeSettlement,
  EMPLOYMENT_TYPE_LABELS,
  monthBounds,
  monthLabel,
  SETTLEMENT_STATUS_LABELS,
  settlementStatusTone,
  type EmployeeSettlementCalculation
} from "@/lib/employee-settlements";
import { currency, formatDate, formatDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { warsawTodayIso } from "@/lib/warsaw-today";
import type {
  CaseRow,
  EmployeeMonthlySettlement,
  EmployeeMonthlySettlementStatus,
  EmployeePieceworkEntry,
  EmployeeCompensation,
  EmployeePayrollProfile,
  EmployeeSettlementEntry,
  EmployeeSettlementEntryType,
  EmployeeSettlementHistory,
  PieceworkActivity,
  WorkHour
} from "@/lib/types";

type EntryKind = EmployeeSettlementEntryType | "korekta_minus";

const ENTRY_KINDS: { id: EntryKind; label: string; effect: "plus" | "minus" }[] = [
  { id: "premia", label: "Premia", effect: "plus" },
  { id: "zwrot_kosztow", label: "Zwrot kosztów", effect: "plus" },
  { id: "korekta", label: "Korekta na plus", effect: "plus" },
  { id: "zaliczka", label: "Zaliczka", effect: "minus" },
  { id: "potracenie", label: "Potrącenie", effect: "minus" },
  { id: "korekta_minus", label: "Korekta na minus", effect: "minus" },
  { id: "wyplata", label: "Wypłata częściowa", effect: "minus" }
];

function currentPeriod(): string {
  return warsawTodayIso().slice(0, 7);
}

function parseAmount(value: string): number {
  const parsed = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function entryLabel(entry: EmployeeSettlementEntry): string {
  if (entry.entry_type === "korekta") return entry.direction === "minus" ? "Korekta na minus" : "Korekta na plus";
  return ENTRY_KINDS.find((item) => item.id === entry.entry_type)?.label || entry.entry_type;
}

function entryIsPositive(entry: EmployeeSettlementEntry): boolean {
  return entry.entry_type === "premia" || entry.entry_type === "zwrot_kosztow" || (entry.entry_type === "korekta" && entry.direction !== "minus");
}

export default function EmployeeSettlementsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <EmployeeSettlementsInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function EmployeeSettlementsInner() {
  const searchParams = useSearchParams();
  const requestedEmployee = searchParams.get("employee");
  const { organizationId, role, userId } = useOrg();
  const canUse = canViewPayroll(role);
  const [period, setPeriod] = useState(currentPeriod());
  const [employees, setEmployees] = useState<EmployeePayrollProfile[]>([]);
  const [workHours, setWorkHours] = useState<WorkHour[]>([]);
  const [entries, setEntries] = useState<EmployeeSettlementEntry[]>([]);
  const [pieceworkEntries, setPieceworkEntries] = useState<EmployeePieceworkEntry[]>([]);
  const [pieceworkActivities, setPieceworkActivities] = useState<PieceworkActivity[]>([]);
  const [cards, setCards] = useState<EmployeeMonthlySettlement[]>([]);
  const [history, setHistory] = useState<EmployeeSettlementHistory[]>([]);
  const [cases, setCases] = useState<Pick<CaseRow, "id" | "client_name" | "location">[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  const [entryForm, setEntryForm] = useState({
    kind: "premia" as EntryKind,
    amount: "",
    entry_date: `${currentPeriod()}-01`,
    case_id: "",
    title: "",
    notes: ""
  });

  const bounds = useMemo(() => monthBounds(period), [period]);

  const load = useCallback(async () => {
    if (!organizationId || !canUse) return;
    setLoading(true);
    setLoadError("");
    const [employeeRes, compensationRes, hoursRes, entryRes, pieceworkRes, activityRes, cardRes, historyRes, caseRes] = await Promise.all([
      supabase.from("employee_profiles").select("*").eq("organization_id", organizationId).order("active", { ascending: false }).order("full_name"),
      supabase.from("employee_compensation").select("employee_id,organization_id,hourly_rate,day_rate,monthly_salary,created_by,updated_by,created_at,updated_at").eq("organization_id", organizationId),
      supabase.from("work_hours").select("*").eq("organization_id", organizationId).gte("work_date", bounds.start).lt("work_date", bounds.end),
      supabase.from("employee_settlement_entries").select("*").eq("organization_id", organizationId).gte("entry_date", bounds.start).lt("entry_date", bounds.end).order("entry_date", { ascending: false }),
      supabase.from("employee_piecework_entries").select("*").eq("organization_id", organizationId).gte("entry_date", bounds.start).lt("entry_date", bounds.end).order("entry_date", { ascending: false }),
      supabase.from("piecework_activities").select("*").eq("organization_id", organizationId).order("sort_order"),
      supabase.from("employee_monthly_settlements").select("*").eq("organization_id", organizationId).eq("period_month", bounds.start),
      supabase.from("employee_settlement_history").select("*").eq("organization_id", organizationId).eq("period_month", bounds.start).order("created_at", { ascending: false }).limit(200),
      supabase.from("cases").select("id, client_name, location").eq("organization_id", organizationId).order("client_name").limit(300)
    ]);

    const firstError = employeeRes.error || compensationRes.error || hoursRes.error || entryRes.error || cardRes.error || historyRes.error;
    if (firstError) {
      const missing = firstError.code === "42P01" || firstError.message.includes("employee_monthly_settlements");
      setLoadError(missing ? "Uruchom migrację 0039_employee_monthly_settlements.sql w Supabase." : firstError.message);
    }
    const compensationByEmployee = new Map(((compensationRes.data || []) as EmployeeCompensation[]).map((row) => [row.employee_id, row]));
    const loadedEmployees = (employeeRes.data || []).map((employee) => ({
      ...employee,
      hourly_rate: compensationByEmployee.get(employee.id)?.hourly_rate ?? null,
      day_rate: compensationByEmployee.get(employee.id)?.day_rate ?? null,
      monthly_salary: compensationByEmployee.get(employee.id)?.monthly_salary ?? null
    })) as EmployeePayrollProfile[];
    setEmployees(loadedEmployees);
    setWorkHours((hoursRes.data || []) as WorkHour[]);
    setEntries((entryRes.data || []) as EmployeeSettlementEntry[]);
    setPieceworkEntries((pieceworkRes.data || []) as EmployeePieceworkEntry[]);
    setPieceworkActivities((activityRes.data || []) as PieceworkActivity[]);
    setCards((cardRes.data || []) as EmployeeMonthlySettlement[]);
    setHistory((historyRes.data || []) as EmployeeSettlementHistory[]);
    setCases((caseRes.data || []) as Pick<CaseRow, "id" | "client_name" | "location">[]);
    setSelectedId((current) => {
      if (requestedEmployee && loadedEmployees.some((employee) => employee.id === requestedEmployee)) return requestedEmployee;
      return current && loadedEmployees.some((employee) => employee.id === current) ? current : loadedEmployees[0]?.id || "";
    });
    setLoading(false);
  }, [organizationId, canUse, bounds.start, bounds.end, requestedEmployee]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setEntryForm((form) => ({ ...form, entry_date: `${period}-01` }));
  }, [period]);

  const cardByEmployee = useMemo(() => new Map(cards.map((card) => [card.employee_id, card])), [cards]);
  const calculations = useMemo(() => {
    const map = new Map<string, EmployeeSettlementCalculation>();
    employees.forEach((employee) => map.set(employee.id, calculateEmployeeSettlement(employee, workHours, entries, pieceworkEntries)));
    return map;
  }, [employees, workHours, entries, pieceworkEntries]);

  const settlementEmployees = employees.filter((employee) => employee.active || cardByEmployee.has(employee.id));
  const filteredEmployees = settlementEmployees.filter((employee) => {
    const query = search.trim().toLocaleLowerCase("pl-PL");
    return !query || `${employee.full_name} ${employee.role_title}`.toLocaleLowerCase("pl-PL").includes(query);
  });
  const selected = employees.find((employee) => employee.id === selectedId) || null;
  const selectedCard = selected ? cardByEmployee.get(selected.id) || null : null;
  const selectedCalculation = selected ? calculations.get(selected.id) || null : null;
  const selectedEntries = entries.filter((entry) => entry.employee_id === selectedId);
  const selectedHistory = history.filter((item) => item.employee_id === selectedId);
  const locked = !!selectedCard && selectedCard.status !== "draft";

  const liveAmountDue = (employee: EmployeePayrollProfile) => cardByEmployee.get(employee.id)?.amount_due ?? calculations.get(employee.id)?.amount_due ?? 0;
  const totalDue = settlementEmployees.reduce((sum, employee) => sum + Number(liveAmountDue(employee)), 0);
  const approvedCount = cards.filter((card) => card.status === "approved").length;
  const paidCount = cards.filter((card) => card.status === "paid" || card.status === "closed").length;

  const syncEmployee = async (employeeId: string): Promise<string | null> => {
    setBusy(`sync-${employeeId}`);
    const { data, error } = await supabase.rpc("refresh_employee_monthly_settlement", {
      p_employee_id: employeeId,
      p_period_month: bounds.start
    });
    setBusy("");
    if (error) {
      showToast(error.message, "error");
      return null;
    }
    await load();
    return typeof data === "string" ? data : null;
  };

  const syncAll = async () => {
    setBusy("sync-all");
    let failed = 0;
    for (const employee of employees.filter((item) => item.active)) {
      const card = cardByEmployee.get(employee.id);
      if (card && card.status !== "draft") continue;
      const { error } = await supabase.rpc("refresh_employee_monthly_settlement", {
        p_employee_id: employee.id,
        p_period_month: bounds.start
      });
      if (error) failed++;
    }
    setBusy("");
    showToast(failed ? `Przeliczono miesiąc, błędy: ${failed}` : "Miesiąc przeliczony");
    await load();
  };

  const changeStatus = async (target: EmployeeMonthlySettlementStatus) => {
    if (!selected) return;
    let cardId = selectedCard?.id || null;
    if (!cardId) cardId = await syncEmployee(selected.id);
    if (!cardId) return;
    setBusy(`status-${target}`);
    const { error } = await supabase.rpc("set_employee_monthly_settlement_status", {
      p_settlement_id: cardId,
      p_status: target
    });
    setBusy("");
    if (error) showToast(error.message, "error");
    else {
      showToast(target === "approved" ? "Karta zatwierdzona" : target === "paid" ? "Wypłata oznaczona" : target === "closed" ? "Miesiąc zamknięty" : "Karta ponownie otwarta");
      await load();
    }
  };

  const addEntry = async () => {
    if (!organizationId || !selected || locked) return;
    const amount = parseAmount(entryForm.amount);
    if (amount <= 0 || !entryForm.entry_date.startsWith(period)) {
      showToast("Podaj dodatnią kwotę i datę z wybranego miesiąca.", "error");
      return;
    }
    const entryType: EmployeeSettlementEntryType = entryForm.kind === "korekta_minus" ? "korekta" : entryForm.kind;
    const direction = entryForm.kind === "korekta_minus" || ENTRY_KINDS.find((item) => item.id === entryForm.kind)?.effect === "minus" ? "minus" : "plus";
    setBusy("entry");
    const { error } = await supabase.from("employee_settlement_entries").insert({
      organization_id: organizationId,
      employee_id: selected.id,
      case_id: entryForm.case_id || null,
      entry_type: entryType,
      direction,
      amount,
      entry_date: entryForm.entry_date,
      title: entryForm.title.trim() || entryLabel({ entry_type: entryType, direction } as EmployeeSettlementEntry),
      notes: entryForm.notes.trim() || null,
      created_by: userId
    });
    setBusy("");
    if (error) showToast(error.message, "error");
    else {
      setEntryForm((form) => ({ ...form, amount: "", title: "", notes: "", case_id: "" }));
      showToast("Wpis dodany do rozliczenia");
      await load();
    }
  };

  const removeEntry = async (id: string) => {
    if (locked || !confirm("Usunąć ten wpis z rozliczenia? Zmiana zostanie odnotowana w dzienniku.")) return;
    const { error } = await supabase.from("employee_settlement_entries").delete().eq("id", id);
    if (error) showToast(error.message, "error");
    else await load();
  };

  const exportXlsx = async () => {
    if (!organizationId) return;
    setBusy("export");
    await syncAll();
    const ok = await downloadAuthenticatedFile(
      `/api/settlements/employees/export?organizationId=${encodeURIComponent(organizationId)}&period=${period}`,
      `rozliczenia-pracownikow-${period}.xlsx`
    );
    setBusy("");
    if (ok) showToast("Pobrano zestawienie dla księgowości");
  };

  if (!organizationId) return null;
  if (!canUse) {
    return (
      <section className="rounded-lg bg-white p-6 shadow-panel">
        <h1 className="text-xl font-bold text-ink">Rozliczenia pracowników</h1>
        <p className="mt-2 text-sm text-steel">Moduł płacowy jest dostępny wyłącznie dla właściciela i kierownika.</p>
      </section>
    );
  }

  return (
    <div className="grid min-w-0 gap-5">
      <header className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Kadry i finanse</p>
          <h1 className="mt-1 text-2xl font-bold text-ink sm:text-3xl">Rozliczenia pracowników</h1>
          <p className="mt-1 max-w-3xl text-sm text-steel">Miesięczne karty wynagrodzeń połączone z godzinami, stawkami, zaliczkami i kosztami konkretnych budów.</p>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-3 xl:flex">
          <input type="month" value={period} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setPeriod(event.target.value); }} className="input min-w-0 text-sm" aria-label="Miesiąc rozliczenia" />
          <button type="button" onClick={() => void syncAll()} disabled={!!busy || loading} className="rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50 disabled:opacity-50">Przelicz miesiąc</button>
          <button type="button" onClick={() => void exportXlsx()} disabled={!!busy || loading || employees.length === 0} className="rounded-lg bg-ink px-3 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">Eksport XLSX</button>
        </div>
      </header>

      {loadError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Do wypłaty" value={currency.format(totalDue)} tone="text-ink" />
        <Metric label="Pracownicy" value={String(employees.filter((employee) => employee.active).length)} tone="text-ink" />
        <Metric label="Zatwierdzone" value={String(approvedCount)} tone="text-sky-700" />
        <Metric label="Wypłacone / zamknięte" value={String(paidCount)} tone="text-emerald-700" />
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-lg bg-white p-3 shadow-panel sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-ink">{monthLabel(period)}</h2>
              <p className="text-xs text-steel">Wybierz osobę do rozliczenia</p>
            </div>
            <Link href="/settings/organization" className="text-xs font-semibold text-moss hover:underline">Stawki</Link>
          </div>
          <input className="input mt-3 w-full text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj pracownika" />
          <div className="mt-3 grid max-h-[34rem] gap-2 overflow-y-auto pr-1">
            {filteredEmployees.map((employee) => {
              const card = cardByEmployee.get(employee.id);
              const due = liveAmountDue(employee);
              return (
                <button key={employee.id} type="button" onClick={() => setSelectedId(employee.id)} className={`min-w-0 rounded-lg border p-3 text-left transition ${selectedId === employee.id ? "border-moss bg-moss/5" : "border-stone-200 hover:bg-stone-50"}`}>
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{employee.full_name}</p>
                      <p className="truncate text-xs text-steel">{employee.role_title} · {EMPLOYMENT_TYPE_LABELS[employee.employment_type]}</p>
                    </div>
                    {!employee.active && <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[0.65rem] font-semibold text-steel">archiwum</span>}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[0.68rem] font-bold ${settlementStatusTone(card?.status || "draft")}`}>{SETTLEMENT_STATUS_LABELS[card?.status || "draft"]}</span>
                    <span className="text-sm font-bold text-ink">{currency.format(Number(due))}</span>
                  </div>
                </button>
              );
            })}
            {!loading && filteredEmployees.length === 0 && <p className="rounded-lg border border-dashed border-stone-300 p-5 text-center text-sm text-steel">Brak pracowników.</p>}
          </div>
        </aside>

        <main className="grid min-w-0 gap-4">
          {loading ? <section className="rounded-lg bg-white p-8 text-center text-sm text-steel shadow-panel">Wczytywanie rozliczeń...</section> : selected && selectedCalculation ? (
            <>
              <SettlementHeader employee={selected} card={selectedCard} calculation={selectedCalculation} busy={busy} onSync={() => void syncEmployee(selected.id)} onStatus={(status) => void changeStatus(status)} />

              <section className="rounded-lg bg-white p-4 shadow-panel sm:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-ink">Podsumowanie miesiąca</h2>
                    <p className="mt-1 text-xs text-steel">Podstawa jest liczona z godzin, dni lub pensji miesięcznej zgodnie z profilem pracownika.</p>
                  </div>
                  <Link href="/time" className="text-sm font-semibold text-moss hover:underline">Ewidencja godzin</Link>
                </div>
                <SettlementBreakdown calculation={selectedCard || selectedCalculation} employee={selected} />
              </section>

              {selected.employment_type === "akord" && (
                <PieceworkBreakdown
                  entries={pieceworkEntries.filter((entry) => entry.employee_id === selected.id)}
                  activities={pieceworkActivities}
                  cases={cases}
                />
              )}

              <section className="rounded-lg bg-white p-4 shadow-panel sm:p-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-ink">Premie, zaliczki i korekty</h2>
                    <p className="mt-1 text-xs text-steel">Wpis można przypisać do budowy, aby koszt trafił również do analizy rentowności.</p>
                  </div>
                  {locked && <span className="rounded-md bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Karta zablokowana po zatwierdzeniu</span>}
                </div>

                {!locked && (
                  <div className="mt-4 grid gap-2 rounded-lg bg-stone-50 p-3 md:grid-cols-2 2xl:grid-cols-4">
                    <select className="input min-w-0 text-sm" value={entryForm.kind} onChange={(event) => setEntryForm((form) => ({ ...form, kind: event.target.value as EntryKind }))}>
                      {ENTRY_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                    </select>
                    <input className="input min-w-0 text-sm" inputMode="decimal" value={entryForm.amount} onChange={(event) => setEntryForm((form) => ({ ...form, amount: event.target.value }))} placeholder="Kwota PLN" />
                    <DateInput className="min-w-0 text-sm" value={entryForm.entry_date} onChange={(event) => setEntryForm((form) => ({ ...form, entry_date: event.target.value }))} />
                    <select className="input min-w-0 text-sm" value={entryForm.case_id} onChange={(event) => setEntryForm((form) => ({ ...form, case_id: event.target.value }))}>
                      <option value="">bez przypisania do budowy</option>
                      {cases.map((caseRow) => <option key={caseRow.id} value={caseRow.id}>{caseRow.client_name}{caseRow.location ? ` · ${caseRow.location}` : ""}</option>)}
                    </select>
                    <input className="input min-w-0 text-sm md:col-span-2" value={entryForm.title} onChange={(event) => setEntryForm((form) => ({ ...form, title: event.target.value }))} placeholder="Tytuł / powód" />
                    <input className="input min-w-0 text-sm md:col-span-2 2xl:col-span-1" value={entryForm.notes} onChange={(event) => setEntryForm((form) => ({ ...form, notes: event.target.value }))} placeholder="Uwagi" />
                    <button type="button" onClick={() => void addEntry()} disabled={busy === "entry"} className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:opacity-50">Dodaj wpis</button>
                  </div>
                )}

                <div className="mt-4 grid gap-2">
                  {selectedEntries.map((entry) => {
                    const caseRow = cases.find((item) => item.id === entry.case_id);
                    const positive = entryIsPositive(entry);
                    return (
                      <div key={entry.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-stone-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">{entry.title || entryLabel(entry)}</p>
                          <p className="mt-0.5 break-words text-xs text-steel">{entryLabel(entry)} · {formatDate(entry.entry_date)}{caseRow ? ` · ${caseRow.client_name}` : ""}{entry.notes ? ` · ${entry.notes}` : ""}</p>
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                          <span className={`font-bold ${positive ? "text-emerald-700" : "text-rose-700"}`}>{positive ? "+" : "−"}{currency.format(Number(entry.amount))}</span>
                          {!locked && <button type="button" onClick={() => void removeEntry(entry.id)} className="rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50">Usuń</button>}
                        </div>
                      </div>
                    );
                  })}
                  {selectedEntries.length === 0 && <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-steel">Brak dodatkowych wpisów w tym miesiącu.</p>}
                </div>
              </section>

              <section className="rounded-lg bg-white p-4 shadow-panel sm:p-5">
                <h2 className="text-lg font-bold text-ink">Historia karty</h2>
                <p className="mt-1 text-xs text-steel">Każde przeliczenie i zmiana statusu pozostawia ślad audytowy.</p>
                <div className="mt-4 grid gap-2">
                  {selectedHistory.map((item) => (
                    <div key={item.id} className="flex flex-col gap-1 border-b border-stone-100 py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                      <div><p className="text-sm font-semibold text-ink">{item.summary}</p><p className="text-xs text-steel">{item.action}</p></div>
                      <p className="text-xs text-steel">{formatDateTime(item.created_at)}</p>
                    </div>
                  ))}
                  {selectedHistory.length === 0 && <p className="text-sm text-steel">Historia pojawi się po utworzeniu pierwszej karty.</p>}
                </div>
              </section>
            </>
          ) : <section className="rounded-lg bg-white p-8 text-center text-sm text-steel shadow-panel">Dodaj pracownika w strukturze firmy, aby rozpocząć rozliczenia.</section>}
        </main>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="rounded-lg bg-white p-4 shadow-panel"><p className="text-xs text-steel">{label}</p><p className={`mt-1 break-words text-xl font-bold sm:text-2xl ${tone}`}>{value}</p></div>;
}

function SettlementHeader({ employee, card, calculation, busy, onSync, onStatus }: { employee: EmployeePayrollProfile; card: EmployeeMonthlySettlement | null; calculation: EmployeeSettlementCalculation; busy: string; onSync: () => void; onStatus: (status: EmployeeMonthlySettlementStatus) => void }) {
  const status = card?.status || "draft";
  const due = card?.amount_due ?? calculation.amount_due;
  return (
    <section className="rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words text-xl font-bold text-ink">{employee.full_name}</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${settlementStatusTone(status)}`}>{SETTLEMENT_STATUS_LABELS[status]}</span>
          </div>
          <p className="mt-1 text-sm text-steel">{employee.role_title} · {EMPLOYMENT_TYPE_LABELS[employee.employment_type]}</p>
          <p className="mt-3 text-xs font-semibold uppercase text-steel">Do wypłaty</p>
          <p className="mt-0.5 break-words text-3xl font-bold text-ink">{currency.format(Number(due))}</p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto lg:min-w-[360px]">
          {status === "draft" && <><button type="button" onClick={onSync} disabled={!!busy} className="rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50 disabled:opacity-50">Przelicz kartę</button><button type="button" onClick={() => onStatus("approved")} disabled={!!busy} className="rounded-lg bg-sky-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50">Zatwierdź miesiąc</button></>}
          {status === "approved" && <><button type="button" onClick={() => onStatus("draft")} disabled={!!busy} className="rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50 disabled:opacity-50">Cofnij do roboczej</button><button type="button" onClick={() => onStatus("paid")} disabled={!!busy} className="rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Oznacz jako wypłacone</button></>}
          {status === "paid" && <><button type="button" onClick={() => onStatus("approved")} disabled={!!busy} className="rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50 disabled:opacity-50">Cofnij wypłatę</button><button type="button" onClick={() => onStatus("closed")} disabled={!!busy} className="rounded-lg bg-ink px-3 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">Zamknij miesiąc</button></>}
          {status === "closed" && <p className="rounded-lg bg-stone-100 px-4 py-3 text-center text-sm font-semibold text-steel sm:col-span-2">Miesiąc zamknięty. Dane są tylko do odczytu.</p>}
        </div>
      </div>
    </section>
  );
}

function SettlementBreakdown({ calculation, employee }: { calculation: EmployeeSettlementCalculation | EmployeeMonthlySettlement; employee: EmployeePayrollProfile }) {
  const savedCard = "status" in calculation ? calculation : null;
  const employmentType = savedCard?.employment_type_snapshot || employee.employment_type;
  const hourlyRate = savedCard?.hourly_rate_snapshot ?? employee.hourly_rate ?? 0;
  const dayRate = savedCard?.day_rate_snapshot ?? employee.day_rate ?? 0;
  const monthlySalary = savedCard?.monthly_salary_snapshot ?? employee.monthly_salary ?? 0;
  const rate =
    employmentType === "godzinowka"
      ? `${currency.format(Number(hourlyRate))}/h`
      : employmentType === "dniowka"
        ? `${currency.format(Number(dayRate))}/dzień`
        : employmentType === "akord"
          ? "wg czynności"
          : currency.format(Number(monthlySalary));
  const rows = [
    ["Podstawa wynagrodzenia", calculation.base_amount, "plus"],
    ["Premie", calculation.bonuses_total, "plus"],
    ["Zwroty kosztów", calculation.reimbursements_total, "plus"],
    ["Korekty na plus", calculation.corrections_plus_total, "plus"],
    ["Potrącenia", calculation.deductions_total, "minus"],
    ["Korekty na minus", calculation.corrections_minus_total, "minus"],
    ["Zaliczki", calculation.advances_total, "minus"],
    ["Wypłaty częściowe", calculation.previous_payments_total, "minus"]
  ] as const;
  return (
    <div className="mt-4 grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
      <div className="grid gap-2 sm:grid-cols-3">
        {employmentType === "akord" ? (
          <SmallMetric label="Ilość akordowa" value={`${Number(calculation.piecework_quantity_total)}`} />
        ) : (
          <SmallMetric label="Godziny" value={`${Number(calculation.hours_total)} h`} />
        )}
        <SmallMetric label="Dni pracy" value={String(calculation.work_days_total)} />
        <SmallMetric label="Stawka" value={rate} />
      </div>
      <div className="rounded-lg border border-stone-200 p-3">
        {rows.map(([label, value, effect]) => <div key={label} className="flex items-center justify-between gap-3 py-1 text-sm"><span className="text-steel">{label}</span><span className={`shrink-0 font-semibold ${effect === "minus" && Number(value) > 0 ? "text-rose-700" : "text-ink"}`}>{effect === "minus" && Number(value) > 0 ? "−" : ""}{currency.format(Number(value))}</span></div>)}
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-stone-200 pt-3"><span className="font-bold text-ink">Do wypłaty</span><span className="text-lg font-bold text-ink">{currency.format(Number(calculation.amount_due))}</span></div>
      </div>
    </div>
  );
}

function PieceworkBreakdown({
  entries,
  activities,
  cases
}: {
  entries: EmployeePieceworkEntry[];
  activities: PieceworkActivity[];
  cases: Pick<CaseRow, "id" | "client_name" | "location">[];
}) {
  const activityById = new Map(activities.map((a) => [a.id, a]));
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const grouped = useMemo(() => {
    const map = new Map<string, { activity: PieceworkActivity | undefined; quantity: number; amount: number }>();
    for (const entry of entries) {
      const key = entry.activity_id;
      const current = map.get(key) || { activity: activityById.get(key), quantity: 0, amount: 0 };
      current.quantity += Number(entry.quantity);
      current.amount += Number(entry.quantity) * Number(entry.unit_rate_snapshot);
      map.set(key, current);
    }
    return Array.from(map.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);
  const total = grouped.reduce((s, g) => s + g.amount, 0);

  return (
    <section className="rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <h2 className="text-lg font-bold text-ink">Rozbicie akordu wg czynności</h2>
      <p className="mt-1 text-xs text-steel">Suma poniższych pozycji tworzy podstawę wynagrodzenia tego pracownika w wybranym miesiącu.</p>
      <div className="mt-4 grid gap-2">
        {grouped.map((g, i) => (
          <div key={g.activity?.id || i} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{g.activity?.name || "Usunięta czynność"}</p>
              <p className="text-xs text-steel">{g.quantity} {g.activity?.unit || ""} × {currency.format(Number(g.activity?.rate ?? (g.amount / (g.quantity || 1))))}</p>
            </div>
            <span className="shrink-0 font-bold text-ink">{currency.format(g.amount)}</span>
          </div>
        ))}
        {grouped.length === 0 && <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-steel">Brak wpisów akordowych w tym miesiącu.</p>}
      </div>
      {grouped.length > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-stone-200 pt-3 text-sm font-bold text-ink">
          <span>Razem akord</span>
          <span>{currency.format(total)}</span>
        </div>
      )}
      <div className="mt-4 grid gap-1.5">
        {entries
          .slice()
          .sort((a, b) => b.entry_date.localeCompare(a.entry_date))
          .map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-steel">
              <span>{formatDate(entry.entry_date)} · {activityById.get(entry.activity_id)?.name || "—"}{entry.case_id ? ` · ${caseById.get(entry.case_id)?.client_name || ""}` : ""}</span>
              <span className="font-semibold text-ink">{entry.quantity} × {currency.format(entry.unit_rate_snapshot)}</span>
            </div>
          ))}
      </div>
    </section>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-stone-50 p-3"><p className="text-xs text-steel">{label}</p><p className="mt-1 break-words text-lg font-bold text-ink">{value}</p></div>;
}
