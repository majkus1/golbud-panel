import { memberDisplayName, memberRoleLabel, memberShortName } from "@/lib/case-leads";
import type { OrgMemberProfile } from "@/lib/types";

const AVATAR_TONES = [
  "bg-amber-500 text-white",
  "bg-emerald-700 text-white",
  "bg-sky-700 text-white",
  "bg-rose-700 text-white",
  "bg-violet-700 text-white",
  "bg-stone-700 text-white"
];

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) >>> 0;
  return result;
}

function avatarTone(userId: string): string {
  return AVATAR_TONES[hash(userId) % AVATAR_TONES.length];
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

export function CaseLeadBadge({
  userIds,
  members,
  showEmpty = true,
  className = ""
}: {
  userIds: string[];
  members: OrgMemberProfile[];
  showEmpty?: boolean;
  className?: string;
}) {
  if (userIds.length === 0) {
    return showEmpty ? <span className={`text-xs text-stone-400 ${className}`}>Nie przypisano</span> : null;
  }

  const firstId = userIds[0];
  const first = members.find((member) => member.user_id === firstId);
  // Na plakietce krótka nazwa — pełny adres i tak jest w podpowiedzi poniżej.
  const name = memberShortName(first, firstId);
  const roleLabel = memberRoleLabel(first);
  const sales = first?.role === "sales";
  const title = userIds
    .map((userId) => {
      const member = members.find((item) => item.user_id === userId);
      return `${memberDisplayName(member, userId)} · ${memberRoleLabel(member)}`;
    })
    .join("\n");

  return (
    <span
      title={title}
      className={`inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border border-stone-200 bg-white px-2 py-1.5 shadow-sm ${className}`}
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-black ${avatarTone(firstId)}`}>
        {initials(name)}
      </span>
      <span className="min-w-0">
        <span className="block max-w-[180px] truncate text-xs font-semibold text-ink">{name}</span>
        {sales ? (
          <span className="inline-flex rounded bg-amber-50 px-1 py-0.5 text-[9px] font-black uppercase text-amber-800 ring-1 ring-amber-200">
            Handlowiec
          </span>
        ) : (
          <span className="block text-[10px] font-bold text-steel">{roleLabel}</span>
        )}
      </span>
      {userIds.length > 1 ? (
        <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-steel">+{userIds.length - 1}</span>
      ) : null}
    </span>
  );
}
