"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { CaseLeadBadge } from "@/components/case-lead-badge";
import { CaseAuthorLine } from "@/components/case-author-line";
import { ExpandableText } from "@/components/expandable-text";
import { canCreateCases, useOrg } from "@/components/org-context";
import { buildCsv, downloadCsv } from "@/lib/csv";
import {
  CASE_LIST_PRESET,
  isValidCaseListPreset,
  isCaseRealizationOverdue,
  STATUSES_REALIZACJA,
  STATUSES_W_OFERCIE,
  type CaseListPreset
} from "@/lib/case-list-presets";
import { CASE_STATUSES } from "@/lib/domain";
import { formatDate, formatDateOfTimestamp, formatMoney, isDue } from "@/lib/format";
import {
  buildAssigneesMaps,
  leadFilterLabel,
  leadFilterMembers,
  LEAD_FILTER_UNASSIGNED,
  loadOrganizationMemberDirectory,
  matchesLeadFilter,
  memberDisplayName,
  type CaseAssigneesMap
} from "@/lib/case-leads";
import { shouldActivateRow } from "@/lib/row-activation";
import { supabase } from "@/lib/supabase";
import type { CaseAssignee, CaseRow, CaseStatus, OrgMemberProfile } from "@/lib/types";

const TERMINAL = new Set(["rozliczone", "utracone"]);

function presetLabel(p: CaseListPreset): string {
  switch (p) {
    case CASE_LIST_PRESET.noweZapytania:
      return "Nowe zlecenia";
    case CASE_LIST_PRESET.wOfercie:
      return "W trakcie realizacji (grupa statusów)";
    case CASE_LIST_PRESET.realizacja:
      return "Realizacja (grupa statusów)";
    case CASE_LIST_PRESET.kontaktPoTerminie:
      return "Zaległe kontakty";
    case CASE_LIST_PRESET.zalegleZlecenia:
      return "Zaległe zlecenia (po terminie realizacji)";
    default:
      return p;
  }
}

function caseMatchesUrlFilter(c: CaseRow, preset: string | null, statusParam: string | null): boolean {
  if (isValidCaseListPreset(preset)) {
    if (preset === CASE_LIST_PRESET.noweZapytania) return c.status === "nowe zapytanie";
    if (preset === CASE_LIST_PRESET.wOfercie) return STATUSES_W_OFERCIE.includes(c.status);
    if (preset === CASE_LIST_PRESET.realizacja) return STATUSES_REALIZACJA.includes(c.status);
    if (preset === CASE_LIST_PRESET.kontaktPoTerminie) {
      return Boolean(c.next_contact_date && isDue(c.next_contact_date) && !TERMINAL.has(c.status));
    }
    if (preset === CASE_LIST_PRESET.zalegleZlecenia) {
      return isCaseRealizationOverdue(c);
    }
  }
  if (statusParam && CASE_STATUSES.includes(statusParam as CaseStatus)) {
    return c.status === statusParam;
  }
  return true;
}

function selectValueFromUrl(preset: string | null, statusParam: string | null): string {
  if (isValidCaseListPreset(preset)) return `preset|${preset}`;
  if (statusParam && CASE_STATUSES.includes(statusParam as CaseStatus)) return `status|${statusParam}`;
  return "all";
}

