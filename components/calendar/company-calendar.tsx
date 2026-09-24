"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarEntryDialog, type CalendarEntryTarget } from "@/components/calendar/calendar-entry-dialog";
import { useCalendarData, type CalendarBusinessItem, type CalendarHrItem } from "@/components/calendar/use-calendar-data";
import { canManageOrg, useOrg } from "@/components/org-context";
import { MONTHS, PRIORITY_TONE_CLASSES, WEEKDAYS, buildGrid, compareDayEntries, formatTime, isoOf, priorityLabel, priorityTone, shiftMonth } from "@/lib/calendar";
import { formatDate } from "@/lib/format";
import { documentExpiryLabel, EMPLOYEE_DOCUMENT_TYPE_LABELS } from "@/lib/hr";
import { warsawTodayIso } from "@/lib/warsaw-today";
import type { CaseTask } from "@/lib/types";

type CalendarFilter = "all" | "tasks" | "hr" | "business";

const FILTERS: [CalendarFilter, string][] = [
  ["all", "Wszystko"],
  ["tasks", "Wpisy i zadania"],
  ["business", "Terminy"],
  ["hr", "Kadry"]
];

const HR_DOT = "bg-violet-500";
const BUSINESS_DOT = "bg-sky-500";

function isEntry(t: CaseTask): boolean {
  return t.kind === "wpis";
}

/**
 * Kalendarz firmy: wpisy (dodawane z kalendarza), zadania pracowników, terminy ze spraw
 * i finansów oraz terminy kadrowe. Kolory wpisów i zadań: pilne czerwone, ważne żółte,
 * zwykłe zielone. Ten sam komponent jest na Pulpicie (`variant="dashboard"`, zwarty)
 * i na stronie Kalendarza.
 */
