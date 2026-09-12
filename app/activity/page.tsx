"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { canViewPayroll, useOrg } from "@/components/org-context";
import {
  ACTIVITY_CATEGORY_TONE,
  ACTIVITY_FILTER_OPTIONS,
  activityCategoryLabel,
  canViewActivityLog,
  type ActivityCategory,
  type OrganizationActivityLog
} from "@/lib/activity-log";
import { formatDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { OrgMemberProfile } from "@/lib/types";

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => {
  const label = new Intl.DateTimeFormat("pl-PL", { month: "long" }).format(new Date(2024, i, 1));
  return { value: i + 1, label: label.charAt(0).toUpperCase() + label.slice(1) };
});

function currentPeriod() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function periodBounds(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function periodLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function yearOptions() {
  const current = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => current - i);
}

function authorEmail(members: OrgMemberProfile[], userId: string | null): string {
  if (!userId) return "system";
  return members.find((m) => m.user_id === userId)?.email || "nieznany użytkownik";
}

export default function ActivityPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <ActivityInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function ActivityInner() {
  const searchParams = useSearchParams();
  const caseFilter = searchParams.get("case");
  const { organizationId, role } = useOrg();
  const [entries, setEntries] = useState<OrganizationActivityLog[]>([]);
  const [members, setMembers] = useState<OrgMemberProfile[]>([]);
  const [caseNames, setCaseNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [periodYear, setPeriodYear] = useState(() => currentPeriod().year);
  const [periodMonth, setPeriodMonth] = useState(() => currentPeriod().month);
  const [category, setCategory] = useState<"all" | ActivityCategory>("all");
  const [personId, setPersonId] = useState("");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");

  const periodRange = useMemo(() => periodBounds(periodYear, periodMonth), [periodYear, periodMonth]);
  const selectedPeriodLabel = useMemo(() => periodLabel(periodYear, periodMonth), [periodYear, periodMonth]);
  const isCurrentPeriod = useMemo(() => {
    const now = currentPeriod();
    return periodYear === now.year && periodMonth === now.month;
  }, [periodYear, periodMonth]);

  const load = useCallback(async () => {
    if (!organizationId || !canViewActivityLog(role)) return;
    setLoading(true);
    setLoadError(null);

    let query = supabase
      .from("organization_activity_log")
      .select("*")
      .eq("organization_id", organizationId)
      .gte("created_at", `${periodRange.start}T00:00:00`)
      .lte("created_at", `${periodRange.end}T23:59:59.999`)
      .order("created_at", { ascending: false })
      .limit(500);

    if (caseFilter) {
      query = query.eq("case_id", caseFilter);
    }

    const [logRes, memRes] = await Promise.all([
      query,
      supabase.from("org_member_profiles").select("user_id, email, role").eq("organization_id", organizationId)
    ]);

    if (logRes.error) {
      const missing = logRes.error.code === "42P01" || logRes.error.message.includes("organization_activity_log");
      setLoadError(
        missing ? "Uruchom migrację 0029_organization_activity_log.sql w Supabase (SQL Editor)." : logRes.error.message
      );
      setEntries([]);
    } else {
      const rows = (logRes.data || []) as OrganizationActivityLog[];
      setEntries(rows);
      const caseIds = Array.from(new Set(rows.map((r) => r.case_id).filter(Boolean))) as string[];
      if (caseFilter && !caseIds.includes(caseFilter)) caseIds.push(caseFilter);
      if (caseIds.length > 0) {
        const { data: cases } = await supabase.from("cases").select("id, client_name").in("id", caseIds);
        const map: Record<string, string> = {};
        for (const c of cases || []) {
          map[c.id as string] = c.client_name as string;
        }
        setCaseNames(map);
      } else {
        setCaseNames({});
      }
    }

    setMembers((memRes.data || []) as OrgMemberProfile[]);
    setLoading(false);
  }, [organizationId, role, periodRange, caseFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (category !== "all" && e.category !== category) return false;
      if (personId && e.created_by !== personId) return false;
      if (!q) return true;
      const hay = `${e.summary} ${e.details || ""} ${authorEmail(members, e.created_by)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, category, personId, search, members]);

  if (!organizationId) return null;

  if (!canViewActivityLog(role)) {
    return (
      <div className="rounded-lg bg-white p-6 shadow-panel">
        <h1 className="text-xl font-bold text-ink">Dziennik zmian</h1>
        <p className="mt-2 text-sm text-steel">Ten widok jest dostępny dla właściciela, biura i kierownika.</p>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-5 sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Kontrola</p>
        <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">Dziennik zmian</h1>
        <p className="mt-2 text-sm text-steel">
          Kto, co i kiedy — sprawy, płatności, faktury, magazyn, zespół i reszta. Wszystko w jednym miejscu.
        </p>
        {caseFilter && caseNames[caseFilter] ? (
          <p className="mt-2 text-sm text-steel">
            Filtr: sprawa{" "}
            <Link href={`/cases/${caseFilter}`} className="font-semibold text-moss hover:underline">
              {caseNames[caseFilter]}
            </Link>
            {" · "}
            <Link href="/activity" className="font-semibold text-moss hover:underline">
              Pokaż całą firmę
            </Link>
          </p>
        ) : null}
      </div>

      {loadError ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{loadError}</section>
      ) : null}

      <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-sm font-bold text-ink">Filtry</h2>
        <div className="mt-3 grid min-w-0 gap-3">
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-steel">
              Miesiąc
              <select
                className="input min-w-0 py-2 text-sm font-normal"
                value={periodMonth}
                onChange={(e) => setPeriodMonth(Number(e.target.value))}
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-steel">
              Rok
              <select
                className="input min-w-0 py-2 text-sm font-normal"
                value={periodYear}
                onChange={(e) => setPeriodYear(Number(e.target.value))}
              >
                {yearOptions().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-steel sm:col-span-2">
              Rodzaj zdarzenia
              <select
                className="input min-w-0 py-2 text-sm font-normal"
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
              >
                {ACTIVITY_FILTER_OPTIONS.filter((option) => canViewPayroll(role) || option.value !== "rozliczenia").map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid min-w-0 gap-2 sm:grid-cols-[1fr_auto]">
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-steel">
              Kto (opcjonalnie)
              <select className="input min-w-0 py-2 text-sm font-normal" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">Wszyscy</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.email || m.user_id}
                  </option>
                ))}
              </select>
            </label>
            {!isCurrentPeriod ? (
              <button
                type="button"
                onClick={() => {
                  const now = currentPeriod();
                  setPeriodYear(now.year);
                  setPeriodMonth(now.month);
                }}
                className="self-end rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-stone-50"
              >
                Bieżący miesiąc
              </button>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <input
              className="input min-w-0 flex-1 font-normal"
              placeholder="Szukaj po opisie lub osobie…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setSearch(searchDraft);
              }}
            />
            <button
              type="button"
              onClick={() => setSearch(searchDraft)}
              className="shrink-0 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss"
            >
              Szukaj
            </button>
          </div>
        </div>

        <p className="mt-3 text-xs text-steel">
          Okres: <span className="font-semibold text-ink">{selectedPeriodLabel}</span>
          {!loading && (
            <>
              {" "}
              · <span className="font-semibold text-ink">{filtered.length}</span> wpisów
            </>
          )}
        </p>
      </section>

      <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white shadow-card">
        {loading ? (
          <p className="p-5 text-sm text-steel">Wczytywanie dziennika…</p>
        ) : filtered.length === 0 ? (
          <p className="p-5 text-sm text-steel">Brak wpisów dla wybranych filtrów.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {filtered.map((e) => (
              <li key={e.id} className="grid gap-2 p-4 sm:p-5">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ring-1 ring-inset ${ACTIVITY_CATEGORY_TONE[e.category]}`}
                    >
                      {activityCategoryLabel(e.category)}
                    </span>
                    <p className="min-w-0 text-sm font-semibold leading-snug text-ink">{e.summary}</p>
                  </div>
                  <time className="shrink-0 text-xs font-medium text-steel" dateTime={e.created_at}>
                    {formatDateTime(e.created_at)}
                  </time>
                </div>
                {e.details ? <p className="text-sm leading-relaxed text-steel">{e.details}</p> : null}
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-steel">
                  <span>
                    <span className="font-semibold text-ink">Kto:</span> {authorEmail(members, e.created_by)}
                  </span>
                  {e.case_id && caseNames[e.case_id] ? (
                    <Link href={`/cases/${e.case_id}`} className="font-semibold text-moss hover:underline">
                      Sprawa: {caseNames[e.case_id]}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
