"use client";

import { DateInput } from "@/components/date-input";
import { CaseTeamPicker } from "@/components/case-team-picker";
import { EstimateImportPanel } from "@/components/case/estimate-import-panel";
import { TemplateApplyPanel } from "@/components/case/template-apply-panel";
import { useEffect, useMemo, useState } from "react";
import { fetchCrewMemberUserIds } from "@/lib/case-assignees";
import { selectedEstimateLines, sumEstimateLines } from "@/lib/estimate-import";
import { AS_BUILT_ESTIMATE_LABEL } from "@/lib/as-built-estimate";
import { loadOrganizationMemberDirectory } from "@/lib/case-leads";
import { formatMoney, parseAmount } from "@/lib/format";
import { showToast } from "@/components/toast";
import type { CaseFormValues, CaseRow, Crew, OrgMemberProfile } from "@/lib/types";
import { CASE_SOURCES, CASE_STATUSES } from "@/lib/types";
import { supabase } from "@/lib/supabase";

const emptyValues: CaseFormValues = {
  client_name: "",
  phone: "",
  email: "",
  location: "",
  work_description: "",
  status: "nowe zapytanie",
  source: "telefon",
  crew_id: "",
  estimated_value: "",
  next_contact_date: "",
  realization_end_date: "",
  contract_number: "",
  contract_date: "",
  responsible_user_ids: [],
  assigned_user_ids: [],
  estimate_draft: null
};

export const valuesFromCase = (
  row?: CaseRow,
  team?: Pick<CaseFormValues, "responsible_user_ids" | "assigned_user_ids">
): CaseFormValues =>
  row
    ? {
        client_name: row.client_name,
        phone: row.phone || "",
        email: row.email || "",
        location: row.location || "",
        work_description: row.work_description,
        status: row.status,
        source: row.source,
        crew_id: row.crew_id || "",
        estimated_value: row.estimated_value?.toString() || "",
        next_contact_date: row.next_contact_date || "",
        realization_end_date: row.realization_end_date || "",
        contract_number: row.contract_number || "",
        contract_date: row.contract_date || "",
        responsible_user_ids: team?.responsible_user_ids || [],
        assigned_user_ids: team?.assigned_user_ids || [],
        estimate_draft: null
      }
    : emptyValues;

export function caseInsertPayload(values: CaseFormValues, organizationId: string, userId: string) {
  return {
    organization_id: organizationId,
    client_name: values.client_name.trim(),
    phone: values.phone.trim() || null,
    email: values.email.trim() || null,
    location: values.location.trim() || null,
    work_description: values.work_description.trim(),
    status: values.status,
    source: values.source,
    crew_id: values.crew_id || null,
    next_contact_date: values.next_contact_date || null,
    realization_end_date: values.realization_end_date || null,
    contract_number: values.contract_number.trim() || null,
    contract_date: values.contract_date || null,
    created_by: userId
  };
}

export function caseUpdatePayload(values: CaseFormValues) {
  return {
    client_name: values.client_name.trim(),
    phone: values.phone.trim() || null,
    email: values.email.trim() || null,
    location: values.location.trim() || null,
    work_description: values.work_description.trim(),
    status: values.status,
    source: values.source,
    crew_id: values.crew_id || null,
    next_contact_date: values.next_contact_date || null,
    realization_end_date: values.realization_end_date || null,
    contract_number: values.contract_number.trim() || null,
    contract_date: values.contract_date || null
  };
}

export function caseCommercialPayload(
  values: CaseFormValues,
  caseId: string,
  organizationId: string,
  userId: string
) {
  return {
    case_id: caseId,
    organization_id: organizationId,
    // `parseAmount` obsługuje polski zapis z przecinkiem — patrz komentarz przy helperze.
    estimated_value: values.estimated_value.trim() ? parseAmount(values.estimated_value) : null,
    updated_by: userId,
    updated_at: new Date().toISOString()
  };
}

type Props = {
  organizationId: string;
  initial?: CaseFormValues;
  submitLabel: string;
  onSubmit: (values: CaseFormValues) => Promise<void>;
  /** Sekcja zespołu: odpowiedzialni + przypisani do realizacji. */
  showTeam?: boolean;
  /** Import kosztorysu przy zakładaniu (tylko nowe zlecenie). */
  showEstimate?: boolean;
  /** Przy wyborze ekipy automatycznie dopisz jej członków do "przypisanych do realizacji" (tylko nowe zlecenie). */
  autoAssignCrewMembers?: boolean;
};

