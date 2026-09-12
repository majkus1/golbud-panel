"use client";

import type { CaseStatus } from "@/lib/types";

/** Wizualna oś procesu: zapytanie → wycena → umowa → zaliczka → realizacja → rozliczenie. */
const STEPS = ["Zapytanie", "Wycena", "Umowa", "Zaliczka", "Realizacja", "Rozliczenie"] as const;

const STATUS_TO_STEP: Record<CaseStatus, number> = {
  "nowe zapytanie": 0,
  "do kontaktu": 0,
  "wysłano pytania": 0,
  "oczekujemy na zdjęcia/projekt": 0,
  "do wyceny": 1,
  "wycena wysłana": 1,
  "do decyzji klienta": 1,
  "umowa do podpisu": 2,
  "zaliczka do wpłaty": 3,
  "termin zarezerwowany": 4,
  "realizacja": 4,
  "odbiór": 4,
  "rozliczone": 5,
  "utracone": -1
};

export function ProcessTimeline({ status, embedded = false }: { status: CaseStatus; embedded?: boolean }) {
  const lost = status === "utracone";
  const reached = STATUS_TO_STEP[status] ?? 0;
  const completedAll = status === "rozliczone";

  if (lost) {
    return (
      <div className="rounded-xl2 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
        Sprawa oznaczona jako utracona — proces zamknięty.
      </div>
    );
  }

  const stepsDone = completedAll ? STEPS.length : reached;
  const progressPct = Math.round((stepsDone / STEPS.length) * 100);
  const currentLabel = completedAll ? "Zakończono" : STEPS[Math.min(reached, STEPS.length - 1)];
  const currentNumber = Math.min(stepsDone + (completedAll ? 0 : 1), STEPS.length);

  const shellClass = embedded
    ? "min-w-0 border-b border-stone-200/80 pb-4"
    : "min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card";

  return (
    <div className={shellClass}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-steel">Proces sprawy</p>

      {/* Mobile: kompaktowy pasek postępu + plakietki */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-steel">
          <span>
            Krok <span className="font-bold text-ink">{currentNumber}</span> z {STEPS.length}
          </span>
          <span className="font-bold text-moss">{currentLabel}</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-stone-100">
          <div className="h-full rounded-full bg-moss transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
        <ol className="mt-3 flex flex-wrap gap-1.5">
          {STEPS.map((label, i) => {
            const done = completedAll || i < reached;
            const current = !completedAll && i === reached;
            const tone = done
              ? "bg-moss text-white"
              : current
                ? "border border-moss bg-moss/10 text-moss"
                : "bg-stone-100 text-stone-400";
            return (
              <li key={label} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ${tone}`}>
                <span className="leading-none">{done ? "✓" : i + 1}</span>
                <span className="leading-none">{label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Desktop: pełny stepper */}
      <ol className="hidden items-center gap-1 overflow-x-auto pb-1 sm:flex">
        {STEPS.map((label, i) => {
          const done = completedAll || i < reached;
          const current = !completedAll && i === reached;
          const circle = done
            ? "bg-moss text-white border-moss"
            : current
              ? "border-moss text-moss bg-moss/10"
              : "border-stone-300 text-stone-400 bg-white";
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center">
              <div className="flex min-w-[64px] flex-col items-center text-center">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${circle}`}>
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className={`mt-1.5 whitespace-nowrap text-[0.7rem] font-semibold ${
                    done || current ? "text-ink" : "text-stone-400"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <span className={`mx-1 h-0.5 flex-1 rounded ${i < reached || completedAll ? "bg-moss" : "bg-stone-200"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
