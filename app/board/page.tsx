"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { CaseLeadBadge } from "@/components/case-lead-badge";
import { showToast } from "@/components/toast";
import { AuthGate } from "@/components/auth-gate";
import { useOrg } from "@/components/org-context";
import { ACTIVE_BOARD_STATUSES, CASE_SOURCES, CASE_STATUSES } from "@/lib/domain";
import { formatDate, formatMoney, isDue } from "@/lib/format";
import {
  buildAssigneesMaps,
  leadFilterLabel,
  leadFilterMembers,
  LEAD_FILTER_UNASSIGNED,
  loadOrganizationMemberDirectory,
  matchesLeadFilter,
  type CaseAssigneesMap
} from "@/lib/case-leads";
import { supabase } from "@/lib/supabase";
import type { CaseAssignee, CaseRow, CaseStatus, Crew, OrgMemberProfile } from "@/lib/types";

const CASE_DRAG_TYPE = "application/x-golbud-case-id";

function useBoardDragEnabled() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
    const update = () => setEnabled(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return enabled;
}

function DragHandle({ caseId, onDragStart, onDragEnd }: { caseId: string; onDragStart: (id: string) => void; onDragEnd: () => void }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CASE_DRAG_TYPE, caseId);
        e.dataTransfer.setData("text/plain", caseId);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(caseId);
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => e.stopPropagation()}
      className="relative z-20 hidden shrink-0 cursor-grab rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-steel active:cursor-grabbing lg:inline-flex"
      aria-label="Przenieś do innej kolumny"
      title="Przeciągnij do innej kolumny"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <circle cx="5.5" cy="4" r="1.25" />
        <circle cx="10.5" cy="4" r="1.25" />
        <circle cx="5.5" cy="8" r="1.25" />
        <circle cx="10.5" cy="8" r="1.25" />
        <circle cx="5.5" cy="12" r="1.25" />
        <circle cx="10.5" cy="12" r="1.25" />
      </svg>
    </button>
  );
}

function BoardCard({
  caseRow,
  leadIds,
  members,
  crewLabel,
  dragEnabled,
  isDragging,
  onDragStart,
  onDragEnd,
  onStatusChange
}: {
  caseRow: CaseRow;
  leadIds: string[];
  members: OrgMemberProfile[];
  crewLabel: string;
  dragEnabled: boolean;
  isDragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onStatusChange: (caseId: string, status: CaseStatus) => void;
}) {
  const overdue = isDue(caseRow.next_contact_date) && !["rozliczone", "utracone"].includes(caseRow.status);

  return (
    <article
      className={`group relative rounded-xl2 p-3 shadow-card ring-1 transition hover:shadow-md ${
        isDragging ? "scale-[0.98] opacity-45 ring-dashed ring-moss/50" : ""
      } ${overdue ? "bg-amber-50/60 ring-amber-300 hover:ring-amber-400" : "bg-white ring-stone-200 hover:ring-moss/50"}`}
    >
      <div className="flex items-start gap-1.5">
        {dragEnabled ? (
          <DragHandle caseId={caseRow.id} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        ) : null}
        <Link
          href={`/cases/${caseRow.id}`}
          className="min-w-0 flex-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold text-ink group-hover:text-moss">{caseRow.client_name}</span>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-steel">{caseRow.source}</span>
          </div>
          <p className="mt-1 text-xs text-steel">{caseRow.location || "Bez lokalizacji"}</p>
          <p className="mt-1 text-xs text-steel">Ekipa: {crewLabel}</p>
          <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
            <span className={overdue ? "font-semibold text-amber-700" : "text-steel"}>
              Kontakt: {formatDate(caseRow.next_contact_date)}
            </span>
            <span className="text-right text-ink">{formatMoney(caseRow.estimated_value)}</span>
          </div>
          <div className="mt-2">
            <CaseLeadBadge userIds={leadIds} members={members} className="w-full" />
          </div>
          <p className="mt-2 text-[11px] font-semibold text-moss opacity-0 transition group-hover:opacity-100 lg:opacity-100">
            Otwórz sprawę →
          </p>
        </Link>
      </div>
      <select
        value={caseRow.status}
        onChange={(e) => onStatusChange(caseRow.id, e.target.value as CaseStatus)}
        className="relative z-10 mt-2.5 w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs font-medium focus:ring-2 focus:ring-moss lg:hidden"
        aria-label="Zmień status"
      >
        {CASE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </article>
  );
}

export default function BoardPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <Board />
        </AppShell>
      )}
    </AuthGate>
  );
}

