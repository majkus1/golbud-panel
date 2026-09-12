import type { SupabaseClient } from "@supabase/supabase-js";
import { MEMBER_ROLE_LABELS } from "@/lib/domain";
import type { CaseAssignee, MemberRole, OrgMemberProfile } from "@/lib/types";

export const LEAD_FILTER_UNASSIGNED = "unassigned";

export type CaseAssigneesMap = Record<string, string[]>;

const LEAD_ROLES: MemberRole[] = ["sales", "owner", "office", "manager"];

export function memberDisplayName(member: OrgMemberProfile | undefined, userId = ""): string {
  return member?.display_name?.trim() || member?.email?.trim() || userId.slice(0, 8) || "Nieznana osoba";
}

/**
 * Nazwa do wąskich miejsc — kafelków i kolumn tabeli.
 *
 * Kto nie ma uzupełnionego imienia i nazwiska, ten pokazuje się w panelu pełnym adresem
 * e-mail. „kontakt.golbud@gmail.com” jest prawie dwa razy dłuższe niż „Kacper Szmurło”
 * i samo rozpycha tabelę zleceń poza szerokość ekranu. Domena i tak nic nie wnosi —
 * wszyscy są z tej samej firmy — więc zostawiamy część przed „@”. Pełny adres pozostaje
 * w podpowiedzi po najechaniu, żeby nic nie zniknęło.
 */
export function memberShortName(member: OrgMemberProfile | undefined, userId = ""): string {
  const name = memberDisplayName(member, userId);
  // Skracamy po wartości, a nie po jej pochodzeniu: baza sama podstawia adres e-mail
  // do `display_name`, gdy pracownik nie ma wpisanego imienia i nazwiska. Sprawdzanie,
  // z którego pola przyszła nazwa, niczego by więc nie rozstrzygnęło.
  const at = name.indexOf("@");
  return at > 0 ? name.slice(0, at) : name;
}

export function memberRoleLabel(member: OrgMemberProfile | undefined): string {
  return member ? MEMBER_ROLE_LABELS[member.role] : "Prowadzący";
}

export function leadFilterMembers(members: OrgMemberProfile[]): OrgMemberProfile[] {
  const rank = (role: MemberRole) => {
    const index = LEAD_ROLES.indexOf(role);
    return index === -1 ? LEAD_ROLES.length : index;
  };
  return members
    .filter((member) => LEAD_ROLES.includes(member.role))
    .sort((a, b) => {
      const roleDiff = rank(a.role) - rank(b.role);
      if (roleDiff !== 0) return roleDiff;
      return memberDisplayName(a, a.user_id).localeCompare(memberDisplayName(b, b.user_id), "pl");
    });
}

export function buildAssigneesMaps(rows: CaseAssignee[]): {
  all: CaseAssigneesMap;
  leads: CaseAssigneesMap;
} {
  const all: CaseAssigneesMap = {};
  const leads: CaseAssigneesMap = {};
  for (const row of rows) {
    (all[row.case_id] ??= []).push(row.user_id);
    if (row.assignment_role === "lead") (leads[row.case_id] ??= []).push(row.user_id);
  }
  return { all, leads };
}

export function matchesLeadFilter(leadIds: string[], filter: string): boolean {
  if (!filter) return true;
  if (filter === LEAD_FILTER_UNASSIGNED) return leadIds.length === 0;
  return leadIds.includes(filter);
}

export function leadFilterLabel(member: OrgMemberProfile): string {
  return `${memberDisplayName(member, member.user_id)} · ${memberRoleLabel(member)}`;
}

export async function loadOrganizationMemberDirectory(
  supabase: SupabaseClient,
  organizationId: string
): Promise<OrgMemberProfile[]> {
  const { data, error } = await supabase.rpc("organization_member_directory", { target_org: organizationId });
  if (!error) return (data || []) as OrgMemberProfile[];

  const fallback = await supabase
    .from("org_member_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .order("email");
  return (fallback.data || []) as OrgMemberProfile[];
}