export function CompanyCalendar({ variant = "page" }: { variant?: "page" | "dashboard" }) {
  const { organizationId, role, userId } = useOrg();
  const todayIso = warsawTodayIso();
  const today = new Date(`${todayIso}T00:00:00`);
  const compact = variant === "dashboard";
  const canAddEntries = role !== "podwykonawca";
  const canSeeHr = role !== "podwykonawca";

  const [cursor, setCursor] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));
  const [selected, setSelected] = useState<string>(todayIso);
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [dialog, setDialog] = useState<CalendarEntryTarget | null>(null);

  const { tasks, hrItems, businessItems, employeeLabels, caseLabels, caseOptions, loading, reload } = useCalendarData(organizationId, role, cursor, todayIso);
  const grid = useMemo(() => buildGrid(cursor.year, cursor.month), [cursor]);

  const byDay = useMemo(() => {
    const map: Record<string, CaseTask[]> = {};
    for (const t of tasks) {
      if (!t.due_date) continue;
      (map[t.due_date] ??= []).push(t);
    }
    for (const list of Object.values(map)) list.sort(compareDayEntries);
    return map;
  }, [tasks]);

  const hrByDay = useMemo(() => {
    const map: Record<string, CalendarHrItem[]> = {};
    for (const document of hrItems) {
      if (!document.valid_until) continue;
      (map[document.valid_until] ??= []).push(document);
    }
    return map;
  }, [hrItems]);

  const businessByDay = useMemo(() => {
    const map: Record<string, CalendarBusinessItem[]> = {};
    for (const item of businessItems) (map[item.date] ??= []).push(item);
    return map;
  }, [businessItems]);

  // Po terminie są tylko zadania — wpis z wczoraj to po prostu miniony termin.
  const isOverdue = (t: CaseTask) => !isEntry(t) && !!t.due_date && t.due_date < todayIso && t.status !== "zrobione" && t.status !== "anulowane";
  const isClosed = (t: CaseTask) => t.status === "zrobione" || t.status === "anulowane";

  const goToday = () => {
    setCursor({ year: today.getFullYear(), month: today.getMonth() });
    setSelected(todayIso);
  };

  const selectedTasks = filter === "hr" || filter === "business" ? [] : byDay[selected] || [];
  const selectedHr = filter === "tasks" || filter === "business" ? [] : hrByDay[selected] || [];
  const selectedBusiness = filter === "tasks" || filter === "hr" ? [] : businessByDay[selected] || [];
  const selectedCount = selectedTasks.length + selectedHr.length + selectedBusiness.length;

  if (!organizationId) return null;

  const monthNav = (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <button type="button" onClick={() => setCursor((c) => shiftMonth(c, -1))} aria-label="Poprzedni miesiąc" className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-stone-50">
        ←
      </button>
      <span className="min-w-[130px] text-center text-sm font-bold text-ink sm:min-w-[150px]">
        {MONTHS[cursor.month]} {cursor.year}
      </span>
      <button type="button" onClick={() => setCursor((c) => shiftMonth(c, 1))} aria-label="Następny miesiąc" className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-stone-50">
        →
      </button>
      <button type="button" onClick={goToday} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-stone-50">
        Dziś
      </button>
    </div>
  );

  const addButton = canAddEntries ? (
    <button type="button" onClick={() => setDialog({ mode: "new", date: selected })} className="rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-moss">
      + Dodaj wpis
    </button>
  ) : null;

  const filters = (
    <div className={`grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1 sm:w-fit sm:grid-cols-4 ${compact ? "text-xs" : ""}`}>
      {FILTERS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          disabled={id === "hr" && !canSeeHr}
          onClick={() => setFilter(id)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold sm:text-sm ${filter === id ? "bg-white text-ink shadow-sm" : "text-steel hover:text-ink disabled:opacity-40"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const legend = (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-steel sm:text-xs">
      <span className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${PRIORITY_TONE_CLASSES.red.dot}`} />pilne</span>
      <span className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${PRIORITY_TONE_CLASSES.yellow.dot}`} />ważne</span>
      <span className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${PRIORITY_TONE_CLASSES.green.dot}`} />zwykłe</span>
      <span className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${BUSINESS_DOT}`} />terminy ze spraw i firmy</span>
      {canSeeHr && <span className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${HR_DOT}`} />kadry</span>}
    </p>
  );

  const monthGrid = (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[0.7rem] font-semibold uppercase tracking-wide text-steel sm:text-xs">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {grid.map((d) => {
          const iso = isoOf(d);
          const inMonth = d.getMonth() === cursor.month;
          const dayTasks = filter === "hr" || filter === "business" ? [] : byDay[iso] || [];
          const dayHr = filter === "tasks" || filter === "business" ? [] : hrByDay[iso] || [];
          const dayBusiness = filter === "tasks" || filter === "hr" ? [] : businessByDay[iso] || [];
          const eventCount = dayTasks.length + dayHr.length + dayBusiness.length;
          const isToday = iso === todayIso;
          const isSelected = iso === selected;
          const hasAlert =
            dayTasks.some((t) => isOverdue(t) || (!isClosed(t) && t.priority === "pilne")) ||
            dayHr.some((document) => !!document.valid_until && document.valid_until < todayIso) ||
            dayBusiness.some((item) => item.date < todayIso && (item.tone === "red" || item.tone === "amber"));
          const chipLimit = compact ? 2 : 3;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => setSelected(iso)}
              onDoubleClick={() => canAddEntries && setDialog({ mode: "new", date: iso })}
              aria-label={`${formatDate(iso)} — ${eventCount} terminów`}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              className={`flex flex-col rounded-lg border p-1 text-left transition sm:p-1.5 ${compact ? "min-h-[52px] sm:min-h-[76px]" : "min-h-[58px] sm:min-h-[92px]"} ${
                isSelected ? "border-moss ring-2 ring-moss/40" : "border-stone-200 hover:border-moss/50"
              } ${inMonth ? "bg-white" : "bg-stone-50/70"}`}
            >
              <span className={`flex items-center justify-between text-xs font-semibold ${inMonth ? "text-ink" : "text-stone-400"}`}>
                <span className={isToday ? "flex size-5 items-center justify-center rounded-full bg-ink text-[0.7rem] text-white" : ""}>{d.getDate()}</span>
                {eventCount > 0 && <span className={`text-[0.65rem] font-bold ${hasAlert ? "text-red-600" : "text-moss"}`}>{eventCount}</span>}
              </span>
              {/* Desktop: etykiety */}
              <span className="mt-1 hidden min-w-0 flex-col gap-0.5 sm:flex">
                {dayTasks.slice(0, chipLimit).map((t) => {
                  const tone = PRIORITY_TONE_CLASSES[isOverdue(t) ? "red" : priorityTone(t.priority)];
                  const time = formatTime(t.due_time);
                  return (
                    <span key={t.id} className={`flex min-w-0 items-center gap-1 truncate rounded px-1 py-0.5 text-[0.65rem] ${tone.chip} ${isClosed(t) ? "line-through opacity-60" : ""}`}>
                      <span className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
                      <span className="truncate">
                        {time ? `${time} ` : ""}
                        {t.title}
                      </span>
                    </span>
                  );
                })}
                {dayBusiness.slice(0, Math.max(0, chipLimit - dayTasks.length)).map((item) => (
                  <span key={item.id} className="flex min-w-0 items-center gap-1 truncate rounded bg-sky-50 px-1 py-0.5 text-[0.65rem] text-sky-800">
                    <span className={`size-1.5 shrink-0 rounded-full ${BUSINESS_DOT}`} />
                    <span className="truncate">{item.title}</span>
                  </span>
                ))}
                {dayHr.slice(0, Math.max(0, chipLimit - dayTasks.length - dayBusiness.length)).map((document) => (
                  <span key={document.id} className="flex min-w-0 items-center gap-1 truncate rounded bg-violet-50 px-1 py-0.5 text-[0.65rem] text-violet-800">
                    <span className={`size-1.5 shrink-0 rounded-full ${HR_DOT}`} />
                    <span className="truncate">
                      {employeeLabels[document.employee_id] || "Pracownik"}: {document.title}
                    </span>
                  </span>
                ))}
                {eventCount > chipLimit && <span className="px-1 text-[0.6rem] text-steel">+{eventCount - chipLimit} więcej</span>}
              </span>
              {/* Telefon: kropki */}
              {eventCount > 0 && (
                <span className="mt-auto flex flex-wrap gap-0.5 sm:hidden" aria-hidden>
                  {dayTasks.slice(0, 3).map((t) => (
                    <span key={t.id} className={`size-1.5 rounded-full ${PRIORITY_TONE_CLASSES[isOverdue(t) ? "red" : priorityTone(t.priority)].dot}`} />
                  ))}
                  {dayBusiness.slice(0, Math.max(0, 4 - dayTasks.length)).map((item) => <span key={item.id} className={`size-1.5 rounded-full ${BUSINESS_DOT}`} />)}
                  {dayHr.slice(0, Math.max(0, 4 - dayTasks.length - dayBusiness.length)).map((document) => <span key={document.id} className={`size-1.5 rounded-full ${HR_DOT}`} />)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const dayList = (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-ink sm:text-lg">{selected === todayIso ? `Dziś, ${formatDate(selected)}` : formatDate(selected)}</h2>
        {canAddEntries && (
          <button type="button" onClick={() => setDialog({ mode: "new", date: selected })} className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-moss hover:bg-moss/10">
            + Wpis na ten dzień
          </button>
        )}
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-steel">Wczytywanie…</p>
      ) : selectedCount === 0 ? (
        <p className="mt-3 rounded-xl2 border border-dashed border-stone-300 p-5 text-center text-sm text-steel">Brak terminów na ten dzień.</p>
      ) : (
        <ul className="mt-3 grid gap-2.5 text-sm">
          {selectedTasks.map((t) => {
            const overdue = isOverdue(t);
            const tone = PRIORITY_TONE_CLASSES[overdue ? "red" : priorityTone(t.priority)];
            const time = formatTime(t.due_time);
            const caseLabel = t.case_id ? caseLabels[t.case_id] || "Sprawa" : null;
            const details = (
              <>
                <span className={`absolute inset-y-0 left-0 w-1.5 rounded-l-xl2 ${tone.dot}`} aria-hidden />
                <div className="min-w-0">
                  <p className={`font-semibold text-ink ${isClosed(t) ? "line-through opacity-70" : ""}`}>
                    {time ? <span className="mr-1.5 tabular-nums">{time}</span> : null}
                    {t.title}
                  </p>
                  <p className="mt-0.5 text-xs text-steel">
                    {isEntry(t) ? "wpis" : "zadanie"} · {priorityLabel(t.priority)}
                    {isEntry(t) ? (isClosed(t) ? " · wykonane" : "") : ` · ${t.status}`}
                    {overdue ? " · po terminie" : ""}
                    {caseLabel ? ` · ${caseLabel}` : ""}
                  </p>
                  {isEntry(t) && t.description ? <p className="mt-1 whitespace-pre-line text-xs text-ink/80">{t.description}</p> : null}
                </div>
              </>
            );
            const cardClass = `relative flex w-full flex-wrap items-center justify-between gap-2 rounded-xl2 border p-3.5 pl-4 text-left shadow-card transition hover:shadow-md ${
              isClosed(t) ? "border-stone-200 bg-stone-50/60" : tone.card
            }`;
            return (
              <li key={t.id}>
                {isEntry(t) ? (
                  <button type="button" onClick={() => setDialog({ mode: "edit", entry: t })} className={cardClass}>
                    {details}
                    <span className="shrink-0 rounded-lg border border-stone-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-moss">Szczegóły</span>
                  </button>
                ) : (
                  <Link href={`/tasks?task=${t.id}`} className={cardClass}>
                    {details}
                    <span className="shrink-0 rounded-lg border border-stone-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-moss">Otwórz zadanie →</span>
                  </Link>
                )}
              </li>
            );
          })}
          {selectedBusiness.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className={`relative flex flex-wrap items-center justify-between gap-2 rounded-xl2 border p-3.5 pl-4 shadow-card transition hover:shadow-md ${
                  item.tone === "red" ? "border-red-200 bg-red-50/50 hover:border-red-300" : "border-sky-200 bg-sky-50/50 hover:border-sky-300"
                }`}
              >
                <span className={`absolute inset-y-0 left-0 w-1.5 rounded-l-xl2 ${item.tone === "red" ? "bg-red-500" : BUSINESS_DOT}`} aria-hidden />
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{item.title}</p>
                  <p className="mt-0.5 text-xs text-steel">{item.subtitle}</p>
                </div>
                <span className="shrink-0 rounded-lg border border-stone-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-moss">Otwórz →</span>
              </Link>
            </li>
          ))}
          {selectedHr.map((document) => {
            const body = (
              <>
                <span className={`absolute inset-y-0 left-0 w-1.5 rounded-l-xl2 ${HR_DOT}`} aria-hidden />
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{document.title}</p>
                  <p className="mt-0.5 text-xs text-steel">
                    {employeeLabels[document.employee_id] || "Pracownik"} · {EMPLOYEE_DOCUMENT_TYPE_LABELS[document.document_type]} · {documentExpiryLabel(document, todayIso)}
                  </p>
                </div>
              </>
            );
            // Karta HR (`/hr`) jest tylko dla ról zarządczych — pozostali widzą sam termin.
            return (
              <li key={document.id}>
                {canManageOrg(role) ? (
                  <Link href={`/hr?employee=${document.employee_id}`} className="relative flex flex-wrap items-center justify-between gap-2 rounded-xl2 border border-violet-200 bg-violet-50/50 p-3.5 pl-4 shadow-card transition hover:border-violet-300 hover:shadow-md">
                    {body}
                    <span className="shrink-0 rounded-lg border border-violet-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-violet-800">Karta HR →</span>
                  </Link>
                ) : (
                  <div className="relative flex flex-wrap items-center justify-between gap-2 rounded-xl2 border border-violet-200 bg-violet-50/50 p-3.5 pl-4 shadow-card">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const entryDialog = (
    <CalendarEntryDialog
      target={dialog}
      organizationId={organizationId}
      userId={userId}
      canDelete={dialog?.mode === "edit" && (canManageOrg(role) || dialog.entry.created_by === userId)}
      cases={caseOptions}
      onClose={() => setDialog(null)}
      onSaved={reload}
    />
  );

  if (compact) {
    return (
      <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-ink sm:text-lg">Kalendarz</h2>
            <Link href="/calendar" className="rounded-lg px-2 py-1 text-sm font-semibold text-moss hover:bg-moss/10">
              Pełny widok →
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {monthNav}
            {addButton}
          </div>
        </div>
        <div className="mt-3">{legend}</div>
        <div className="mt-3 grid min-w-0 gap-5 xl:grid-cols-[1.45fr_1fr]">
          {monthGrid}
          {dayList}
        </div>
        {entryDialog}
      </section>
    );
  }

  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid gap-3 sm:flex sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Kalendarz</p>
          <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">Kalendarz firmy</h1>
          <p className="mt-1 text-sm text-steel">Wpisy, zadania i terminy firmy. Kliknij dzień, aby zobaczyć szczegóły; dwuklik dodaje wpis na ten dzień.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {monthNav}
          {addButton}
        </div>
      </div>
      <div className="grid gap-2">
        {filters}
        {legend}
      </div>
      <section className="rounded-xl2 border border-stone-200/80 bg-white p-3 shadow-card sm:p-4">{monthGrid}</section>
      <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">{dayList}</section>
      {entryDialog}
    </div>
  );
}
