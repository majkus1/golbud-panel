"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { isFieldRole, useOrg } from "@/components/org-context";
import { StatusBadge } from "@/components/status-badge";
import { CASE_LIST_PRESET, isCaseRealizationOverdue } from "@/lib/case-list-presets";
import { formatDate, formatMoney, isDue } from "@/lib/format";

import { warsawTodayIso } from "@/lib/warsaw-today";
import { supabase } from "@/lib/supabase";
import type { CaseRow, CaseTask } from "@/lib/types";

const terminal = new Set(["rozliczone", "utracone"]);

function dashboardTaskHref(task: CaseTask): string {
  if (task.case_id) return `/cases/${task.case_id}?tab=tasks`;
  return "/tasks";
}

function ContactReminderCard({ caseRow }: { caseRow: CaseRow }) {
  const hasPhone = !!caseRow.phone?.trim();
  const hasEmail = !!caseRow.email?.trim();

  return (
    <div className="overflow-hidden rounded-xl2 border border-stone-200 transition hover:border-moss/50 hover:shadow-sm">
      <Link
        href={`/cases/${caseRow.id}`}
        className="block p-3.5 pb-2.5 transition hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 font-semibold text-ink">{caseRow.client_name}</p>
          <StatusBadge status={caseRow.status} />
        </div>
        <p className="mt-1.5 text-sm text-steel">Kontakt: {formatDate(caseRow.next_contact_date)}</p>
      </Link>
      {(hasPhone || hasEmail) && (
        <div className="flex flex-wrap gap-2 border-t border-stone-100 bg-stone-50/40 px-3.5 py-2.5">
          {hasPhone && (
            <a
              href={`tel:${caseRow.phone!.replace(/\s/g, "")}`}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-moss/40 hover:bg-moss/5"
            >
              <span className="shrink-0 font-semibold text-steel">Tel.</span>
              <span className="truncate">{caseRow.phone}</span>
            </a>
          )}
          {hasEmail && (
            <a
              href={`mailto:${caseRow.email}`}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-moss/40 hover:bg-moss/5"
            >
              <span className="shrink-0 font-semibold text-steel">E-mail</span>
              <span className="truncate">{caseRow.email}</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function DashboardTodayTaskCard({ task, today }: { task: CaseTask; today: string }) {
  const overdue = !!task.due_date && task.due_date < today;
  const cta = task.case_id ? "Karta sprawy →" : "Otwórz →";

  return (
    <li>
      <Link
        href={dashboardTaskHref(task)}
        className={`group relative block overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
          overdue ? "border-red-200 bg-red-50/60 hover:border-red-300" : "border-amber-200 bg-amber-50/50 hover:border-amber-300"
        }`}
      >
        <span className={`absolute inset-y-0 left-0 w-1.5 ${overdue ? "bg-red-500" : "bg-amber-400"}`} aria-hidden />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-ink">{task.title}</p>
            <p className={`mt-0.5 text-xs ${overdue ? "text-red-700" : "text-amber-800"}`}>
              {overdue ? "zaległe · " : ""}termin: {formatDate(task.due_date)} · priorytet: {task.priority}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold text-moss transition group-hover:bg-stone-50 ${
              overdue ? "border-red-300" : "border-amber-300"
            }`}
          >
            {cta}
          </span>
        </div>
      </Link>
    </li>
  );
}

export default function DashboardPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <Dashboard />
        </AppShell>
      )}
    </AuthGate>
  );
}

function Dashboard() {
  const router = useRouter();
  const { organizationId, role } = useOrg();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const today = warsawTodayIso();

  // Flota i magazyn zniknęły z dashboardu, więc nie pobieramy ich już przy każdym wejściu
  // na stronę główną — to dwa zapytania mniej dla każdego użytkownika.
  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const [{ data }, { data: t }] = await Promise.all([
      supabase.from("case_records").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      supabase
        .from("case_tasks")
        .select("*")
        .eq("organization_id", organizationId)
        .in("status", ["do zrobienia", "w toku"])
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(50)
    ]);
    setCases((data || []) as CaseRow[]);
    setTasks((t || []) as CaseTask[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [organizationId]);

  const stats = useMemo(
    () => [
      {
        label: "Nowe zlecenia",
        value: cases.filter((c) => c.status === "nowe zapytanie").length,
        href: `/cases?preset=${CASE_LIST_PRESET.noweZapytania}`
      },
      {
        label: "W trakcie realizacji",
        value: cases.filter((c) =>
          ["do wyceny", "wycena wysłana", "do decyzji klienta", "umowa do podpisu"].includes(c.status)
        ).length,
        href: `/cases?preset=${CASE_LIST_PRESET.wOfercie}`
      },
      {
        label: "Realizacja",
        value: cases.filter((c) => ["termin zarezerwowany", "realizacja", "odbiór"].includes(c.status)).length,
        href: `/cases?preset=${CASE_LIST_PRESET.realizacja}`
      },
      {
        label: "Zaległe kontakty",
        value: cases.filter((c) => isDue(c.next_contact_date) && !terminal.has(c.status)).length,
        href: `/cases?preset=${CASE_LIST_PRESET.kontaktPoTerminie}`,
        alert: true
      },
      { label: "Aktywne zadania", value: tasks.length, href: "/tasks?filter=active" },
      {
        label: "Zaległe zlecenia",
        value: cases.filter((c) => isCaseRealizationOverdue(c)).length,
        href: `/cases?preset=${CASE_LIST_PRESET.zalegleZlecenia}`,
        alert: true,
        danger: true
      }
      // Samochody i magazyn celowo poza dashboardem — to zasoby pomocnicze, a nie sprawy
      // wymagające reakcji przy porannym przeglądzie. Terminy pojazdów i niski stan magazynu
      // i tak trafiają do kalendarza, powiadomień i porannego digestu.
    ],
    [cases, tasks]
  );

  const contactDue = useMemo(
    () => cases.filter((c) => isDue(c.next_contact_date) && !terminal.has(c.status)).slice(0, 5),
    [cases]
  );

  const myTodayTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.due_date && isDue(t.due_date))
        .slice(0, 5),
    [tasks]
  );

  if (!organizationId) {
    return null;
  }

  if (isFieldRole(role)) {
    const myActiveBuilds = cases.filter((c) => ["termin zarezerwowany", "realizacja", "odbiór"].includes(c.status));
    const fieldStats = [
      { label: "Moje budowy w realizacji", value: myActiveBuilds.length, href: `/cases?preset=${CASE_LIST_PRESET.realizacja}` },
      { label: "Moje zlecenia", value: cases.length, href: "/cases" },
      { label: "Aktywne zadania", value: tasks.length, href: "/tasks?filter=active" },
      { label: "Zadania na dziś / zaległe", value: myTodayTasks.length, href: "/tasks?filter=przeterminowane" }
    ];
    return (
      <div className="grid min-w-0 gap-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Panel pracownika</p>
          <h1 className="mt-2 text-2xl font-bold leading-tight text-ink sm:text-3xl">Moje budowy i zadania</h1>
        </div>

        <section className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
          {fieldStats.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-xl2 border border-stone-200/80 bg-white p-3.5 shadow-card transition hover:border-moss/50 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:p-5"
            >
              <p className="text-xs font-medium text-steel sm:text-sm">{item.label}</p>
              {loading ? (
                <span className="mt-2 block h-8 w-12 animate-pulse rounded-md bg-stone-200 sm:mt-3" aria-hidden />
              ) : (
                <p className="mt-2 text-2xl font-bold text-ink sm:mt-3 sm:text-3xl">{item.value}</p>
              )}
              <p className="mt-1.5 text-xs font-semibold text-moss sm:mt-2">Przejdź →</p>
            </Link>
          ))}
        </section>

        <section className="grid min-w-0 grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:gap-3">
          {[
            { href: "/cases?preset=realizacja", label: "W trakcie realizacji" },
            { href: "/tasks", label: "Moje zadania" },
            { href: "/calendar", label: "Kalendarz" },
            ...(role === "brygadzista" ? [{ href: "/time", label: "Czas pracy" }] : [])
          ].map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="rounded-xl2 border border-stone-200/80 bg-white px-4 py-3 text-center text-sm font-semibold text-ink shadow-card transition hover:border-moss/50 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:text-left"
            >
              {q.label}
            </Link>
          ))}
        </section>

        {myTodayTasks.length > 0 && (
          <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-ink sm:text-lg">Zadania na dziś / zaległe</h2>
              <Link href="/tasks" className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-moss hover:bg-moss/10">
                Wszystkie zadania →
              </Link>
            </div>
            <ul className="mt-3 grid gap-2.5 text-sm">
              {myTodayTasks.map((t) => (
                <DashboardTodayTaskCard key={t.id} task={t} today={today} />
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-6">
      <div className="grid min-w-0 gap-3 sm:flex sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Panel operacyjny</p>
          <h1 className="mt-2 max-w-full text-2xl font-bold leading-tight text-ink sm:text-3xl">Zlecenia, oferty i realizacje</h1>
        </div>
        <div className="grid gap-2 sm:flex">
          <Link
            href="/cases/new"
            className="w-full max-w-full rounded-lg bg-ink px-4 py-3 text-center text-sm font-semibold text-white hover:bg-moss sm:w-auto"
          >
            Nowe zlecenie
          </Link>
        </div>
      </div>

      <section className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
        {stats.map((item) => {
          const active = !loading && "alert" in item && item.alert && item.value > 0;
          const danger = active && "danger" in item && item.danger;
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-label={`${item.label}: ${loading ? "wczytywanie" : item.value}${active ? " — wymaga uwagi" : ""}`}
              className={`rounded-xl2 border p-3.5 shadow-card transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:p-5 ${
                danger
                  ? "border-red-300 bg-red-50/70 hover:border-red-400"
                  : active
                    ? "border-amber-300 bg-amber-50/60 hover:border-amber-400"
                    : "border-stone-200/80 bg-white hover:border-moss/50"
              }`}
            >
              <p className={`text-xs font-medium sm:text-sm ${danger ? "text-red-800" : active ? "text-amber-800" : "text-steel"}`}>{item.label}</p>
              {loading ? (
                <span className="mt-2 block h-8 w-12 animate-pulse rounded-md bg-stone-200 sm:mt-3" aria-hidden />
              ) : (
                <p className={`mt-2 text-2xl font-bold sm:mt-3 sm:text-3xl ${danger ? "text-red-700" : active ? "text-amber-700" : "text-ink"}`}>{item.value}</p>
              )}
              <p className={`mt-1.5 text-xs font-semibold sm:mt-2 ${danger ? "text-red-700" : active ? "text-amber-700" : "text-moss"}`}>
                {active ? "Wymaga uwagi →" : "Przejdź →"}
              </p>
            </Link>
          );
        })}
      </section>

      <section className="grid min-w-0 grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:gap-3">
        {[
          { href: "/board", label: "Tablica" },
          { href: "/tasks", label: "Zadania pracowników" },
          { href: "/calendar", label: "Kalendarz" },
          { href: "/reports", label: "Raporty + eksport" }
          // Samochody i magazyn zostają w menu bocznym, w grupie „Zasoby".
        ].map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="rounded-xl2 border border-stone-200/80 bg-white px-4 py-3 text-center text-sm font-semibold text-ink shadow-card transition hover:border-moss/50 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:text-left"
          >
            {q.label}
          </Link>
        ))}
      </section>

      {myTodayTasks.length > 0 && (
        <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-ink sm:text-lg">Zadania na dziś / zaległe</h2>
            <Link href="/tasks" className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-moss hover:bg-moss/10">
              Wszystkie zadania →
            </Link>
          </div>
          <ul className="mt-3 grid gap-2.5 text-sm">
            {myTodayTasks.map((t) => (
              <DashboardTodayTaskCard key={t.id} task={t} today={today} />
            ))}
          </ul>
        </section>
      )}

      <section className="grid min-w-0 gap-4 xl:grid-cols-[0.95fr_1.35fr] xl:gap-6">
        <div className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
          <h2 className="text-base font-bold text-ink sm:text-lg">Do przypomnienia (kontakt)</h2>
          <div className="mt-4 grid gap-2.5">
            {contactDue.length === 0 ? (
              <p className="rounded-xl2 border border-dashed border-stone-200 p-4 text-center text-sm text-steel">Brak spraw z przeterminowanym kontaktem.</p>
            ) : (
              contactDue.map((c) => <ContactReminderCard key={c.id} caseRow={c} />)
            )}
          </div>
        </div>

        <div className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-ink sm:text-lg">Ostatnie sprawy</h2>
            <Link href="/cases" className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-moss hover:bg-moss/10">
              Pełna lista →
            </Link>
          </div>
          <div className="mt-4 grid gap-2.5 sm:hidden">
            {cases.slice(0, 6).map((c) => (
              <Link
                key={c.id}
                href={`/cases/${c.id}`}
                className="block rounded-xl2 border border-stone-200 p-3.5 transition hover:border-moss/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-ink">{c.client_name}</span>
                  <StatusBadge status={c.status} />
                </div>
                <p className="mt-1 text-xs text-steel">{c.location || "Bez lokalizacji"}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-steel">
                  <span>Termin: {formatDate(c.next_contact_date)}</span>
                  <span>{formatMoney(c.estimated_value)}</span>
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-4 hidden max-w-full overflow-x-auto sm:block">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="text-xs uppercase text-steel">
                <tr>
                  <th className="py-3 pr-4">Klient</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Termin</th>
                  <th className="py-3 pr-4">Kwota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {cases.slice(0, 6).map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/cases/${c.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/cases/${c.id}`);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Otwórz sprawę: ${c.client_name}`}
                    className="cursor-pointer transition hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
                  >
                    <td className="py-3 pr-4">
                      <span className="font-semibold text-ink">{c.client_name}</span>
                      <p className="text-xs text-steel">{c.location || "Bez lokalizacji"}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="py-3 pr-4 text-steel">{formatDate(c.next_contact_date)}</td>
                    <td className="py-3 pr-4 text-steel">{formatMoney(c.estimated_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

    </div>
  );
}
