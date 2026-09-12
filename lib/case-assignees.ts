import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/notify-client";
import type { CaseAssigneeRole, CaseAssigneeRow, CaseFormValues } from "@/lib/types";

export type CaseTeamSelection = {
  responsibleUserIds: string[];
  assignedUserIds: string[];
};

export function splitCaseAssignees(rows: CaseAssigneeRow[]): CaseTeamSelection {
  const responsibleUserIds: string[] = [];
  const assignedUserIds: string[] = [];
  for (const row of rows) {
    if (row.assignment_role === "lead") responsibleUserIds.push(row.user_id);
    else assignedUserIds.push(row.user_id);
  }
  return { responsibleUserIds, assignedUserIds };
}

export function teamSelectionToForm(team: CaseTeamSelection): Pick<CaseFormValues, "responsible_user_ids" | "assigned_user_ids"> {
  return {
    responsible_user_ids: team.responsibleUserIds,
    assigned_user_ids: team.assignedUserIds
  };
}

function unique(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

/** Synchronizuje przypisania sprawy; zwraca user_id nowo dodanych osób (do powiadomień). */
export async function syncCaseAssignees(
  supabase: SupabaseClient,
  caseId: string,
  selection: CaseTeamSelection
): Promise<{ ok: true; addedUserIds: string[] } | { ok: false; error: string }> {
  const responsible = unique(selection.responsibleUserIds);
  const assigned = unique(selection.assignedUserIds.filter((id) => !responsible.includes(id)));

  const { data: current, error: loadErr } = await supabase
    .from("case_assignees")
    .select("user_id, assignment_role")
    .eq("case_id", caseId);

  if (loadErr) return { ok: false, error: loadErr.message };

  const existing = (current || []) as CaseAssigneeRow[];
  const desired = new Map<string, CaseAssigneeRole>();
  for (const uid of responsible) desired.set(uid, "lead");
  for (const uid of assigned) desired.set(uid, "field");

  const addedUserIds: string[] = [];

  for (const [userId, role] of Array.from(desired.entries())) {
    const prev = existing.find((r) => r.user_id === userId);
    if (!prev) {
      const { error } = await supabase.from("case_assignees").insert({
        case_id: caseId,
        user_id: userId,
        assignment_role: role
      });
      if (error) return { ok: false, error: error.message };
      addedUserIds.push(userId);
      continue;
    }
    if (prev.assignment_role !== role) {
      const { error } = await supabase
        .from("case_assignees")
        .update({ assignment_role: role })
        .eq("case_id", caseId)
        .eq("user_id", userId);
      if (error) return { ok: false, error: error.message };
    }
  }

  for (const row of existing) {
    if (!desired.has(row.user_id)) {
      const { error } = await supabase
        .from("case_assignees")
        .delete()
        .eq("case_id", caseId)
        .eq("user_id", row.user_id);
      if (error) return { ok: false, error: error.message };
    }
  }

  return { ok: true, addedUserIds };
}

export async function notifyCaseAssignees(caseId: string, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    void notify({ type: "case_assigned", caseId, userId });
  }
}

export type CrewMembersLookup = {
  /** user_id pracowników tej ekipy, którzy mają konto systemowe (mogą zostać formalnie przypisani). */
  userIds: string[];
  /** Liczba osób z ekipy bez konta systemowego — nie da się ich formalnie przypisać do sprawy. */
  withoutAccountCount: number;
};

/** Pobiera aktywnych członków ekipy z kontem systemowym — do auto-przypisania zespołu na zleceniu. */
export async function fetchCrewMemberUserIds(
  supabase: SupabaseClient,
  organizationId: string,
  crewId: string
): Promise<CrewMembersLookup> {
  const { data } = await supabase
    .from("employee_profiles")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("crew_id", crewId)
    .eq("active", true);
  const rows = (data || []) as { user_id: string | null }[];
  const userIds = unique(rows.map((r) => r.user_id).filter((id): id is string => Boolean(id)));
  const withoutAccountCount = rows.filter((r) => !r.user_id).length;
  return { userIds, withoutAccountCount };
}

export async function loadCaseTeam(
  supabase: SupabaseClient,
  caseId: string
): Promise<CaseTeamSelection | null> {
  const { data, error } = await supabase
    .from("case_assignees")
    .select("user_id, assignment_role")
    .eq("case_id", caseId);
  if (error) return null;
  return splitCaseAssignees((data || []) as CaseAssigneeRow[]);
}
