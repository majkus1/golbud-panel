"use client";

import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { CasesListClient } from "./cases-list-client";

function CasesFallback() {
  return (
    <div className="rounded-lg bg-white p-8 text-center text-sm text-steel shadow-panel">
      Wczytywanie listy spraw…
    </div>
  );
}

export default function CasesPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <Suspense fallback={<CasesFallback />}>
            <CasesListClient />
          </Suspense>
        </AppShell>
      )}
    </AuthGate>
  );
}
