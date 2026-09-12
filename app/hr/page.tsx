"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { DateInput } from "@/components/date-input";
import { canManageOrg, canViewPayroll, useOrg } from "@/components/org-context";
import { showToast } from "@/components/toast";
import { formatDate } from "@/lib/format";
import {
  documentExpiryLabel,
  documentExpiryTone,
  EMPLOYEE_DOCUMENT_TYPE_LABELS,
  RENEWABLE_DOCUMENT_TYPES,
  safeStorageFilename,
  daysUntilDate
} from "@/lib/hr";
import { summarizeCompliance } from "@/lib/employee-compliance";
import { supabase } from "@/lib/supabase";
import { warsawTodayIso } from "@/lib/warsaw-today";
import type {
  Crew,
  EmployeeCrewHistory,
  EmployeeDepartment,
  EmployeeDocument,
  EmployeeDocumentType,
  EmployeeEmploymentType,
  EmployeePositionHistory,
  EmployeeProfile
} from "@/lib/types";

type Tab = "overview" | "documents" | "history";

const DEPARTMENTS: { id: EmployeeDepartment; label: string }[] = [
  { id: "zarzad", label: "Zarząd" }, { id: "biuro", label: "Biuro" }, { id: "handlowcy", label: "Handlowcy" },
  { id: "kierownicy", label: "Kierownicy" }, { id: "brygada", label: "Brygada" }, { id: "podwykonawcy", label: "Podwykonawcy" },
  { id: "bhp", label: "BHP" }, { id: "inne", label: "Inne" }
];

const EMPLOYMENT_TYPES: { id: EmployeeEmploymentType; label: string }[] = [
  { id: "godzinowka", label: "Godzinówka" }, { id: "dniowka", label: "Dniówka" }, { id: "etat", label: "Etat" },
  { id: "ryczalt", label: "Ryczałt" }, { id: "b2b", label: "B2B" }, { id: "podwykonawca", label: "Podwykonawca" },
  { id: "akord", label: "Akord" }, { id: "inne", label: "Inne" }
];

function departmentLabel(value: EmployeeDepartment): string {
  return DEPARTMENTS.find((item) => item.id === value)?.label || value;
}

function employmentLabel(value: EmployeeEmploymentType): string {
  return EMPLOYMENT_TYPES.find((item) => item.id === value)?.label || value;
}

function emptyDocumentForm() {
  return {
    document_type: "bhp" as EmployeeDocumentType,
    title: EMPLOYEE_DOCUMENT_TYPE_LABELS.bhp,
    document_number: "",
    issued_at: "",
    valid_from: "",
    valid_until: "",
    requires_renewal: true,
    notes: ""
  };
}

export default function HrPage() {
  return <AuthGate>{() => <AppShell><HrInner /></AppShell>}</AuthGate>;
}

