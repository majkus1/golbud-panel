"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { CaseForm, caseCommercialPayload, caseInsertPayload } from "@/components/case-form";
import { canCreateCases, useOrg } from "@/components/org-context";
import { insertDefaultSchedule } from "@/lib/case-defaults";
import { selectedEstimateLines } from "@/lib/estimate-import";
import { notifyCaseAssignees, syncCaseAssignees } from "@/lib/case-assignees";
import { insertImportedOfferLines } from "@/lib/offer-lines";
import { notify } from "@/lib/notify-client";
import { supabase } from "@/lib/supabase";
import type { CaseFormValues } from "@/lib/types";

export default function NewCasePage() {
  return (
    <AuthGate>
      {(session) => (
        <AppShell>
          <NewCase userId={session.user.id} />
        </AppShell>
      )}
    </AuthGate>
  );
}

function NewCase({ userId }: { userId: string }) {
  const router = useRouter();
  const { organizationId, role, loading } = useOrg();

  useEffect(() => {
    if (!loading && role && !canCreateCases(role)) {
      router.replace("/cases?preset=realizacja");
    }
  }, [loading, role, router]);

  if (!organizationId) return null;
  if (!loading && role && !canCreateCases(role)) {
    return <p className="text-sm text-steel">Brak uprawnień do tworzenia zleceń.</p>;
  }

  const onSubmit = async (values: CaseFormValues) => {
    const payload = caseInsertPayload(values, organizationId, userId);
    const { data, error } = await supabase.from("cases").insert(payload).select("id").single();
    if (error || !data) {
      window.alert(error?.message || "Nie udało się utworzyć sprawy.");
      return;
    }
    const { error: commercialError } = await supabase
      .from("case_commercial_details")
      .upsert(caseCommercialPayload(values, data.id, organizationId, userId), { onConflict: "case_id" });
    if (commercialError) {
      window.alert(`Sprawa została utworzona, ale nie zapisano wartości: ${commercialError.message}`);
      return;
    }
    await insertDefaultSchedule(supabase, organizationId, data.id);
    const { data: variant, error: variantErr } = await supabase
      .from("offer_variants")
      .insert({
        organization_id: organizationId,
        case_id: data.id,
        name: "Wariant podstawowy",
        sort_order: 0
      })
      .select("id")
      .single();
    if (variantErr || !variant) {
      window.alert(variantErr?.message || "Nie udało się utworzyć wariantu oferty.");
      return;
    }
    const estimateLines = selectedEstimateLines(values.estimate_draft);
    if (estimateLines.length > 0) {
      const linesResult = await insertImportedOfferLines(
        supabase,
        organizationId,
        variant.id,
        estimateLines
      );
      if (!linesResult.ok) {
        window.alert(linesResult.error);
        return;
      }
    }
    const teamResult = await syncCaseAssignees(supabase, data.id, {
      responsibleUserIds:
        values.responsible_user_ids.length > 0
          ? values.responsible_user_ids
          : role === "sales"
            ? [userId]
            : [],
      assignedUserIds: values.assigned_user_ids
    });
    if (!teamResult.ok) {
      window.alert(teamResult.error);
      return;
    }
    await notifyCaseAssignees(data.id, teamResult.addedUserIds);
    void notify({ type: "new_case", caseId: data.id });
    const offerTab = estimateLines.length > 0 ? "?tab=offer" : "";
    router.push(`/cases/${data.id}${offerTab}`);
  };

  return (
    <div className="grid min-w-0 gap-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Nowe zlecenie</p>
        <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">Karta klienta / budowy</h1>
        <p className="mt-2 text-sm text-steel">
          Po zapisaniu utworzymy harmonogram, wariant oferty
          {canCreateCases(role) ? " — opcjonalnie możesz od razu wgrać kosztorys z pliku." : "."}
        </p>
      </div>
      <CaseForm
        organizationId={organizationId}
        submitLabel="Utwórz zlecenie"
        onSubmit={onSubmit}
        showTeam={canCreateCases(role)}
        showEstimate={canCreateCases(role)}
        autoAssignCrewMembers={canCreateCases(role)}
      />
    </div>
  );
}
