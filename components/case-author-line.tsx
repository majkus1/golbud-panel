import { memberDisplayName, memberRoleLabel, memberShortName } from "@/lib/case-leads";
import { formatDateOfTimestamp } from "@/lib/format";
import type { OrgMemberProfile } from "@/lib/types";

/**
 * Kto założył zlecenie i kiedy.
 *
 * Autor był dotąd widoczny wyłącznie w dzienniku zmian, gdzie trzeba go szukać wśród
 * pozostałych zdarzeń. Przy sprawie zapisane jest pole z autorem, więc wystarczy je pokazać
 * — to źródło jest pewniejsze niż wpis w dzienniku i istnieje dla wszystkich dotychczasowych
 * zleceń.
 *
 * Autor to nie to samo co osoba prowadząca: zlecenie zakłada często biuro albo handlowiec,
 * a prowadzi je kto inny. Dlatego jest to osobna linia, a nie kolejna plakietka przy „Prowadzi”.
 */
export function CaseAuthorLine({
  createdBy,
  createdAt,
  members,
  className = ""
}: {
  createdBy: string | null;
  createdAt: string | null;
  members: OrgMemberProfile[];
  className?: string;
}) {
  // Sprawy sprzed wprowadzenia autora albo wgrane poza panelem — lepiej nie pokazywać nic
  // niż „Nieznana osoba”, co wyglądałoby na błąd.
  if (!createdBy) return null;

  const author = members.find((member) => member.user_id === createdBy);
  const date = formatDateOfTimestamp(createdAt);

  return (
    <p
      title={`${memberDisplayName(author, createdBy)} · ${memberRoleLabel(author)}`}
      className={`mt-1.5 text-xs text-steel ${className}`.trim()}
    >
      Dodał: <span className="font-semibold text-ink">{memberShortName(author, createdBy)}</span>
      {date ? ` · ${date}` : ""}
    </p>
  );
}