function HrInner() {
  const searchParams = useSearchParams();
  const requestedEmployee = searchParams.get("employee");
  const { organizationId, role, userId } = useOrg();
  const canUse = canManageOrg(role);
  const showPayroll = canViewPayroll(role);
  const today = warsawTodayIso();
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [positions, setPositions] = useState<EmployeePositionHistory[]>([]);
  const [crewHistory, setCrewHistory] = useState<EmployeeCrewHistory[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  const [documentForm, setDocumentForm] = useState(emptyDocumentForm());
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [positionForm, setPositionForm] = useState({ role_title: "", department: "brygada" as EmployeeDepartment, employment_type: "godzinowka" as EmployeeEmploymentType, manager_employee_id: "", valid_from: today, notes: "" });
  const [crewForm, setCrewForm] = useState({ crew_id: "", valid_from: today, notes: "" });

  const load = useCallback(async () => {
    if (!organizationId || !canUse) return;
    setLoading(true);
    setLoadError("");
    const [employeeRes, documentRes, positionRes, crewHistoryRes, crewRes] = await Promise.all([
      supabase.from("employee_profiles").select("*").eq("organization_id", organizationId).order("active", { ascending: false }).order("full_name"),
      supabase.from("employee_documents").select("*").eq("organization_id", organizationId).order("valid_until", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }),
      supabase.from("employee_position_history").select("*").eq("organization_id", organizationId).order("valid_from", { ascending: false }),
      supabase.from("employee_crew_history").select("*").eq("organization_id", organizationId).order("valid_from", { ascending: false }),
      supabase.from("crews").select("*").eq("organization_id", organizationId).order("name")
    ]);
    const error = employeeRes.error || documentRes.error || positionRes.error || crewHistoryRes.error || crewRes.error;
    if (error) {
      const missing = error.code === "42P01" || error.message.includes("employee_documents");
      setLoadError(missing ? "Uruchom migrację 0040_employee_hr_documents_history.sql w Supabase." : error.message);
    }
    const loadedEmployees = (employeeRes.data || []) as EmployeeProfile[];
    setEmployees(loadedEmployees);
    setDocuments((documentRes.data || []) as EmployeeDocument[]);
    setPositions((positionRes.data || []) as EmployeePositionHistory[]);
    setCrewHistory((crewHistoryRes.data || []) as EmployeeCrewHistory[]);
    setCrews((crewRes.data || []) as Crew[]);
    setSelectedId((current) => {
      if (requestedEmployee && loadedEmployees.some((employee) => employee.id === requestedEmployee)) return requestedEmployee;
      if (current && loadedEmployees.some((employee) => employee.id === current)) return current;
      return loadedEmployees[0]?.id || "";
    });
    setLoading(false);
  }, [organizationId, canUse, requestedEmployee]);

  useEffect(() => { void load(); }, [load]);

  const selected = employees.find((employee) => employee.id === selectedId) || null;
  const selectedDocuments = documents.filter((document) => document.employee_id === selectedId && document.status === "active");
  const selectedArchivedDocuments = documents.filter((document) => document.employee_id === selectedId && document.status === "archived");
  const selectedPositions = positions.filter((item) => item.employee_id === selectedId);
  const selectedCrews = crewHistory.filter((item) => item.employee_id === selectedId);
  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const crewById = useMemo(() => new Map(crews.map((crew) => [crew.id, crew.name])), [crews]);

  useEffect(() => {
    if (!selected) return;
    setPositionForm({ role_title: selected.role_title, department: selected.department, employment_type: selected.employment_type, manager_employee_id: selected.manager_employee_id || "", valid_from: today, notes: "" });
    setCrewForm({ crew_id: selected.crew_id || "", valid_from: today, notes: "" });
    setDocumentForm(emptyDocumentForm());
    setDocumentFile(null);
  }, [selectedId, selected, today]);

  const activeEmployees = employees.filter((employee) => employee.active);
  const expiring = documents.filter((document) => document.status === "active" && document.requires_renewal && document.valid_until && (daysUntilDate(document.valid_until, today) ?? 999) >= 0 && (daysUntilDate(document.valid_until, today) ?? 999) <= 30);
  const overdue = documents.filter((document) => document.status === "active" && document.requires_renewal && document.valid_until && (daysUntilDate(document.valid_until, today) ?? 0) < 0);
  // Ta sama reguła co w Strukturze firmy (profil + dokumenty) — obie strony mają pokazywać
  // tę samą liczbę; „brak danych” to brak wpisu w programie, nie brak dokumentu.
  const compliance = summarizeCompliance(activeEmployees, documents, today);
  const filteredEmployees = employees.filter((employee) => `${employee.full_name} ${employee.role_title}`.toLocaleLowerCase("pl-PL").includes(search.trim().toLocaleLowerCase("pl-PL")));

  const saveDocument = async () => {
    if (!organizationId || !selected || !documentForm.title.trim()) return;
    if (documentForm.requires_renewal && !documentForm.valid_until) {
      showToast("Dokument odnawialny musi mieć termin ważności.", "error");
      return;
    }
    if (documentFile && documentFile.size > 10 * 1024 * 1024) {
      showToast("Plik może mieć maksymalnie 10 MB.", "error");
      return;
    }
    setBusy("document");
    let storagePath: string | null = null;
    if (documentFile) {
      storagePath = `${organizationId}/${selected.id}/${crypto.randomUUID()}-${safeStorageFilename(documentFile.name)}`;
      const { error } = await supabase.storage.from("employee-documents").upload(storagePath, documentFile, { contentType: documentFile.type || "application/octet-stream", upsert: false });
      if (error) {
        setBusy("");
        showToast(error.message, "error");
        return;
      }
    }
    const quickDocument = documents.find((document) =>
      document.employee_id === selected.id
      && document.document_type === documentForm.document_type
      && document.source_key === `profile_${documentForm.document_type}`
    );
    const payload = {
      organization_id: organizationId,
      employee_id: selected.id,
      document_type: documentForm.document_type,
      title: documentForm.title.trim(),
      document_number: documentForm.document_number.trim() || null,
      issued_at: documentForm.issued_at || null,
      valid_from: documentForm.valid_from || null,
      valid_until: documentForm.valid_until || null,
      requires_renewal: documentForm.requires_renewal,
      storage_path: storagePath,
      file_name: documentFile?.name || null,
      mime_type: documentFile?.type || null,
      size_bytes: documentFile?.size || null,
      notes: documentForm.notes.trim() || null,
      created_by: userId
    };
    const { error } = quickDocument
      ? await supabase.from("employee_documents").update(payload).eq("id", quickDocument.id)
      : await supabase.from("employee_documents").insert(payload);
    if (error && storagePath) await supabase.storage.from("employee-documents").remove([storagePath]);
    setBusy("");
    if (error) showToast(error.message, "error");
    else {
      showToast("Dokument zapisany w karcie pracownika");
      setDocumentForm(emptyDocumentForm());
      setDocumentFile(null);
      await load();
    }
  };

  const openDocument = async (document: EmployeeDocument) => {
    if (!document.storage_path) return;
    const { data, error } = await supabase.storage.from("employee-documents").createSignedUrl(document.storage_path, 300);
    if (error || !data?.signedUrl) showToast(error?.message || "Nie udało się otworzyć pliku.", "error");
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const archiveDocument = async (document: EmployeeDocument) => {
    if (!confirm(`Archiwizować dokument „${document.title}”? Plik pozostanie w historii pracownika.`)) return;
    const { error } = await supabase.from("employee_documents").update({ status: "archived" }).eq("id", document.id);
    if (error) showToast(error.message, "error"); else { showToast("Dokument zarchiwizowany"); await load(); }
  };

  const savePosition = async () => {
    if (!selected || !positionForm.role_title.trim()) return;
    setBusy("position");
    const { error } = await supabase.rpc("set_employee_position_assignment", {
      p_employee_id: selected.id,
      p_role_title: positionForm.role_title.trim(),
      p_department: positionForm.department,
      p_employment_type: positionForm.employment_type,
      p_manager_employee_id: positionForm.manager_employee_id || null,
      p_valid_from: positionForm.valid_from,
      p_notes: positionForm.notes.trim() || null
    });
    setBusy("");
    if (error) showToast(error.message, "error"); else { showToast("Zmiana stanowiska zapisana w historii"); await load(); }
  };

  const saveCrew = async () => {
    if (!selected) return;
    setBusy("crew");
    const { error } = await supabase.rpc("set_employee_crew_assignment", {
      p_employee_id: selected.id,
      p_crew_id: crewForm.crew_id || null,
      p_valid_from: crewForm.valid_from,
      p_notes: crewForm.notes.trim() || null
    });
    setBusy("");
    if (error) showToast(error.message, "error"); else { showToast("Przypisanie do brygady zapisane"); await load(); }
  };

  if (!organizationId) return null;
  if (!canUse) return <section className="rounded-lg bg-white p-6 shadow-panel"><h1 className="text-xl font-bold text-ink">Kadry i dokumenty</h1><p className="mt-2 text-sm text-steel">Dane kadrowe są dostępne wyłącznie dla właściciela, biura i kierownika.</p></section>;

  return (
    <div className="grid min-w-0 gap-5">
      <header className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0"><p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Kadry</p><h1 className="mt-1 text-2xl font-bold text-ink sm:text-3xl">Pracownicy i dokumenty</h1><p className="mt-1 max-w-3xl text-sm text-steel">Terminy, dokumenty, stanowiska i historia pracy w jednym miejscu.</p></div>
        <div className="flex flex-wrap gap-2"><Link href="/calendar" className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-ink hover:bg-stone-50">Kalendarz terminów</Link><Link href="/settings/organization" className="rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-moss">Struktura firmy</Link></div>
      </header>
      {loadError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p>}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Aktywni pracownicy" value={String(activeEmployees.length)} tone="text-ink" />
        <Metric label="Dokumenty wygasające w ciągu 30 dni" value={String(expiring.length)} tone="text-amber-700" />
        <Metric label="Dokumenty po terminie" value={String(overdue.length)} tone="text-rose-700" />
        <Metric label="Brak danych o BHP lub badaniach" value={String(compliance.missing)} tone={compliance.missing > 0 ? "text-amber-700" : "text-ink"} />
      </section>

      <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-lg bg-white p-3 shadow-panel sm:p-4">
          <h2 className="font-bold text-ink">Zespół</h2><p className="text-xs text-steel">Wybierz kartę pracownika</p>
          <input className="input mt-3 w-full text-sm" placeholder="Szukaj osoby" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="mt-3 grid max-h-[38rem] gap-2 overflow-y-auto pr-1">
            {filteredEmployees.map((employee) => {
              const own = documents.filter((document) => document.employee_id === employee.id && document.status === "active");
              const risk = own.some((document) => document.requires_renewal && (!document.valid_until || (daysUntilDate(document.valid_until, today) ?? 99) <= 30));
              return <button key={employee.id} type="button" onClick={() => setSelectedId(employee.id)} className={`min-w-0 rounded-lg border p-3 text-left ${selectedId === employee.id ? "border-moss bg-moss/5" : "border-stone-200 hover:bg-stone-50"}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-bold text-ink">{employee.full_name}</p><p className="truncate text-xs text-steel">{employee.role_title} · {crewById.get(employee.crew_id || "") || "bez brygady"}</p></div>{risk && <span className="size-2 shrink-0 rounded-full bg-amber-500" title="Termin wymaga uwagi" />}</div><div className="mt-2 flex items-center justify-between text-[0.68rem]"><span className={employee.active ? "text-emerald-700" : "text-steel"}>{employee.active ? "aktywny" : "archiwalny"}</span><span className="text-steel">{own.length} dok.</span></div></button>;
            })}
            {!loading && filteredEmployees.length === 0 && <p className="rounded-lg border border-dashed border-stone-300 p-5 text-center text-sm text-steel">Brak pracowników.</p>}
          </div>
        </aside>

        <main className="grid min-w-0 gap-4">
          {loading ? <section className="rounded-lg bg-white p-8 text-center text-sm text-steel shadow-panel">Wczytywanie danych HR...</section> : selected ? <>
            <section className="rounded-lg bg-white p-4 shadow-panel sm:p-5"><div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-xl font-bold text-ink">{selected.full_name}</h2><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${selected.active ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-steel"}`}>{selected.active ? "aktywny" : "archiwalny"}</span></div><p className="mt-1 text-sm text-steel">{selected.role_title} · {departmentLabel(selected.department)} · {crewById.get(selected.crew_id || "") || "bez brygady"}</p></div><div className="flex flex-wrap gap-2">{showPayroll ? <Link href={`/settlements/employees?employee=${selected.id}`} className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50">Rozliczenia</Link> : null}<Link href="/settings/organization" className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50">Edytuj dane</Link></div></div>
              <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1">{([['overview','Podsumowanie'],['documents','Dokumenty'],['history','Historia']] as [Tab,string][]).map(([id,label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`min-w-0 rounded-md px-2 py-2 text-xs font-semibold sm:text-sm ${tab === id ? "bg-white text-ink shadow-sm" : "text-steel hover:text-ink"}`}>{label}</button>)}</div>
            </section>

            {tab === "overview" && <Overview employee={selected} documents={selectedDocuments} positions={selectedPositions} crews={selectedCrews} crewById={crewById} employeeById={employeeById} today={today} onDocuments={() => setTab("documents")} />}
            {tab === "documents" && <section className="grid min-w-0 gap-4"><section className="rounded-lg bg-white p-4 shadow-panel sm:p-5"><h3 className="text-lg font-bold text-ink">Dodaj dokument</h3><p className="mt-1 text-xs text-steel">Plik jest opcjonalny. Dla samego terminu możesz zapisać dokument bez załącznika.</p><div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              <label className="grid gap-1 text-xs font-semibold text-ink">Typ<select className="input font-normal" value={documentForm.document_type} onChange={(event) => { const type = event.target.value as EmployeeDocumentType; setDocumentForm((form) => ({ ...form, document_type: type, title: EMPLOYEE_DOCUMENT_TYPE_LABELS[type], requires_renewal: RENEWABLE_DOCUMENT_TYPES.includes(type) })); }}><option value="bhp">Szkolenie BHP</option><option value="medical">Badania lekarskie</option><option value="training">Szkolenie</option><option value="qualification">Uprawnienie</option><option value="contract">Umowa</option><option value="annex">Aneks</option><option value="certificate">Zaświadczenie</option><option value="other">Inny dokument</option></select></label>
              <Field label="Nazwa dokumentu"><input className="input font-normal" value={documentForm.title} onChange={(event) => setDocumentForm((form) => ({ ...form, title: event.target.value }))} /></Field><Field label="Numer dokumentu"><input className="input font-normal" value={documentForm.document_number} onChange={(event) => setDocumentForm((form) => ({ ...form, document_number: event.target.value }))} /></Field>
              <Field label="Data wystawienia"><DateInput className="font-normal" value={documentForm.issued_at} onChange={(event) => setDocumentForm((form) => ({ ...form, issued_at: event.target.value }))} /></Field><Field label="Ważny od"><DateInput className="font-normal" value={documentForm.valid_from} onChange={(event) => setDocumentForm((form) => ({ ...form, valid_from: event.target.value }))} /></Field><Field label="Ważny do"><DateInput className="font-normal" value={documentForm.valid_until} onChange={(event) => setDocumentForm((form) => ({ ...form, valid_until: event.target.value }))} /></Field>
              <label className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2.5 text-sm text-ink"><input type="checkbox" checked={documentForm.requires_renewal} onChange={(event) => setDocumentForm((form) => ({ ...form, requires_renewal: event.target.checked }))} />Pilnuj terminu i wysyłaj alerty</label><label className="grid gap-1 text-xs font-semibold text-ink md:col-span-2"><span>Plik PDF, zdjęcie lub dokument · maks. 10 MB</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/*" onChange={(event) => setDocumentFile(event.target.files?.[0] || null)} className="block min-w-0 text-sm text-steel file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:font-semibold file:text-ink" /></label><Field label="Uwagi"><input className="input font-normal" value={documentForm.notes} onChange={(event) => setDocumentForm((form) => ({ ...form, notes: event.target.value }))} /></Field>
            </div><button type="button" onClick={() => void saveDocument()} disabled={busy === "document"} className="mt-4 w-full rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:opacity-50 sm:w-auto">{busy === "document" ? "Zapisywanie..." : "Zapisz dokument"}</button></section>
              <DocumentList title="Aktywne dokumenty" documents={selectedDocuments} today={today} onOpen={openDocument} onArchive={archiveDocument} />
              {selectedArchivedDocuments.length > 0 && <DocumentList title="Archiwum dokumentów" documents={selectedArchivedDocuments} today={today} onOpen={openDocument} />}
            </section>}

            {tab === "history" && <section className="grid min-w-0 gap-4 xl:grid-cols-2"><section className="rounded-lg bg-white p-4 shadow-panel sm:p-5"><h3 className="text-lg font-bold text-ink">Zmiana stanowiska</h3><p className="mt-1 text-xs text-steel">Zapis zamknie poprzedni okres i zachowa pełną historię.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Stanowisko"><input className="input font-normal" value={positionForm.role_title} onChange={(event) => setPositionForm((form) => ({ ...form, role_title: event.target.value }))} /></Field><label className="grid gap-1 text-xs font-semibold text-ink">Dział<select className="input font-normal" value={positionForm.department} onChange={(event) => setPositionForm((form) => ({ ...form, department: event.target.value as EmployeeDepartment }))}>{DEPARTMENTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-ink">Forma rozliczenia<select className="input font-normal" value={positionForm.employment_type} onChange={(event) => setPositionForm((form) => ({ ...form, employment_type: event.target.value as EmployeeEmploymentType }))}>{EMPLOYMENT_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-ink">Przełożony<select className="input font-normal" value={positionForm.manager_employee_id} onChange={(event) => setPositionForm((form) => ({ ...form, manager_employee_id: event.target.value }))}><option value="">brak</option>{activeEmployees.filter((employee) => employee.id !== selected.id).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label><Field label="Obowiązuje od"><DateInput className="font-normal" value={positionForm.valid_from} onChange={(event) => setPositionForm((form) => ({ ...form, valid_from: event.target.value }))} /></Field><Field label="Powód / uwagi"><input className="input font-normal" value={positionForm.notes} onChange={(event) => setPositionForm((form) => ({ ...form, notes: event.target.value }))} /></Field></div><button type="button" onClick={() => void savePosition()} disabled={busy === "position"} className="mt-4 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">Zapisz zmianę stanowiska</button></section>
              <section className="rounded-lg bg-white p-4 shadow-panel sm:p-5"><h3 className="text-lg font-bold text-ink">Zmiana brygady</h3><p className="mt-1 text-xs text-steel">Widać, w jakiej ekipie pracownik był w każdym okresie.</p><div className="mt-4 grid gap-3"><label className="grid gap-1 text-xs font-semibold text-ink">Brygada<select className="input font-normal" value={crewForm.crew_id} onChange={(event) => setCrewForm((form) => ({ ...form, crew_id: event.target.value }))}><option value="">bez brygady</option>{crews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}</select></label><Field label="Obowiązuje od"><DateInput className="font-normal" value={crewForm.valid_from} onChange={(event) => setCrewForm((form) => ({ ...form, valid_from: event.target.value }))} /></Field><Field label="Powód / uwagi"><input className="input font-normal" value={crewForm.notes} onChange={(event) => setCrewForm((form) => ({ ...form, notes: event.target.value }))} /></Field></div><button type="button" onClick={() => void saveCrew()} disabled={busy === "crew"} className="mt-4 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">Zapisz przypisanie</button></section>
              <Timeline title="Historia stanowisk" items={selectedPositions.map((item) => ({ id: item.id, title: item.role_title, subtitle: `${departmentLabel(item.department)} · ${employmentLabel(item.employment_type)}${item.manager_employee_id ? ` · przełożony: ${employeeById.get(item.manager_employee_id)?.full_name || "—"}` : ""}`, from: item.valid_from, to: item.valid_until, notes: item.notes }))} />
              <Timeline title="Historia brygad" items={selectedCrews.map((item) => ({ id: item.id, title: crewById.get(item.crew_id || "") || "Bez brygady", subtitle: "Przypisanie organizacyjne", from: item.valid_from, to: item.valid_until, notes: item.notes }))} />
            </section>}
          </> : <section className="rounded-lg bg-white p-8 text-center text-sm text-steel shadow-panel">Dodaj pracownika w strukturze firmy.</section>}
        </main>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="rounded-lg bg-white p-4 shadow-panel"><p className="text-xs text-steel">{label}</p><p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid min-w-0 gap-1 text-xs font-semibold text-ink">{label}{children}</label>; }

function Overview({ employee, documents, positions, crews, crewById, employeeById, today, onDocuments }: { employee: EmployeeProfile; documents: EmployeeDocument[]; positions: EmployeePositionHistory[]; crews: EmployeeCrewHistory[]; crewById: Map<string,string>; employeeById: Map<string,EmployeeProfile>; today: string; onDocuments: () => void }) {
  const required = (["bhp", "medical"] as EmployeeDocumentType[]).map((type) => documents.find((document) => document.document_type === type && document.status === "active"));
  const upcoming = [...documents].filter((document) => document.requires_renewal).sort((a,b) => String(a.valid_until || "").localeCompare(String(b.valid_until || ""))).slice(0,5);
  const currentPosition = positions.find((item) => !item.valid_until) || positions[0];
  const currentCrew = crews.find((item) => !item.valid_until) || crews[0];
  return <section className="grid min-w-0 gap-4"><section className="grid gap-3 md:grid-cols-2"><ComplianceCard label="BHP" document={required[0]} today={today} onClick={onDocuments} /><ComplianceCard label="Badania lekarskie" document={required[1]} today={today} onClick={onDocuments} /></section><section className="rounded-lg bg-white p-4 shadow-panel sm:p-5"><h3 className="text-lg font-bold text-ink">Aktualne przypisanie</h3><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Info label="Stanowisko" value={currentPosition?.role_title || employee.role_title} /><Info label="Dział" value={departmentLabel(currentPosition?.department || employee.department)} /><Info label="Przełożony" value={employeeById.get(currentPosition?.manager_employee_id || employee.manager_employee_id || "")?.full_name || "brak"} /><Info label="Brygada" value={crewById.get(currentCrew?.crew_id || employee.crew_id || "") || "bez brygady"} /></div></section><section className="rounded-lg bg-white p-4 shadow-panel sm:p-5"><div className="flex items-center justify-between gap-2"><div><h3 className="text-lg font-bold text-ink">Najbliższe terminy</h3><p className="mt-1 text-xs text-steel">Dokumenty wymagające odnowienia.</p></div><button type="button" onClick={onDocuments} className="text-sm font-semibold text-moss hover:underline">Wszystkie</button></div><div className="mt-4 grid gap-2">{upcoming.map((document) => <div key={document.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-stone-200 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{document.title}</p><p className="text-xs text-steel">{EMPLOYEE_DOCUMENT_TYPE_LABELS[document.document_type]} · {document.valid_until ? formatDate(document.valid_until) : "brak terminu"}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${documentExpiryTone(document,today)}`}>{documentExpiryLabel(document,today)}</span></div>)}{upcoming.length === 0 && <p className="rounded-lg border border-dashed border-stone-300 p-5 text-center text-sm text-steel">Brak terminów do pilnowania.</p>}</div></section></section>;
}

function ComplianceCard({ label, document, today, onClick }: { label: string; document: EmployeeDocument | undefined; today: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="rounded-lg bg-white p-4 text-left shadow-panel hover:ring-1 hover:ring-moss/40"><p className="text-xs font-semibold uppercase text-steel">{label}</p><p className="mt-2 text-lg font-bold text-ink">{document?.valid_until ? formatDate(document.valid_until) : "Brak ważnego terminu"}</p><span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${document ? documentExpiryTone(document,today) : "bg-rose-50 text-rose-700"}`}>{document ? documentExpiryLabel(document,today) : "uzupełnij dokument"}</span></button>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-stone-50 p-3"><p className="text-xs text-steel">{label}</p><p className="mt-1 break-words text-sm font-bold text-ink">{value}</p></div>; }

function DocumentList({ title, documents, today, onOpen, onArchive }: { title: string; documents: EmployeeDocument[]; today: string; onOpen: (document: EmployeeDocument) => void; onArchive?: (document: EmployeeDocument) => void }) { return <section className="rounded-lg bg-white p-4 shadow-panel sm:p-5"><h3 className="text-lg font-bold text-ink">{title}</h3><div className="mt-4 grid gap-3">{documents.map((document) => <article key={document.id} className="rounded-lg border border-stone-200 p-3"><div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="break-words font-bold text-ink">{document.title}</p><span className="rounded-full bg-stone-100 px-2 py-0.5 text-[0.68rem] font-semibold text-steel">{EMPLOYEE_DOCUMENT_TYPE_LABELS[document.document_type]}</span></div><p className="mt-1 text-xs text-steel">{document.document_number ? `nr ${document.document_number} · ` : ""}{document.valid_until ? `ważny do ${formatDate(document.valid_until)}` : "bez daty końcowej"}{document.file_name ? ` · ${document.file_name}` : " · bez pliku"}</p>{document.notes && <p className="mt-2 text-sm text-steel">{document.notes}</p>}</div><div className="flex shrink-0 flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${documentExpiryTone(document,today)}`}>{documentExpiryLabel(document,today)}</span>{document.storage_path && <button type="button" onClick={() => onOpen(document)} className="rounded-md border border-stone-300 px-2 py-1 text-xs font-semibold text-ink hover:bg-stone-50">Otwórz</button>}{onArchive && <button type="button" onClick={() => onArchive(document)} className="rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50">Archiwizuj</button>}</div></div></article>)}{documents.length === 0 && <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-steel">Brak dokumentów.</p>}</div></section>; }

function Timeline({ title, items }: { title: string; items: { id:string; title:string; subtitle:string; from:string; to:string|null; notes:string|null }[] }) { return <section className="rounded-lg bg-white p-4 shadow-panel sm:p-5"><h3 className="text-lg font-bold text-ink">{title}</h3><div className="mt-4 grid gap-0">{items.map((item,index) => <div key={item.id} className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-3 pb-5 last:pb-0"><div className="relative flex justify-center"><span className="mt-1 size-2.5 rounded-full bg-moss" />{index < items.length - 1 && <span className="absolute bottom-0 top-4 w-px bg-stone-200" />}</div><div className="min-w-0"><p className="font-bold text-ink">{item.title}</p><p className="mt-0.5 text-xs text-steel">{item.subtitle}</p><p className="mt-1 text-xs font-semibold text-moss">{formatDate(item.from)} – {item.to ? formatDate(item.to) : "obecnie"}</p>{item.notes && <p className="mt-1 text-sm text-steel">{item.notes}</p>}</div></div>)}{items.length === 0 && <p className="text-sm text-steel">Brak historii.</p>}</div></section>; }
