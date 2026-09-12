"use client";

import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { CaseDetailView } from "@/components/case/case-detail-view";
import { useOrg } from "@/components/org-context";

export default function CaseDetailPage() {
  return (
    <AuthGate>
      {(session) => (
        <AppShell>
          <CaseDetailInner userId={session.user.id} />
        </AppShell>
      )}
    </AuthGate>
  );
}

function CaseDetailInner({ userId }: { userId: string }) {
  const { organizationId } = useOrg();
  if (!organizationId) return null;
  return <CaseDetailView organizationId={organizationId} userId={userId} />;
}
