"use client";

import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { AiAssistantPanel } from "@/components/ai-assistant-panel";
import { useOrg } from "@/components/org-context";

export default function AssistantPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <AssistantInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function AssistantInner() {
  const { organizationId, role } = useOrg();
  if (!organizationId) return null;

  return (
    <div className="grid min-w-0 gap-5">
      <AiAssistantPanel organizationId={organizationId} role={role} />
    </div>
  );
}