export function CasesListClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organizationId, userId, role } = useOrg();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [assigneesMap, setAssigneesMap] = useState<CaseAssigneesMap>({});
  const [leadsMap, setLeadsMap] = useState<CaseAssigneesMap>({});
  const [members, setMembers] = useState<OrgMemberProfile[]>([]);
  const [filterMine, setFilterMine] = useState(false);

  const preset = searchParams.get("preset");
  const statusParam = searchParams.get("status");
  const leadParam = searchParams.get("lead") ?? "";
  const queryRaw = searchParams.get("q") ?? "";
  const query = queryRaw.trim().toLowerCase();

  const [searchDraft, setSearchDraft] = useState(queryRaw);

  useEffect(() => {
    setSearchDraft(queryRaw);
  }, [queryRaw]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const { data } = await supabase
      .from("case_records")
      .select("*")
      .eq("organization_id", organizationId)
      .order("next_contact_date", { ascending: true, nullsFirst: false });
    const loadedCases = (data || []) as CaseRow[];
    setCases(loadedCases);

    const [caResult, directory] = await Promise.all([
      loadedCases.length > 0
        ? supabase.from("case_assignees").select("case_id, user_id, assignment_role").in("case_id", loadedCases.map((c) => c.id))
        : Promise.resolve({ data: [] }),
      loadOrganizationMemberDirectory(supabase, organizationId)
    ]);
    const maps = buildAssigneesMaps((caResult.data || []) as CaseAssignee[]);
    setAssigneesMap(maps.all);
    setLeadsMap(maps.leads);
    setMembers(directory);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      cases.filter((c) => {
        const haystack = `${c.client_name} ${c.phone || ""} ${c.email || ""} ${c.location || ""} ${c.work_description}`.toLowerCase();
        if (query && !haystack.includes(query)) return false;
        if (filterMine && userId) {
          const ids = assigneesMap[c.id] || [];
          if (!ids.includes(userId) && c.created_by !== userId) return false;
        }
        if (!matchesLeadFilter(leadsMap[c.id] || [], leadParam)) return false;
        return caseMatchesUrlFilter(c, preset, statusParam);
      }),
    [cases, preset, statusParam, query, filterMine, userId, assigneesMap, leadsMap, leadParam]
  );

  const leadMembers = useMemo(() => leadFilterMembers(members), [members]);

  const selectValue = selectValueFromUrl(preset, statusParam);
  const hasUrlFilter = selectValue !== "all" || query.length > 0 || leadParam.length > 0;

  const pushCasesUrl = (mutate: (p: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.push(qs ? `/cases?${qs}` : "/cases");
  };

  const onFilterChange = (value: string) => {
    pushCasesUrl((params) => {
      params.delete("preset");
      params.delete("status");
      if (value === "all") return;
      if (value.startsWith("preset|")) {
        params.set("preset", value.slice(7));
        return;
      }
      if (value.startsWith("status|")) {
        params.set("status", value.slice(7));
      }
    });
  };

  const clearFilters = () => router.push("/cases");

  // Wiersz listy jest klikalny w całości, więc zaznaczenie w nim tekstu (np. miejscowości
  // do skopiowania) kończyło się otwarciem sprawy. Zapamiętujemy miejsce wciśnięcia myszy
  // i przy puszczeniu odróżniamy kliknięcie od zaznaczania.
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);

  const rememberPress = useCallback((event: React.MouseEvent) => {
    pressOrigin.current = { x: event.clientX, y: event.clientY };
  }, []);

  const isPlainClick = useCallback((event: React.MouseEvent) => {
    const origin = pressOrigin.current;
    pressOrigin.current = null;
    return shouldActivateRow({
      dx: origin ? event.clientX - origin.x : 0,
      dy: origin ? event.clientY - origin.y : 0,
      selectedText: window.getSelection()?.toString() ?? ""
    });
  }, []);

  const applySearch = () => {
    const v = searchDraft.trim();
    pushCasesUrl((params) => {
      if (v) params.set("q", v);
      else params.delete("q");
    });
  };

  if (!organizationId) return null;

  return (
    <div className="grid min-w-0 gap-6">
      <div className="grid min-w-0 gap-3 sm:flex sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Lista zleceń</p>
          <h1 className="mt-2 max-w-full text-2xl font-bold leading-tight text-ink sm:text-3xl">Zlecenia i budowy</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreateCases(role) && (
            <>
              <button
                type="button"
                onClick={() => {
                  const headers = ["klient", "telefon", "email", "lokalizacja", "opis", "status", "źródło", "prowadzący", "dodał", "data dodania", "kwota", "kontakt", "koniec"];
                  const rows = filtered.map((c) => [
                    c.client_name,
                    c.phone || "",
                    c.email || "",
                    c.location || "",
                    c.work_description,
                    c.status,
                    c.source,
                    (leadsMap[c.id] || [])
                      .map((id) => memberDisplayName(members.find((member) => member.user_id === id), id))
                      .join(", "),
                    // Pełny adres, nie skrócony — w arkuszu liczy się jednoznaczność, nie szerokość kolumny.
                    c.created_by ? memberDisplayName(members.find((member) => member.user_id === c.created_by), c.created_by) : "",
                    formatDateOfTimestamp(c.created_at),
                    c.estimated_value ?? "",
                    formatDate(c.next_contact_date),
                    formatDate(c.realization_end_date)
                  ]);
                  downloadCsv("golbud-sprawy.csv", buildCsv(headers, rows));
                }}
                className="rounded-md border border-stone-300 bg-white px-4 py-3 text-center text-sm font-semibold text-ink hover:bg-stone-50"
              >
                Eksport CSV
              </button>
              <Link href="/cases/new" className="rounded-md bg-ink px-4 py-3 text-center text-sm font-semibold text-white hover:bg-moss">
                Nowe zlecenie
              </Link>
            </>
          )}
        </div>
      </div>

      {hasUrlFilter && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-moss/30 bg-moss/10 px-4 py-3 text-sm">
          <p className="text-ink">
            <span className="font-semibold">Aktywny filtr:</span>{" "}
            {isValidCaseListPreset(preset) && <span>{presetLabel(preset)}</span>}
            {statusParam && CASE_STATUSES.includes(statusParam as CaseStatus) && !isValidCaseListPreset(preset) && (
              <span>Status: {statusParam}</span>
            )}
            {query.length > 0 && (
              <span className="text-steel">
                {" "}
                · szukaj: „{queryRaw}”
              </span>
            )}
            {leadParam && (
              <span className="text-steel">
                {" "}· prowadzący: {leadParam === LEAD_FILTER_UNASSIGNED ? "nieprzypisane" : memberDisplayName(members.find((member) => member.user_id === leadParam), leadParam)}
              </span>
            )}
          </p>
          <button type="button" onClick={clearFilters} className="font-semibold text-moss hover:underline">
            Wyczyść filtry
          </button>
        </div>
      )}

      <section className="min-w-0 rounded-lg bg-white p-5 shadow-panel">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(220px,0.85fr)_auto]">
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applySearch();
            }}
            placeholder="Szukaj po kliencie, telefonie, lokalizacji lub opisie"
            className="input"
          />
          <select value={selectValue} onChange={(e) => onFilterChange(e.target.value)} className="input">
            <option value="all">Wszystkie zlecenia</option>
            <optgroup label="Skróty z pulpitu">
              <option value={`preset|${CASE_LIST_PRESET.noweZapytania}`}>Nowe zlecenia</option>
              <option value={`preset|${CASE_LIST_PRESET.wOfercie}`}>W trakcie realizacji</option>
              <option value={`preset|${CASE_LIST_PRESET.realizacja}`}>Realizacja</option>
              <option value={`preset|${CASE_LIST_PRESET.kontaktPoTerminie}`}>Zaległe kontakty</option>
              <option value={`preset|${CASE_LIST_PRESET.zalegleZlecenia}`}>Zaległe zlecenia</option>
            </optgroup>
            <optgroup label="Status (pojedynczy)">
              {CASE_STATUSES.map((s) => (
                <option key={s} value={`status|${s}`}>
                  {s}
                </option>
              ))}
            </optgroup>
          </select>
          <select
            value={leadParam}
            onChange={(e) => pushCasesUrl((params) => {
              if (e.target.value) params.set("lead", e.target.value);
              else params.delete("lead");
            })}
            className="input"
            aria-label="Osoba prowadząca"
          >
            <option value="">Osoba prowadząca: wszyscy</option>
            <option value={LEAD_FILTER_UNASSIGNED}>Bez prowadzącego</option>
            {leadMembers.map((member) => (
              <option key={member.user_id} value={member.user_id}>{leadFilterLabel(member)}</option>
            ))}
          </select>
          <button type="button" onClick={() => applySearch()} className="rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-ink hover:bg-stone-50">
            Szukaj
          </button>
        </div>
        <div className="mt-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
            <input type="checkbox" className="h-4 w-4" checked={filterMine} onChange={(e) => setFilterMine(e.target.checked)} />
            Tylko moje sprawy
          </label>
        </div>

        {/* Mobile: karty zamiast szerokiej tabeli */}
        <div className="mt-5 grid gap-3 sm:hidden">
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-steel">Brak spraw pasujących do filtrów.</p>
          )}
          {filtered.map((c) => {
            const assigneeIds = assigneesMap[c.id] || [];
            const leadIds = leadsMap[c.id] || [];
            const overdue = isDue(c.next_contact_date) && !TERMINAL.has(c.status);
            return (
              <Link
                key={c.id}
                href={`/cases/${c.id}`}
                onMouseDown={rememberPress}
                onClick={(event) => {
                  if (!isPlainClick(event)) event.preventDefault();
                }}
                className={`block rounded-xl2 border p-4 transition active:scale-[0.99] ${
                  overdue ? "border-amber-300 bg-amber-50/60" : "border-stone-200 bg-white hover:border-moss/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-ink">{c.client_name}</p>
                  <StatusBadge status={c.status} />
                </div>
                {overdue && (
                  <span className="mt-1.5 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-red-700">
                    Zaległy kontakt
                  </span>
                )}
                {c.location ? <p className="mt-1 text-sm text-steel">{c.location}</p> : null}
                <div className="mt-2">
                  <CaseLeadBadge userIds={leadIds} members={members} className="w-full sm:w-auto" />
                </div>
                <div className="mt-2">
                  <ExpandableText text={c.work_description} lines={2} className="text-steel" emptyLabel="" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-steel">
                  <span>Kontakt: <span className="font-semibold text-ink">{formatDate(c.next_contact_date)}</span></span>
                  <span>Kwota: <span className="font-semibold text-ink">{formatMoney(c.estimated_value)}</span></span>
                  {assigneeIds.length > 0 && <span>Osoby: {assigneeIds.length}</span>}
                </div>
                <CaseAuthorLine createdBy={c.created_by} createdAt={c.created_at} members={members} className="mt-2" />
                {c.phone ? (
                  <a
                    href={`tel:${c.phone.replace(/\s/g, "")}`}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-3 inline-block text-sm font-semibold text-moss"
                  >
                    {c.phone}
                  </a>
                ) : null}
              </Link>
            );
          })}
        </div>

        {/* Desktop / tablet: tabela */}
        <div className="mt-5 hidden max-w-full overflow-x-auto sm:block">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-xs uppercase text-steel">
              <tr>
                <th className="py-3 pr-4">Klient</th>
                <th className="py-3 pr-4">Kontakt</th>
                <th className="py-3 pr-4">Lokalizacja</th>
                <th className="py-3 pr-4">Opis</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Nast. kontakt</th>
                <th className="py-3 pr-4">Kwota</th>
                <th className="sticky right-0 bg-white py-3 pl-3 pr-4 shadow-[-10px_0_10px_-10px_rgba(23,32,27,0.25)]">Prowadzi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map((c) => {
                const leadIds = leadsMap[c.id] || [];
                const overdue = isDue(c.next_contact_date) && !TERMINAL.has(c.status);
                // Kolumna „Prowadzi” jest przyklejona do prawej krawędzi, więc musi mieć własne,
                // nieprzezroczyste tło w kolorze wiersza — inaczej przy przewijaniu prześwitywałyby
                // przez nią kolumny sunące pod spodem.
                const leadCellTone = overdue ? "bg-amber-50 group-hover:bg-amber-50" : "bg-white group-hover:bg-stone-50";
                return (
                  <tr
                    key={c.id}
                    onMouseDown={rememberPress}
                    onClick={(event) => {
                      if (isPlainClick(event)) router.push(`/cases/${c.id}`);
                    }}
                    className={`group cursor-pointer transition hover:bg-stone-50 ${
                      overdue ? "bg-amber-50/45 hover:bg-amber-50" : ""
                    }`}
                  >
                    <td className="py-4 pr-4">
                      <span className="font-semibold text-ink">{c.client_name}</span>
                    </td>
                    <td className="py-4 pr-4 text-steel">
                      {c.phone ? (
                        <a href={`tel:${c.phone.replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:text-moss">
                          {c.phone}
                        </a>
                      ) : (
                        <p>—</p>
                      )}
                      {c.email ? (
                        <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="mt-1 block text-xs hover:text-moss">
                          {c.email}
                        </a>
                      ) : null}
                    </td>
                    <td className="py-4 pr-4 text-steel">{c.location || "—"}</td>
                    <td className="max-w-xs py-4 pr-4 align-top text-steel">
                      <ExpandableText text={c.work_description} lines={2} className="text-steel" />
                    </td>
                    <td className="py-4 pr-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="py-4 pr-4 text-steel">{formatDate(c.next_contact_date)}</td>
                    <td className="py-4 pr-4 text-steel">{formatMoney(c.estimated_value)}</td>
                    <td
                      className={`sticky right-0 py-4 pl-3 pr-4 shadow-[-10px_0_10px_-10px_rgba(23,32,27,0.25)] ${leadCellTone}`}
                    >
                      <CaseLeadBadge userIds={leadIds} members={members} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="py-8 text-center text-sm text-steel">Brak spraw pasujących do filtrów.</p>}
        </div>
      </section>
    </div>
  );
}
