"use client";

import { PROCESS_STEPS, processStepForStatus } from "@/lib/case-tabs";
import type { CaseStatus } from "@/lib/types";

/**
 * Pasek procesu: zapytanie → oferta → umowa → przygotowanie → realizacja → odbiór.
 * Kliknięcie etapu otwiera zakładkę, w której się nad nim pracuje (`stepToTab`).
 * Etap bez zakładki dla danej roli (np. Oferta dla brygadzisty) nie jest klikalny.
 */
export function ProcessTimeline({
  status,
  embedded = false,
  onStepClick,
  isStepClickable
}: {
  status: CaseStatus;
  embedded?: boolean;
  onStepClick?: (step: number) => void;
  isStepClickable?: (step: number) => boolean;
}) {
  const lost = status === "utracone";
  const reached = processStepForStatus(status);
  const completedAll = status === "rozliczone";

  if (lost) {
    return (
      <div className="rounded-xl2 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
        Sprawa oznaczona jako utracona — proces zamknięty.
      </div>
    );
  }

  const total = PROCESS_STEPS.length;
  const stepsDone = completedAll ? total : reached;
  const progressPct = Math.round((stepsDone / total) * 100);
  const currentLabel = completedAll ? "Zakończono" : PROCESS_STEPS[Math.min(reached, total - 1)];
  const currentNumber = Math.min(stepsDone + (completedAll ? 0 : 1), total);
  const clickable = (i: number) => Boolean(onStepClick) && (isStepClickable ? isStepClickable(i) : true);

  const shellClass = embedded
    ? "min-w-0 border-b border-stone-200/80 pb-4"
    : "min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card";

  return (
    <div className={shellClass}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-steel">Etap obsługi</p>

      {/* Telefon: pasek postępu + plakietki */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-steel">
          <span>
            Krok <span className="font-bold text-ink">{currentNumber}</span> z {total}
          </span>
          <span className="font-bold text-moss">{currentLabel}</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-stone-100">
          <div className="h-full rounded-full bg-moss transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
        <ol className="mt-3 flex flex-wrap gap-1.5">
          {PROCESS_STEPS.map((label, i) => {
            const done = completedAll || i < reached;
            const current = !completedAll && i === reached;
            const tone = done
              ? "bg-moss text-white"
              : current
                ? "border border-moss bg-moss/10 text-moss"
                : "bg-stone-100 text-stone-500";
            const content = (
              <>
                <span className="leading-none">{done ? "✓" : i + 1}</span>
                <span className="leading-none">{label}</span>
              </>
            );
            return (
              <li key={label}>
                {clickable(i) ? (
                  <button
                    type="button"
                    onClick={() => onStepClick?.(i)}
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ${tone}`}
                  >
                    {content}
                  </button>
                ) : (
                  <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ${tone}`}>{content}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Komputer: pełny pasek */}
      <ol className="hidden items-center gap-1 overflow-x-auto pb-1 sm:flex">
        {PROCESS_STEPS.map((label, i) => {
          const done = completedAll || i < reached;
          const current = !completedAll && i === reached;
          const circle = done
            ? "bg-moss text-white border-moss"
            : current
              ? "border-moss text-moss bg-moss/10"
              : "border-stone-300 text-stone-400 bg-white";
          const inner = (
            <>
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${circle}`}>
                {done ? "✓" : i + 1}
              </span>
              <span className={`mt-1.5 max-w-[7.5rem] text-center text-[0.7rem] font-semibold leading-tight ${done || current ? "text-ink" : "text-stone-400"}`}>
                {label}
              </span>
            </>
          );
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center">
              {clickable(i) ? (
                <button
                  type="button"
                  onClick={() => onStepClick?.(i)}
                  title={`Otwórz: ${label}`}
                  className="flex min-w-[72px] flex-col items-center rounded-lg px-1 py-1 text-center transition hover:bg-stone-100"
                >
                  {inner}
                </button>
              ) : (
                <div className="flex min-w-[72px] flex-col items-center px-1 py-1 text-center">{inner}</div>
              )}
              {i < total - 1 && <span className={`mx-1 h-0.5 flex-1 rounded ${i < reached || completedAll ? "bg-moss" : "bg-stone-200"}`} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
