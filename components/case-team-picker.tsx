"use client";

import { useMemo } from "react";
import { OFFICE_ROLES, FIELD_ROLES, MEMBER_ROLE_LABELS } from "@/lib/domain";
import { memberDisplayName } from "@/lib/case-leads";
import type { MemberRole, OrgMemberProfile } from "@/lib/types";

type Props = {
  members: OrgMemberProfile[];
  responsibleUserIds: string[];
  assignedUserIds: string[];
  onResponsibleChange: (ids: string[]) => void;
  onAssignedChange: (ids: string[]) => void;
};

function sortMembers(members: OrgMemberProfile[], preferred: readonly MemberRole[]): OrgMemberProfile[] {
  const rank = (role: MemberRole) => {
    const i = preferred.indexOf(role);
    return i === -1 ? preferred.length + 1 : i;
  };
  return [...members].sort((a, b) => {
    const d = rank(a.role) - rank(b.role);
    if (d !== 0) return d;
    return memberDisplayName(a, a.user_id).localeCompare(memberDisplayName(b, b.user_id), "pl");
  });
}

function MemberCheckboxList({
  members,
  selected,
  disabledIds,
  onChange
}: {
  members: OrgMemberProfile[];
  selected: string[];
  disabledIds: string[];
  onChange: (ids: string[]) => void;
}) {
  if (members.length === 0) {
    return <p className="text-sm text-steel">Brak członków zespołu w organizacji.</p>;
  }

  return (
    <ul className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-stone-200 bg-white p-2">
      {members.map((m) => {
        const checked = selected.includes(m.user_id);
        const disabled = disabledIds.includes(m.user_id);
        return (
          <li key={m.user_id}>
            <label
              className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm transition hover:bg-stone-50 ${
                disabled ? "cursor-not-allowed opacity-50" : ""
              }`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-moss"
                checked={checked}
                disabled={disabled}
                onChange={(e) => {
                  if (disabled) return;
                  onChange(e.target.checked ? [...selected, m.user_id] : selected.filter((id) => id !== m.user_id));
                }}
              />
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-moss text-[10px] font-bold uppercase text-white">
                {memberDisplayName(m, m.user_id)[0]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{memberDisplayName(m, m.user_id)}</span>
                <span className="text-xs text-steel">{MEMBER_ROLE_LABELS[m.role]}</span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function SelectedChips({
  members,
  selected,
  onRemove
}: {
  members: OrgMemberProfile[];
  selected: string[];
  onRemove: (userId: string) => void;
}) {
  if (selected.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {selected.map((uid) => {
        const m = members.find((x) => x.user_id === uid);
        return (
          <span
            key={uid}
            className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-ink"
          >
            {memberDisplayName(m, uid)}
            <button
              type="button"
              onClick={() => onRemove(uid)}
              className="text-steel hover:text-rose-600"
              aria-label="Usuń"
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function CaseTeamPicker({
  members,
  responsibleUserIds,
  assignedUserIds,
  onResponsibleChange,
  onAssignedChange
}: Props) {
  const officeSorted = useMemo(() => sortMembers(members, OFFICE_ROLES), [members]);
  const fieldSorted = useMemo(() => sortMembers(members, FIELD_ROLES), [members]);

  return (
    <div className="mt-4 grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl2 border border-sky-200/80 bg-sky-50/40 p-4">
        <h3 className="text-sm font-bold text-ink">Odpowiedzialni</h3>
        <p className="mt-1 text-xs leading-relaxed text-steel">
          Prowadzą sprawę po stronie biura (handlowiec, kierownik). Widzą pełną kartę zlecenia i finanse.
        </p>
        <div className="mt-3">
          <SelectedChips
            members={members}
            selected={responsibleUserIds}
            onRemove={(uid) => onResponsibleChange(responsibleUserIds.filter((id) => id !== uid))}
          />
          <MemberCheckboxList
            members={officeSorted}
            selected={responsibleUserIds}
            disabledIds={assignedUserIds}
            onChange={onResponsibleChange}
          />
        </div>
      </div>

      <div className="rounded-xl2 border border-moss/25 bg-moss/5 p-4">
        <h3 className="text-sm font-bold text-ink">Przypisani do realizacji</h3>
        <p className="mt-1 text-xs leading-relaxed text-steel">
          Brygadzista, podwykonawca, pracownik terenowy — widzą budowę i zadania, bez finansów. Po zapisie dostaną
          powiadomienie.
        </p>
        <div className="mt-3">
          <SelectedChips
            members={members}
            selected={assignedUserIds}
            onRemove={(uid) => onAssignedChange(assignedUserIds.filter((id) => id !== uid))}
          />
          <MemberCheckboxList
            members={fieldSorted}
            selected={assignedUserIds}
            disabledIds={responsibleUserIds}
            onChange={onAssignedChange}
          />
        </div>
      </div>
    </div>
  );
}
