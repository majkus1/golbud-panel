"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { DateInput } from "@/components/date-input";
import { canManageOrg, canViewPayroll, useOrg } from "@/components/org-context";
import { showToast } from "@/components/toast";
import { summarizeCompliance, type ComplianceDocument } from "@/lib/employee-compliance";
import { currency, formatDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { warsawTodayIso } from "@/lib/warsaw-today";
import type { Crew, EmployeeCompensation, EmployeeDepartment, EmployeeEmploymentType, EmployeePayrollProfile, JobPosition, OrgMemberProfile } from "@/lib/types";

const CUSTOM_POSITION_VALUE = "__custom__";

const DEPARTMENTS: { id: EmployeeDepartment; label: string }[] = [
  { id: "zarzad", label: "Zarząd" },
  { id: "biuro", label: "Biuro / asystentki" },
  { id: "handlowcy", label: "Handlowcy" },
  { id: "kierownicy", label: "Kierownicy" },
  { id: "brygada", label: "Brygady / pracownicy" },
  { id: "podwykonawcy", label: "Podwykonawcy" },
  { id: "bhp", label: "BHP" },
  { id: "inne", label: "Inne" }
];

const EMPLOYMENT_TYPES: { id: EmployeeEmploymentType; label: string }[] = [
  { id: "godzinowka", label: "Godzinówka" },
  { id: "dniowka", label: "Dniówka" },
  { id: "etat", label: "Etat" },
  { id: "ryczalt", label: "Ryczałt" },
  { id: "b2b", label: "B2B" },
  { id: "podwykonawca", label: "Podwykonawca" },
  { id: "akord", label: "Akord (wg wykonanych jednostek)" },
  { id: "inne", label: "Inne" }
];

type FormState = {
  id: string | null;
  full_name: string;
  role_title: string;
  department: EmployeeDepartment;
  employment_type: EmployeeEmploymentType;
  user_id: string;
  has_system_access: boolean;
  manager_employee_id: string;
  crew_id: string;
  hourly_rate: string;
  day_rate: string;
  monthly_salary: string;
  phone: string;
  email: string;
  bhp_valid_until: string;
  medical_valid_until: string;
  notes: string;
};

const emptyForm: FormState = {
  id: null,
  full_name: "",
  role_title: "",
  department: "brygada",
  employment_type: "godzinowka",
  user_id: "",
  has_system_access: false,
  manager_employee_id: "",
  crew_id: "",
  hourly_rate: "",
  day_rate: "",
  monthly_salary: "",
  phone: "",
  email: "",
  bhp_valid_until: "",
  medical_valid_until: "",
  notes: ""
};

function moneyOrDash(value: number | null) {
  return value != null && value > 0 ? currency.format(value) : "—";
}

function departmentLabel(value: EmployeeDepartment): string {
  return DEPARTMENTS.find((department) => department.id === value)?.label || value;
}

function dateTone(value: string | null): string {
  if (!value) return "bg-stone-100 text-steel";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${value}T00:00:00`);
  const days = Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "bg-rose-50 text-rose-700";
  if (days <= 30) return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
}

function parseAmount(value: string): number | null {
  const n = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export default function OrganizationSettingsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <OrganizationInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function OrganizationInner() {
  const { organizationId, role, userId } = useOrg();
  const canUse = canManageOrg(role);
  const showPayroll = canViewPayroll(role);
  const [employees, setEmployees] = useState<EmployeePayrollProfile[]>([]);
  // Dokumenty są potrzebne do oceny BHP i badań tą samą regułą co w Kadrach —
  // wcześniej ta strona patrzyła tylko na daty w profilu i pokazywała inne liczby.
  const [documents, setDocuments] = useState<ComplianceDocument[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [positions, setPositions] = useState<JobPosition[]>([]);
  const [members, setMembers] = useState<OrgMemberProfile[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    if (!organizationId || !canUse) return;
    setLoading(true);
    setLoadError("");
    const [empRes, compensationRes, crewRes, posRes, memRes, docRes] = await Promise.all([
      supabase.from("employee_profiles").select("*").eq("organization_id", organizationId).order("department").order("full_name"),
      showPayroll
        ? supabase.from("employee_compensation").select("employee_id,organization_id,hourly_rate,day_rate,monthly_salary,created_by,updated_by,created_at,updated_at").eq("organization_id", organizationId)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("crews").select("*").eq("organization_id", organizationId).order("name"),
      supabase.from("job_positions").select("*").eq("organization_id", organizationId).order("sort_order").order("name"),
      supabase.from("org_member_profiles").select("*").eq("organization_id", organizationId).order("email"),
      supabase.from("employee_documents").select("employee_id,document_type,status,valid_until").eq("organization_id", organizationId)
    ]);
    if (empRes.error) {
      const missing = empRes.error.message.includes("employee_profiles") || empRes.error.code === "42P01";
      setLoadError(missing ? "Brakuje tabel struktury firmy. Uruchom migrację 0035_org_profitability_settlements.sql." : empRes.error.message);
    }
    const compensationByEmployee = new Map(((compensationRes.data || []) as EmployeeCompensation[]).map((row) => [row.employee_id, row]));
    setEmployees((empRes.data || []).map((employee) => ({
      ...employee,
      hourly_rate: compensationByEmployee.get(employee.id)?.hourly_rate ?? null,
      day_rate: compensationByEmployee.get(employee.id)?.day_rate ?? null,
      monthly_salary: compensationByEmployee.get(employee.id)?.monthly_salary ?? null
    })) as EmployeePayrollProfile[]);
    setCrews((crewRes.data || []) as Crew[]);
    setPositions((posRes.data || []) as JobPosition[]);
    setMembers((memRes.data || []) as OrgMemberProfile[]);
    setDocuments((docRes.data || []) as ComplianceDocument[]);
    setLoading(false);
  }, [organizationId, canUse, showPayroll]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeEmployees = employees.filter((e) => e.active);
  const employeeById = useMemo(() => new Map(activeEmployees.map((e) => [e.id, e])), [activeEmployees]);
  const crewById = useMemo(() => new Map(crews.map((c) => [c.id, c.name])), [crews]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);

  const departmentStats = DEPARTMENTS.map((d) => ({
    ...d,
    count: activeEmployees.filter((e) => e.department === d.id).length
  }));

  // Ta sama reguła co w Kadrach (profil + dokumenty) — liczby na obu stronach muszą się zgadzać.
  const compliance = useMemo(() => summarizeCompliance(activeEmployees, documents, warsawTodayIso()), [activeEmployees, documents]);

  const edit = (employee: EmployeePayrollProfile) => {
    setForm({
      id: employee.id,
      full_name: employee.full_name,
      role_title: employee.role_title,
      department: employee.department,
      employment_type: employee.employment_type,
      user_id: employee.user_id ?? "",
      has_system_access: employee.has_system_access,
      manager_employee_id: employee.manager_employee_id ?? "",
      crew_id: employee.crew_id ?? "",
      hourly_rate: employee.hourly_rate == null ? "" : String(employee.hourly_rate),
      day_rate: employee.day_rate == null ? "" : String(employee.day_rate),
      monthly_salary: employee.monthly_salary == null ? "" : String(employee.monthly_salary),
      phone: employee.phone ?? "",
      email: employee.email ?? "",
      bhp_valid_until: employee.bhp_valid_until ?? "",
      medical_valid_until: employee.medical_valid_until ?? "",
      notes: employee.notes ?? ""
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!organizationId || !form.full_name.trim()) {
      showToast("Podaj imię i nazwisko.", "error");
      return;
    }
    setSaving(true);
    const payload = {
      organization_id: organizationId,
      full_name: form.full_name.trim(),
      role_title: form.role_title.trim() || "pracownik",
      department: form.department,
      employment_type: form.employment_type,
      user_id: form.user_id || null,
      has_system_access: form.has_system_access || !!form.user_id,
      manager_employee_id: form.manager_employee_id || null,
      crew_id: form.crew_id || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      bhp_valid_until: form.bhp_valid_until || null,
      medical_valid_until: form.medical_valid_until || null,
      notes: form.notes.trim() || null,
      created_by: userId
    };

    const res = form.id
      ? await supabase.from("employee_profiles").update(payload).eq("id", form.id).select("id").single()
      : await supabase.from("employee_profiles").insert(payload).select("id").single();

    let payrollError: string | null = null;
    const employeeId = res.data?.id as string | undefined;
    if (!res.error && employeeId && showPayroll) {
      const { error } = await supabase.rpc("save_employee_compensation", {
        target_org: organizationId,
        target_employee: employeeId,
        target_hourly_rate: parseAmount(form.hourly_rate),
        target_day_rate: parseAmount(form.day_rate),
        target_monthly_salary: parseAmount(form.monthly_salary)
      });
      payrollError = error?.message || null;
    }

    setSaving(false);
    if (res.error) {
      showToast(res.error.message, "error");
      return;
    }
    if (payrollError) {
      showToast(`Dane pracownika zapisano, ale nie udało się zapisać wynagrodzenia: ${payrollError}`, "error");
      await load();
      return;
    }
    showToast(form.id ? "Zapisano pracownika" : "Dodano pracownika");
    setForm(emptyForm);
    await load();
  };

  const archive = async (id: string) => {
    if (!confirm("Archiwizować pracownika? Dane rozliczeń zostaną zachowane.")) return;
    const { error } = await supabase.from("employee_profiles").update({ active: false }).eq("id", id);
    if (error) showToast(error.message, "error");
    else {
      showToast("Pracownik zarchiwizowany");
      await load();
    }
  };

  if (!organizationId) return null;
  if (!canUse) {
    return (
      <div className="rounded-lg bg-white p-6 shadow-panel">
        <h1 className="text-xl font-bold text-ink">Struktura firmy</h1>
        <p className="mt-2 text-sm text-steel">Dane pracowników, stawki i badania są dostępne tylko dla ról zarządczych.</p>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Ustawienia</p>
        <h1 className="mt-2 break-words text-2xl font-bold text-ink sm:text-3xl">Struktura firmy i pracownicy</h1>
        <p className="mt-1 max-w-3xl break-words text-sm leading-6 text-steel">
          Osoby z dostępem i bez dostępu do systemu, hierarchia, brygady, stawki, BHP, medycyna pracy i opisy do rozliczeń.
        </p>
      </div>

      {loadError && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p>}

      <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 rounded-lg bg-white p-4 shadow-panel">
          <p className="text-xs text-steel">Aktywni pracownicy</p>
          <p className="mt-1 text-2xl font-bold text-ink">{activeEmployees.length}</p>
        </div>
        <div className="min-w-0 rounded-lg bg-white p-4 shadow-panel">
          <p className="text-xs text-steel">Z dostępem do systemu</p>
          <p className="mt-1 text-2xl font-bold text-ink">{activeEmployees.filter((e) => e.has_system_access).length}</p>
        </div>
        <div className="min-w-0 rounded-lg bg-white p-4 shadow-panel">
          <p className="text-xs text-steel">BHP / badania po terminie lub wygasające</p>
          <p className={`mt-1 text-2xl font-bold ${compliance.expired > 0 ? "text-rose-700" : compliance.expiring > 0 ? "text-amber-700" : "text-ink"}`}>
            {compliance.expired + compliance.expiring}
          </p>
          <p className="mt-0.5 text-[0.7rem] text-steel">
            {compliance.expired} po terminie · {compliance.expiring} wygasa w ciągu 30 dni
          </p>
        </div>
        <div className="min-w-0 rounded-lg bg-white p-4 shadow-panel">
          <p className="text-xs text-steel">Brak danych o BHP lub badaniach</p>
          <p className="mt-1 text-2xl font-bold text-ink">{compliance.missing}</p>
          <p className="mt-0.5 text-[0.7rem] text-steel">brak wpisu w programie — niekoniecznie brak dokumentu</p>
        </div>
      </section>

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-ink">{form.id ? "Edytuj osobę" : "Dodaj osobę"}</h2>
              <p className="mt-1 break-words text-xs leading-5 text-steel">Pracownik może mieć konto w systemie albo być tylko do rozliczeń.</p>
            </div>
            {form.id && (
              <button type="button" onClick={() => setForm(emptyForm)} className="rounded-md border border-stone-300 px-2 py-1 text-xs font-semibold text-steel hover:bg-stone-50">
                nowa
              </button>
            )}
          </div>

          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Imię i nazwisko
              <input className="input font-normal" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
            </label>
            <RoleTitleField positions={positions} value={form.role_title} onChange={(value) => setForm((f) => ({ ...f, role_title: value }))} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Dział
                <select className="input font-normal" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value as EmployeeDepartment }))}>
                  {DEPARTMENTS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Rozliczenie
                <select className="input font-normal" value={form.employment_type} onChange={(e) => setForm((f) => ({ ...f, employment_type: e.target.value as EmployeeEmploymentType }))}>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="grid gap-1 text-xs font-semibold text-ink">
              Konto systemowe
              <select
                className="input font-normal"
                value={form.user_id}
                onChange={(e) => {
                  const member = memberById.get(e.target.value);
                  setForm((f) => ({
                    ...f,
                    user_id: e.target.value,
                    has_system_access: !!e.target.value,
                    email: f.email || member?.email || ""
                  }));
                }}
              >
                <option value="">brak dostępu do systemu</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.email || m.user_id} · {m.role}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Przełożony
                <select className="input font-normal" value={form.manager_employee_id} onChange={(e) => setForm((f) => ({ ...f, manager_employee_id: e.target.value }))}>
                  <option value="">brak</option>
                  {activeEmployees.filter((e) => e.id !== form.id).map((e) => (
                    <option key={e.id} value={e.id}>{e.full_name} · {e.role_title}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Brygada
                <select className="input font-normal" value={form.crew_id} onChange={(e) => setForm((f) => ({ ...f, crew_id: e.target.value }))}>
                  <option value="">bez brygady</option>
                  {crews.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
            </div>

            {showPayroll && form.employment_type === "akord" ? (
              <p className="rounded-lg bg-stone-50 px-3 py-2.5 text-xs text-steel">
                Stawka dla akordu jest ustalana per czynność w{" "}
                <Link href="/settings/piecework-activities" className="font-semibold text-moss-dark underline underline-offset-2">
                  słowniku czynności akordowych
                </Link>{" "}
                — pola stawki godzinowej/dniówki/pensji nie mają tu zastosowania.
              </p>
            ) : showPayroll ? (
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <label className="grid gap-1 text-xs font-semibold text-ink">
                  Stawka godzinowa
                  <input className="input font-normal" inputMode="decimal" value={form.hourly_rate} onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))} />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-ink">
                  Dniówka
                  <input className="input font-normal" inputMode="decimal" value={form.day_rate} onChange={(e) => setForm((f) => ({ ...f, day_rate: e.target.value }))} />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-ink">
                  Pensja miesięczna
                  <input className="input font-normal" inputMode="decimal" value={form.monthly_salary} onChange={(e) => setForm((f) => ({ ...f, monthly_salary: e.target.value }))} />
                </label>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Telefon
                <input className="input font-normal" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Email
                <input className="input font-normal" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="grid gap-1 text-xs font-semibold text-ink">
                BHP ważne do
                <DateInput className="font-normal" value={form.bhp_valid_until} onChange={(e) => setForm((f) => ({ ...f, bhp_valid_until: e.target.value }))} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Medycyna pracy do
                <DateInput className="font-normal" value={form.medical_valid_until} onChange={(e) => setForm((f) => ({ ...f, medical_valid_until: e.target.value }))} />
              </label>
            </div>

            <label className="grid gap-1 text-xs font-semibold text-ink">
              Opis / uwagi
              <textarea className="input min-h-[80px] font-normal" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>

            <button type="button" onClick={() => void save()} disabled={saving || loading} className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:opacity-60">
              {saving ? "Zapisywanie..." : form.id ? "Zapisz zmiany" : "Dodaj osobę"}
            </button>
          </div>
        </div>

        <div className="grid min-w-0 gap-4">
          <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
            <h2 className="text-lg font-bold text-ink">Lista pracowników</h2>
            <p className="mt-1 break-words text-xs leading-5 text-steel">Operacyjny widok osób, dostępów, BHP i medycyny pracy{showPayroll ? ", wraz ze stawkami dla uprawnionych ról" : ""}.</p>
            {loading ? (
              <p className="mt-4 text-sm text-steel">Wczytywanie...</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {activeEmployees.map((employee) => (
                  <EmployeeListCard
                    key={employee.id}
                    employee={employee}
                    manager={employeeById.get(employee.manager_employee_id || "") || null}
                    crewById={crewById}
                    onEdit={edit}
                    onArchive={(id) => void archive(id)}
                    showPayroll={showPayroll}
                  />
                ))}
                {activeEmployees.length === 0 && (
                  <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-steel">Brak pracowników. Dodaj pierwszą osobę.</p>
                )}
              </div>
            )}
          </section>

          <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
            <h2 className="text-lg font-bold text-ink">Podział firmy</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {departmentStats.map((d) => (
                <div key={d.id} className="min-w-0 rounded-lg border border-stone-200 p-3">
                  <p className="text-xs text-steel">{d.label}</p>
                  <p className="mt-1 text-xl font-bold text-ink">{d.count}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>

      <OrganizationTree employees={activeEmployees} employeeById={employeeById} crewById={crewById} onEdit={edit} />
    </div>
  );
}

function RoleTitleField({ positions, value, onChange }: { positions: JobPosition[]; value: string; onChange: (value: string) => void }) {
  const isKnown = value === "" || positions.some((p) => p.name === value);
  const [customMode, setCustomMode] = useState(!isKnown);

  useEffect(() => {
    setCustomMode(!(value === "" || positions.some((p) => p.name === value)));
  }, [value, positions]);

  return (
    <div className="grid gap-1 text-xs font-semibold text-ink">
      <div className="flex items-center justify-between">
        <span>Funkcja</span>
        <Link href="/settings/job-positions" className="text-[0.68rem] font-semibold text-moss-dark hover:underline">
          zarządzaj słownikiem
        </Link>
      </div>
      {customMode ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input flex-1 font-normal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="wpisz nazwę stanowiska"
            autoFocus
          />
          {positions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setCustomMode(false);
                onChange("");
              }}
              className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-stone-50"
            >
              wybierz ze słownika
            </button>
          )}
        </div>
      ) : (
        <select
          className="input font-normal"
          value={value}
          onChange={(e) => {
            if (e.target.value === CUSTOM_POSITION_VALUE) {
              setCustomMode(true);
              onChange("");
            } else {
              onChange(e.target.value);
            }
          }}
        >
          <option value="">— wybierz stanowisko —</option>
          {positions.map((p) => (
            <option key={p.id} value={p.name}>{p.name}</option>
          ))}
          <option value={CUSTOM_POSITION_VALUE}>inne (wpisz własne)</option>
        </select>
      )}
    </div>
  );
}

function EmployeeListCard({
  employee,
  manager,
  crewById,
  onEdit,
  onArchive,
  showPayroll
}: {
  employee: EmployeePayrollProfile;
  manager: EmployeePayrollProfile | null;
  crewById: Map<string, string>;
  onEdit: (employee: EmployeePayrollProfile) => void;
  onArchive: (id: string) => void;
  showPayroll: boolean;
}) {
  return (
    <article className="min-w-0 rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 break-words font-bold text-ink">{employee.full_name}</p>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[0.68rem] font-bold text-steel">{employee.role_title}</span>
            <span className={`rounded-full px-2 py-0.5 text-[0.68rem] font-bold ${employee.has_system_access ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {employee.has_system_access ? "ma dostęp" : "bez dostępu"}
            </span>
          </div>
          <p className="mt-1 break-words text-xs leading-5 text-steel">
            {departmentLabel(employee.department)} · {crewById.get(employee.crew_id || "") || "bez brygady"} · przełożony: {manager?.full_name || "brak"}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3 lg:flex lg:flex-wrap">
          <Link href={`/hr?employee=${employee.id}`} className="rounded-md bg-ink px-3 py-1.5 text-center text-xs font-semibold text-white hover:bg-moss">
            Karta HR
          </Link>
          <button type="button" onClick={() => onEdit(employee)} className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50">
            Edytuj
          </button>
          <button type="button" onClick={() => onArchive(employee.id)} className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">
            Archiwizuj
          </button>
        </div>
      </div>
      <div className="mt-3 grid min-w-0 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Badge label="BHP" value={employee.bhp_valid_until ? formatDate(employee.bhp_valid_until) : "brak"} tone={dateTone(employee.bhp_valid_until)} />
        <Badge label="Medycyna" value={employee.medical_valid_until ? formatDate(employee.medical_valid_until) : "brak"} tone={dateTone(employee.medical_valid_until)} />
        <Badge label="Telefon" value={employee.phone || "—"} tone="bg-stone-100 text-steel" />
        {showPayroll ? <Badge
          label="Stawka"
          value={employee.employment_type === "akord" ? "akord wg czynności" : `godz. ${moneyOrDash(employee.hourly_rate)} / dn. ${moneyOrDash(employee.day_rate)}`}
          tone="bg-stone-100 text-steel"
        /> : null}
      </div>
      {employee.notes && <p className="mt-3 break-words rounded-md bg-stone-50 px-3 py-2 text-sm leading-6 text-steel">{employee.notes}</p>}
    </article>
  );
}

const NO_CREW_FILTER = "__no_crew__";

function OrganizationTree({
  employees,
  employeeById,
  crewById,
  onEdit
}: {
  employees: EmployeePayrollProfile[];
  employeeById: Map<string, EmployeePayrollProfile>;
  crewById: Map<string, string>;
  onEdit: (employee: EmployeePayrollProfile) => void;
}) {
  const [crewFilter, setCrewFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [accessFilter, setAccessFilter] = useState<"" | "yes" | "no">("");

  const crewOptions = useMemo(
    () => Array.from(crewById.entries()).sort((a, b) => a[1].localeCompare(b[1], "pl")),
    [crewById]
  );

  const filtered = useMemo(
    () =>
      employees.filter((employee) => {
        if (departmentFilter && employee.department !== departmentFilter) return false;
        if (accessFilter === "yes" && !employee.has_system_access) return false;
        if (accessFilter === "no" && employee.has_system_access) return false;
        if (crewFilter === NO_CREW_FILTER && employee.crew_id) return false;
        if (crewFilter && crewFilter !== NO_CREW_FILTER && employee.crew_id !== crewFilter) return false;
        return true;
      }),
    [employees, departmentFilter, accessFilter, crewFilter]
  );

  const filtersActive = !!crewFilter || !!departmentFilter || !!accessFilter;
  const filteredIds = useMemo(() => new Set(filtered.map((e) => e.id)), [filtered]);
  const roots = filtered.filter((employee) => !employee.manager_employee_id || !filteredIds.has(employee.manager_employee_id));

  const resetFilters = () => {
    setCrewFilter("");
    setDepartmentFilter("");
    setAccessFilter("");
  };

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-steel">Schemat organizacyjny</p>
          <h2 className="mt-1 break-words text-xl font-bold text-ink">Graficzne drzewko hierarchii</h2>
          <p className="mt-1 max-w-3xl break-words text-sm leading-6 text-steel">Czysty widok zależności służbowych bez terminów badań i dokumentów. Karty pokazują tylko osobę, dział, rolę, brygadę i dostęp do systemu.</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-stone-100 pt-4">
        <label className="grid gap-1 text-xs font-semibold text-ink">
          Brygada
          <select className="input min-w-[180px] font-normal" value={crewFilter} onChange={(e) => setCrewFilter(e.target.value)}>
            <option value="">Wszystkie brygady</option>
            <option value={NO_CREW_FILTER}>Bez brygady</option>
            {crewOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink">
          Dział
          <select className="input min-w-[180px] font-normal" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
            <option value="">Wszystkie działy</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-1 text-xs font-semibold text-ink">
          Dostęp
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAccessFilter((v) => (v === "yes" ? "" : "yes"))}
              className={`rounded-full px-3 py-1 font-semibold transition ${
                accessFilter === "yes" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              }`}
            >
              ma dostęp
            </button>
            <button
              type="button"
              onClick={() => setAccessFilter((v) => (v === "no" ? "" : "no"))}
              className={`rounded-full px-3 py-1 font-semibold transition ${
                accessFilter === "no" ? "bg-amber-600 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100"
              }`}
            >
              bez dostępu
            </button>
          </div>
        </div>
        {filtersActive && (
          <button type="button" onClick={resetFilters} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-moss hover:underline">
            Wyczyść filtry
          </button>
        )}
        <p className="ml-auto text-xs text-steel">
          {filtered.length} / {employees.length} osób
        </p>
      </div>

      {employees.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-steel">Brak pracowników do pokazania w schemacie.</p>
      ) : filtered.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-steel">Brak pracowników spełniających wybrane filtry.</p>
      ) : (
        <div className="mt-5 max-w-full overflow-x-auto overscroll-x-contain pb-2 [scrollbar-gutter:stable]">
          <p className="mb-2 text-[0.7rem] text-stone-400 sm:hidden">Schemat przewija się w bok — przesuń palcem.</p>
          <div className="flex min-w-max items-start gap-6 pr-4">
            {roots.map((root) => (
              <TreeBranch key={root.id} employee={root} employees={filtered} crewById={crewById} onEdit={onEdit} depth={0} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function TreeBranch({
  employee,
  employees,
  crewById,
  onEdit,
  depth
}: {
  employee: EmployeePayrollProfile;
  employees: EmployeePayrollProfile[];
  crewById: Map<string, string>;
  onEdit: (employee: EmployeePayrollProfile) => void;
  depth: number;
}) {
  const children = employees.filter((item) => item.manager_employee_id === employee.id);
  const accent =
    employee.department === "zarzad"
      ? "border-ink"
      : employee.department === "kierownicy"
        ? "border-moss"
        : employee.department === "handlowcy"
          ? "border-sky-500"
          : "border-stone-300";
  return (
    <div className="flex min-w-[220px] flex-col items-center">
      <button
        type="button"
        onClick={() => onEdit(employee)}
        className={`w-[220px] rounded-lg border-t-4 ${accent} border-x border-b border-stone-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">{employee.full_name}</p>
            <p className="mt-1 truncate text-xs font-semibold text-moss">{employee.role_title}</p>
          </div>
          <span className={`size-2.5 shrink-0 rounded-full ${employee.has_system_access ? "bg-emerald-500" : "bg-amber-500"}`} />
        </div>
        <div className="mt-3 grid gap-1 text-[0.7rem] text-steel">
          <p className="truncate">{departmentLabel(employee.department)}</p>
          <p className="truncate">{crewById.get(employee.crew_id || "") || "bez brygady"}</p>
        </div>
      </button>
      {children.length > 0 && (
        <>
          <div className="h-5 w-px bg-stone-300" />
          <div className="flex items-start">
            {/* Pozioma kreska jest składana z połówek przy każdym dziecku, a nie rysowana jedną
                belką o stałych marginesach. Wcześniej belka zakładała, że każda kolumna ma 220 px —
                gdy dziecko miało własne poddrzewo, jego kolumna była szersza i linia nie dochodziła
                do pionowej kreski, a przy szerokich poddrzewach wychodziła poza widoczny obszar. */}
            {children.map((child, index) => {
              const first = index === 0;
              const last = index === children.length - 1;
              return (
                <div key={child.id} className="relative flex flex-col items-center px-2">
                  {!first && <div className="absolute left-0 right-1/2 top-0 h-px bg-stone-300" />}
                  {!last && <div className="absolute left-1/2 right-0 top-0 h-px bg-stone-300" />}
                  <div className="h-5 w-px bg-stone-300" />
                  <TreeBranch employee={child} employees={employees} crewById={crewById} onEdit={onEdit} depth={depth + 1} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`min-w-0 rounded-md px-3 py-2 ${tone}`}>
      <p className="font-semibold">{label}</p>
      <p className="mt-0.5 break-words">{value}</p>
    </div>
  );
}