function Board() {
  const { organizationId, userId } = useOrg();
  const dragEnabled = useBoardDragEnabled();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [assigneesMap, setAssigneesMap] = useState<CaseAssigneesMap>({});
  const [leadsMap, setLeadsMap] = useState<CaseAssigneesMap>({});
  const [members, setMembers] = useState<OrgMemberProfile[]>([]);
  const [filterCrew, setFilterCrew] = useState<string>("");
  const [filterSource, setFilterSource] = useState<string>("");
  const [filterLead, setFilterLead] = useState<string>("");
  const [filterMine, setFilterMine] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draggingCaseId, setDraggingCaseId] = useState<string | null>(null);
  const [dropTargetStatus, setDropTargetStatus] = useState<CaseStatus | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const [{ data: c }, { data: cr }, directory] = await Promise.all([
      supabase
        .from("case_records")
        .select("*")
        .eq("organization_id", organizationId)
        .order("next_contact_date", { ascending: true, nullsFirst: false }),
      supabase.from("crews").select("*").eq("organization_id", organizationId).order("name"),
      loadOrganizationMemberDirectory(supabase, organizationId)
    ]);
    const loadedCases = (c || []) as CaseRow[];
    setCases(loadedCases);
    setCrews((cr || []) as Crew[]);
    setMembers(directory);

    if (loadedCases.length > 0) {
      const { data: ca } = await supabase
        .from("case_assignees")
        .select("case_id, user_id, assignment_role")
        .in("case_id", loadedCases.map((x) => x.id));
      const maps = buildAssigneesMaps((ca || []) as CaseAssignee[]);
      setAssigneesMap(maps.all);
      setLeadsMap(maps.leads);
    } else {
      setAssigneesMap({});
      setLeadsMap({});
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      cases.filter((c) => {
        const crewOk = !filterCrew || c.crew_id === filterCrew;
        const sourceOk = !filterSource || c.source === filterSource;
        const leadOk = matchesLeadFilter(leadsMap[c.id] || [], filterLead);
        if (filterMine && userId) {
          const ids = assigneesMap[c.id] || [];
          if (!ids.includes(userId) && c.created_by !== userId) return false;
        }
        return crewOk && sourceOk && leadOk;
      }),
    [cases, filterCrew, filterSource, filterLead, filterMine, userId, assigneesMap, leadsMap]
  );

  const leadMembers = useMemo(() => leadFilterMembers(members), [members]);

  const columns = useMemo(() => {
    const statuses: CaseStatus[] = showFinished ? Array.from(CASE_STATUSES) : [...ACTIVE_BOARD_STATUSES];
    return statuses.map((status) => ({
      status,
      items: filtered.filter((c) => c.status === status)
    }));
  }, [filtered, showFinished]);

  const updateStatus = async (caseId: string, status: CaseStatus, fromDrag = false) => {
    const prev = cases.find((c) => c.id === caseId);
    if (prev?.status === status) return;

    setCases((list) => list.map((c) => (c.id === caseId ? { ...c, status } : c)));
    const { error } = await supabase.from("cases").update({ status }).eq("id", caseId);
    if (error) {
      showToast("Nie udało się zmienić statusu", "error");
      await load();
      return;
    }
    if (fromDrag && prev) {
      showToast(`Przeniesiono do: ${status}`);
    }
  };

  const readDraggedCaseId = (e: React.DragEvent) => e.dataTransfer.getData(CASE_DRAG_TYPE) || e.dataTransfer.getData("text/plain");

  const handleColumnDragOver = (e: React.DragEvent, status: CaseStatus) => {
    if (!draggingCaseId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetStatus(status);
  };

  const handleColumnDrop = (e: React.DragEvent, status: CaseStatus) => {
    e.preventDefault();
    const caseId = readDraggedCaseId(e);
    setDropTargetStatus(null);
    setDraggingCaseId(null);
    if (caseId) void updateStatus(caseId, status, true);
  };

  const crewName = (id: string | null) => crews.find((c) => c.id === id)?.name ?? "—";

  if (!organizationId) return null;

  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid gap-3 sm:flex sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Tablica</p>
          <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">Zlecenia wg etapu</h1>
          <p className="mt-1 text-sm text-steel">
            Aktywne sprawy w kolumnach — szybka zmiana statusu oraz filtr po ekipie, źródle i osobie prowadzącej.
            {dragEnabled ? " Na komputerze przeciągnij kartę (uchwyt po lewej) do innej kolumny." : null}
          </p>
        </div>
      </div>

      <section className="rounded-lg bg-white p-4 shadow-panel">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]">
          <label className="grid gap-1 text-xs font-semibold text-steel">
            Ekipa
            <select value={filterCrew} onChange={(e) => setFilterCrew(e.target.value)} className="input">
              <option value="">wszystkie ekipy</option>
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-steel">
            Źródło
            <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="input">
              <option value="">wszystkie źródła</option>
              {CASE_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-steel">
            Osoba prowadząca
            <select value={filterLead} onChange={(e) => setFilterLead(e.target.value)} className="input">
              <option value="">wszyscy prowadzący</option>
              <option value={LEAD_FILTER_UNASSIGNED}>bez prowadzącego</option>
              {leadMembers.map((member) => (
                <option key={member.user_id} value={member.user_id}>{leadFilterLabel(member)}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-4 sm:col-span-2 xl:col-span-1 xl:pb-0.5">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input type="checkbox" checked={filterMine} onChange={(e) => setFilterMine(e.target.checked)} className="h-4 w-4 shrink-0" />
              tylko moje
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input type="checkbox" checked={showFinished} onChange={(e) => setShowFinished(e.target.checked)} className="h-4 w-4 shrink-0" />
              pokaż zakończone
            </label>
          </div>
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-steel">Wczytywanie tablicy...</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4">
          <div className="flex min-w-max gap-4">
            {columns.map((col) => {
              const isDropTarget = dropTargetStatus === col.status && draggingCaseId !== null;
              return (
                <div
                  key={col.status}
                  className={`flex w-72 shrink-0 flex-col rounded-lg p-3 transition-colors ${
                    isDropTarget ? "bg-moss/10 ring-2 ring-moss/40" : "bg-stone-100/70"
                  }`}
                  onDragOver={(e) => handleColumnDragOver(e, col.status)}
                  onDragEnter={(e) => handleColumnDragOver(e, col.status)}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setDropTargetStatus((prev) => (prev === col.status ? null : prev));
                  }}
                  onDrop={(e) => handleColumnDrop(e, col.status)}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-ink">{col.status}</h2>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-steel">{col.items.length}</span>
                  </div>
                  <div className="grid min-h-[5rem] gap-2">
                    {col.items.length === 0 ? (
                      <p
                        className={`rounded-md border border-dashed p-3 text-xs transition ${
                          isDropTarget ? "border-moss bg-white text-moss" : "border-stone-300 bg-white text-steel"
                        }`}
                      >
                        {isDropTarget ? "Upuść tutaj" : "Brak spraw na tym etapie."}
                      </p>
                    ) : (
                      col.items.map((c) => (
                        <BoardCard
                          key={c.id}
                          caseRow={c}
                          leadIds={leadsMap[c.id] || []}
                          members={members}
                          crewLabel={crewName(c.crew_id)}
                          dragEnabled={dragEnabled}
                          isDragging={draggingCaseId === c.id}
                          onDragStart={setDraggingCaseId}
                          onDragEnd={() => {
                            setDraggingCaseId(null);
                            setDropTargetStatus(null);
                          }}
                          onStatusChange={(id, status) => void updateStatus(id, status)}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