export function CaseForm({
  organizationId,
  initial = emptyValues,
  submitLabel,
  onSubmit,
  showTeam = false,
  showEstimate = false,
  autoAssignCrewMembers = false
}: Props) {
  const [values, setValues] = useState(initial);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [members, setMembers] = useState<OrgMemberProfile[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValues(initial);
  }, [initial]);

  useEffect(() => {
    supabase
      .from("crews")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name")
      .then(({ data }) => setCrews((data || []) as Crew[]));
  }, [organizationId]);

  useEffect(() => {
    if (!showTeam) return;
    void loadOrganizationMemberDirectory(supabase, organizationId).then(setMembers);
  }, [organizationId, showTeam]);

  const update = (field: keyof CaseFormValues, value: string) => {
    setValues((c) => ({ ...c, [field]: value }));
  };

  const handleCrewChange = async (crewId: string) => {
    update("crew_id", crewId);
    if (!autoAssignCrewMembers || !crewId) return;
    const { userIds, withoutAccountCount } = await fetchCrewMemberUserIds(supabase, organizationId, crewId);
    if (userIds.length === 0 && withoutAccountCount === 0) return;
    setValues((v) => ({
      ...v,
      assigned_user_ids: Array.from(new Set([...v.assigned_user_ids, ...userIds.filter((id) => !v.responsible_user_ids.includes(id))]))
    }));
    if (userIds.length > 0) {
      showToast(
        withoutAccountCount > 0
          ? `Dopisano ${userIds.length} os. z ekipy do realizacji (${withoutAccountCount} os. bez konta pominięto)`
          : `Dopisano ${userIds.length} os. z ekipy do "Przypisani do realizacji"`
      );
    } else if (withoutAccountCount > 0) {
      showToast(`Ta ekipa ma ${withoutAccountCount} os., ale żadna nie ma konta systemowego — nie można ich formalnie przypisać`, "error");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    await onSubmit(values);
    setSaving(false);
  };

  const estimateSelected = useMemo(() => selectedEstimateLines(values.estimate_draft), [values.estimate_draft]);
  const estimateSum = useMemo(() => sumEstimateLines(estimateSelected), [estimateSelected]);

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <FormSection step="1" title="Klient i kontakt" desc="Kto zlecił i gdzie jest budowa.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Klient / inwestor" required>
            <input required value={values.client_name} onChange={(e) => update("client_name", e.target.value)} className="input" placeholder="np. Anna i Marek Zielińscy" />
          </Field>
          <Field label="Telefon">
            <input value={values.phone} onChange={(e) => update("phone", e.target.value)} className="input" autoComplete="tel" placeholder="np. 600 100 200" />
          </Field>
          <Field label="Email">
            <input type="email" value={values.email} onChange={(e) => update("email", e.target.value)} className="input" autoComplete="email" placeholder="np. klient@example.com" />
          </Field>
          <Field label="Lokalizacja budowy">
            <input value={values.location} onChange={(e) => update("location", e.target.value)} className="input" placeholder="np. ul. Lipowa 4, Kraków" />
          </Field>
        </div>
      </FormSection>

      <FormSection step="2" title="Status i zespół" desc="Etap sprawy, ekipa oraz kto prowadzi i kto pracuje na budowie.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Status procesu">
            <select value={values.status} onChange={(e) => update("status", e.target.value)} className="input">
              {CASE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Źródło zapytania">
            <select value={values.source} onChange={(e) => update("source", e.target.value)} className="input">
              {CASE_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Ekipa / brygada"
            hint={autoAssignCrewMembers ? "wybór dopisze jej członków do zespołu poniżej" : "grupa robocza, opcjonalnie"}
          >
            <select value={values.crew_id} onChange={(e) => void handleCrewChange(e.target.value)} className="input">
              <option value="">— nie przypisano —</option>
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {showTeam && (
          <CaseTeamPicker
            members={members}
            responsibleUserIds={values.responsible_user_ids}
            assignedUserIds={values.assigned_user_ids}
            onResponsibleChange={(ids) => setValues((v) => ({ ...v, responsible_user_ids: ids }))}
            onAssignedChange={(ids) => setValues((v) => ({ ...v, assigned_user_ids: ids }))}
          />
        )}
      </FormSection>

      <FormSection step="3" title="Wartość i terminy" desc="Szacunki, umowa i daty — można uzupełnić później.">
        <div className="grid min-w-0 gap-4 md:grid-cols-3">
          <Field label="Szacowana wartość netto" hint="w PLN">
            <input
              inputMode="decimal"
              value={values.estimated_value}
              onChange={(e) => update("estimated_value", e.target.value)}
              className="input"
              placeholder="np. 12 500,50"
            />
          </Field>
          <Field label="Termin kolejnego kontaktu">
            <DateInput value={values.next_contact_date} onChange={(e) => update("next_contact_date", e.target.value)} />
          </Field>
          <Field label="Planowany koniec realizacji">
            <DateInput value={values.realization_end_date} onChange={(e) => update("realization_end_date", e.target.value)} />
          </Field>
          <Field label="Numer umowy" hint={`widoczny na ${AS_BUILT_ESTIMATE_LABEL.toLowerCase()}`}>
            <input value={values.contract_number} onChange={(e) => update("contract_number", e.target.value)} className="input" placeholder="np. 01/05" />
          </Field>
          <Field label="Data umowy">
            <DateInput value={values.contract_date} onChange={(e) => update("contract_date", e.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection step="4" title="Zakres prac" desc="Co dokładnie ma być zrobione.">
        <Field label="Opis zakresu prac" required>
          <textarea
            required
            value={values.work_description}
            onChange={(e) => update("work_description", e.target.value)}
            className="input min-h-32 resize-y"
            placeholder="np. Remont łazienki: skucie płytek, hydraulika, gładzie, ułożenie płytek, biały montaż."
          />
        </Field>
      </FormSection>

      {showEstimate && (
        <FormSection
          step="5"
          title="Kosztorys (opcjonalnie)"
          desc="Zastosuj gotowy szablon albo wgraj plik od kosztorysanta — pozycje trafią do wyceny. Po utworzeniu zlecenia edytujesz je w zakładce Wycena / oferta."
        >
          <div className="grid gap-3">
            <TemplateApplyPanel
              mode="draft"
              organizationId={organizationId}
              embedded
              defaultOpen
              draft={values.estimate_draft}
              onDraftChange={(draft) => setValues((v) => ({ ...v, estimate_draft: draft }))}
            />
            <EstimateImportPanel
              mode="draft"
              embedded
              defaultOpen
              draft={values.estimate_draft}
              onDraftChange={(draft) => setValues((v) => ({ ...v, estimate_draft: draft }))}
            />
          </div>
          {estimateSelected.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-moss/20 bg-moss/5 px-3 py-2.5 text-sm">
              <span className="text-steel">
                Suma netto zaznaczonych pozycji:{" "}
                <span className="font-bold text-ink">{formatMoney(estimateSum)}</span>
                <span className="ml-2 text-xs">({estimateSelected.length} poz.)</span>
              </span>
              {!values.estimated_value && (
                <button
                  type="button"
                  onClick={() =>
                    setValues((v) => ({
                      ...v,
                      estimated_value: String(Math.round(estimateSum))
                    }))
                  }
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-moss ring-1 ring-moss/30 hover:bg-moss/10"
                >
                  Wstaw do szacunkowej wartości
                </button>
              )}
            </div>
          )}
        </FormSection>
      )}

      <button disabled={saving} className="w-full rounded-lg bg-ink px-4 py-3 text-sm font-semibold text-white hover:bg-moss disabled:opacity-60 md:w-fit">
        {saving ? "Zapisywanie..." : submitLabel}
      </button>
    </form>
  );
}

function FormSection({ step, title, desc, children }: { step: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-moss/10 text-sm font-bold text-moss-dark">{step}</span>
        <div>
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <p className="text-xs text-steel">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-ink">
      <span className="flex flex-wrap items-center gap-1.5">
        {label}
        {required && <span className="text-rose-500" aria-hidden>*</span>}
        {hint && <span className="font-normal text-steel">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}
