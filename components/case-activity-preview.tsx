"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { canManageOrg, useOrg } from "@/components/org-context";
import { activityCategoryLabel, type OrganizationActivityLog } from "@/lib/activity-log";
import { formatDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { OrgMemberProfile } from "@/lib/types";

function authorEmail(members: OrgMemberProfile[], userId: string | null): string {
  if (!userId) return "system";
  return members.find((m) => m.user_id === userId)?.email || "nieznany użytkownik";
}

export function CaseActivityPreview({
  caseId,
  organizationId,
  limit = 6
}: {
  caseId: string;
  organizationId: string;
  limit?: number;
}) {
  const { role } = useOrg();
  const [entries, setEntries] = useState<OrganizationActivityLog[]>([]);
  const [members, setMembers] = useState<OrgMemberProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canManageOrg(role)) {
      setLoading(false);
      return;
    }
    void (async () => {
      const [logRes, memRes] = await Promise.all([
        supabase
          .from("organization_activity_log")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("case_id", caseId)
          .order("created_at", { ascending: false })
          .limit(limit),
        supabase.from("org_member_profiles").select("user_id, email, role").eq("organization_id", organizationId)
      ]);
      if (!logRes.error) setEntries((logRes.data || []) as OrganizationActivityLog[]);
      setMembers((memRes.data || []) as OrgMemberProfile[]);
      setLoading(false);
    })();
  }, [caseId, organizationId, role, limit]);

  if (!canManageOrg(role)) return null;

  return (
    <section className="min-w-0 rounded-lg border border-stone-200 bg-stone-50/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Ostatnie zmiany w tej sprawie</h3>
        <Link href={`/activity?case=${caseId}`} className="text-xs font-semibold text-moss hover:underline">
          Cały dziennik →
        </Link>
      </div>
      {loading ? (
        <p className="mt-2 text-xs text-steel">Wczytywanie…</p>
      ) : entries.length === 0 ? (
        <p className="mt-2 text-xs text-steel">Brak zarejestrowanych zmian w tym okresie.</p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-200/80">
          {entries.map((e) => (
            <li key={e.id} className="grid gap-1 py-2.5 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{e.summary}</span>
                <time className="shrink-0 text-stone-400">{formatDateTime(e.created_at)}</time>
              </div>
              <p className="text-steel">
                <span className="text-[0.65rem] font-bold uppercase tracking-wide text-stone-400">
                  {activityCategoryLabel(e.category)}
                </span>
                {" · "}
                {authorEmail(members, e.created_by)}
                {e.details ? ` · ${e.details}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
