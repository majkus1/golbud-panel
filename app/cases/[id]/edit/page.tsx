"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { CaseForm, caseCommercialPayload, caseUpdatePayload, valuesFromCase } from "@/components/case-form";
import { canCreateCases, isFieldRole, useOrg } from "@/components/org-context";
import { loadCaseTeam, notifyCaseAssignees, syncCaseAssignees, teamSelectionToForm } from "@/lib/case-assignees";
import { supabase } from "@/lib/supabase";
import type { CaseFormValues, CaseRow } from "@/lib/types";

export default function EditCasePage() {
  return (
    <AuthGate>
      {(session) => (
        <AppShell>
          <EditCase userId={session.user.id} />
        </AppShell>
      )}
    </AuthGate>
  );
}

function EditCase({ userId }: { userId: string }) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { organizationId, role, loading: orgLoading } = useOrg();
  const [initial, setInitial] = useState<CaseFormValues | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!orgLoading && isFieldRole(role)) {
      router.replace(`/cases/${params.id}`);
    }
  }, [orgLoading, role, router, params.id]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const [{ data }, team] = await Promise.all([
      supabase.from("case_records").select("*").eq("id", params.id).maybeSingle(),
      loadCaseTeam(supabase, params.id)
    ]);
    if (!data) {
      setNotFound(true);
      setInitial(null);
      return;
    }
    setNotFound(false);
    setInitial(
      valuesFromCase(data as CaseRow, team ? teamSelectionToForm(team) : undefined)
    );
  }, [organizationId, params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (notFound) {
    return (
      <div className="rounded-lg bg-white p-6 shadow-panel">
        <p className="text-ink">Nie znaleziono sprawy.</p>
        <Link href="/cases" className="mt-3 inline-block text-sm font-semibold text-moss">
          Wróć do listy
        </Link>
      </div>
    );
  }

  if (!organizationId || !initial) {
    return <p className="text-sm text-steel">Ładowanie…</p>;
  }

  const onSubmit = async (values: CaseFormValues) => {
    const { error } = await supabase.from("cases").update(caseUpdatePayload(values)).eq("id", params.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    const { error: commercialError } = await supabase
      .from("case_commercial_details")
      .upsert(caseCommercialPayload(values, params.id, organizationId, userId), { onConflict: "case_id" });
    if (commercialError) {
      window.alert(`Dane sprawy zapisano, ale nie zapisano wartości: ${commercialError.message}`);
      return;
    }
    const teamResult = await syncCaseAssignees(supabase, params.id, {
      responsibleUserIds: values.responsible_user_ids,
      assignedUserIds: values.assigned_user_ids
    });
    if (!teamResult.ok) {
      window.alert(teamResult.error);
      return;
    }
    await notifyCaseAssignees(params.id, teamResult.addedUserIds);
    router.push(`/cases/${params.id}`);
  };

  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Edycja sprawy</p>
          <h1 className="mt-2 text-2xl font-bold text-ink">Dane podstawowe</h1>
        </div>
        <Link href={`/cases/${params.id}`} className="text-sm font-semibold text-moss hover:underline">
          Wróć do karty
        </Link>
      </div>
      <CaseForm
        key={params.id}
        organizationId={organizationId}
        initial={initial}
        submitLabel="Zapisz zmiany"
        onSubmit={onSubmit}
        showTeam={canCreateCases(role)}
      />
    </div>
  );
}
