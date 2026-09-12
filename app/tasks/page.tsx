"use client";

import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { TasksPageClient } from "./tasks-page-client";

function TasksFallback() {
  return (
    <div className="rounded-lg bg-white p-8 text-center text-sm text-steel shadow-panel">
      Wczytywanie zadań…
    </div>
  );
}

export default function TasksPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <div className="grid min-w-0 gap-5">
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Zadania pracowników</p>
              <h1 className="mt-2 text-xl font-bold text-ink sm:text-3xl">Lista zadań biura i ekip</h1>
              <p className="mt-1 text-sm text-steel">
                Zadzwonić, wysłać ofertę, zamówić materiał, przygotować umowę, wystawić fakturę, przypomnieć klientowi, zrobić protokół.
              </p>
            </div>
            <Suspense fallback={<TasksFallback />}>
              <TasksPageClient />
            </Suspense>
          </div>
        </AppShell>
      )}
    </AuthGate>
  );
}
