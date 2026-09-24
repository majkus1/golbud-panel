"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { canManageOrg, useOrg } from "@/components/org-context";
import { StatusBadge } from "@/components/status-badge";
import { showToast } from "@/components/toast";
import { BackLink, EmptyState } from "@/components/ui";
import { loadOrganizationMemberDirectory, memberDisplayName } from "@/lib/case-leads";
import { formatDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { CaseStatus, OrgMemberProfile } from "@/lib/types";

type TrashedCase = {
  id: string;
  client_name: string;
  location: string | null;
  status: CaseStatus;
  source: string;
  created_by: string | null;
  created_at: string;
  deleted_at: string;
  deleted_by: string | null;
};

type PurgePreview = { caseId: string; clientName: string; summary: string; blockers: string[] };

/**
 * Kosz spraw. „Usuń sprawę” w karcie przenosi ją tutaj — znika z list, kalendarza,
 * zadań i raportów, ale nic nie jest kasowane. Stąd można ją przywrócić albo (tylko
 * właściciel) usunąć trwale razem z plikami. Bez automatycznego czyszczenia po czasie.
 */
export default function TrashPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <TrashInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function TrashInner() {
  const { organizationId, role } = useOrg();
  const canUse = canManageOrg(role);
  const isOwner = role === "owner";
  const [items, setItems] = useState<TrashedCase[]>([]);
  const [members, setMembers] = useState<OrgMemberProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId || !canUse) return;
    setLoading(true);
    const [{ data, error }, directory] = await Promise.all([
      supabase.rpc("list_trashed_cases", { p_organization_id: organizationId }),
      loadOrganizationMemberDirectory(supabase, organizationId)
    ]);
    if (error) showToast("Nie udało się wczytać kosza", "error");
    setItems((data || []) as TrashedCase[]);
    setMembers(directory);
    setLoading(false);
  }, [organizationId, canUse]);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (item: TrashedCase) => {
    setBusyId(item.id);
    const { error } = await supabase.rpc("restore_case", { p_case_id: item.id });
    setBusyId(null);
    if (error) {
      showToast("Nie udało się przywrócić sprawy", "error");
      return;
    }
    showToast(`Przywrócono: ${item.client_name}`);
    await load();
  };

  const askPurge = async (item: TrashedCase) => {
    setBusyId(item.id);
    const res = await fetch(`/api/cases/${item.id}/purge`);
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      showToast(json.error || "Nie udało się sprawdzić sprawy", "error");
      return;
    }
    setPreview({ caseId: item.id, clientName: item.client_name, summary: json.summary, blockers: json.blockers || [] });
  };

  const purge = async () => {
    if (!preview) return;
    setPurging(true);
    const res = await fetch(`/api/cases/${preview.caseId}/purge`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setPurging(false);
    if (!res.ok) {
      showToast(json.blockers?.[0] || json.error || "Nie udało się usunąć sprawy", "error");
      return;
    }
    showToast(`Usunięto trwale: ${preview.clientName}`);
    setPreview(null);
    await load();
  };

  if (!organizationId) return null;

  if (!canUse) {
    return (
      <section className="rounded-lg bg-white p-6 shadow-panel">
        <h1 className="text-xl font-bold text-ink">Kosz</h1>
        <p className="mt-2 text-sm text-steel">Kosz widzi właściciel, biuro i kierownik.</p>
      </section>
    );
  }

  const blocked = (preview?.blockers.length ?? 0) > 0;

  return (
    <div className="grid max-w-4xl gap-6">
      <div>
        <BackLink href="/cases" className="mb-2">Zapytania i oferty</BackLink>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Zapytania i oferty</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Kosz</h1>
        <p className="mt-2 max-w-2xl text-sm text-steel">
          Sprawy usunięte z karty. Nie ma ich na listach, w kalendarzu, zadaniach ani raportach, ale dane zostają — możesz je przywrócić.
          {isOwner ? " Trwale usuwa tylko właściciel." : " Trwale usuwa sprawę właściciel firmy."}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-steel">Wczytywanie…</p>
      ) : items.length === 0 ? (
        <EmptyState title="Kosz jest pusty" description="Usunięte sprawy pojawią się tutaj." />
      ) : (
        <ul className="grid gap-2.5">
          {items.map((item) => {
            const who = item.deleted_by ? memberDisplayName(members.find((m) => m.user_id === item.deleted_by), item.deleted_by) : "—";
            return (
              <li key={item.id} className="flex flex-col gap-3 rounded-xl2 border border-stone-200 bg-white p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{item.client_name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-steel">
                    <StatusBadge status={item.status} />
                    <span>{item.location || "brak lokalizacji"}</span>
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    W koszu od {formatDateTime(item.deleted_at)} · usunął(a): {who}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void restore(item)}
                    className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-moss disabled:opacity-60"
                  >
                    Przywróć
                  </button>
                  {isOwner && (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void askPurge(item)}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                    >
                      Usuń trwale
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={preview !== null}
        title={blocked ? "Tej sprawy nie można usunąć trwale" : `Usunąć trwale „${preview?.clientName ?? ""}”?`}
        message={
          blocked
            ? (preview?.blockers ?? []).join(" ")
            : `Razem ze sprawą znikną: ${preview?.summary ?? ""}. Pliki zostaną skasowane z serwera. Tego nie da się cofnąć.`
        }
        confirmLabel={blocked ? "Rozumiem" : "Usuń trwale"}
        showCancel={!blocked}
        variant={blocked ? "default" : "danger"}
        loading={purging}
        onCancel={() => setPreview(null)}
        onConfirm={() => (blocked ? setPreview(null) : void purge())}
      />
    </div>
  );
}
