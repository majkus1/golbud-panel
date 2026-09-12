"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MemberRole } from "@/lib/types";

type OrgContextValue = {
  organizationId: string | null;
  organizationName: string | null;
  userId: string;
  role: MemberRole | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: memRows, error: memErr } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", userId);

    if (memErr) {
      setError(memErr.message);
      setOrganizationId(null);
      setOrganizationName(null);
      setRole(null);
      setLoading(false);
      return;
    }

    let memberships = memRows ?? [];

    if (memberships.length === 0) {
      const { data: rpcId, error: rpcErr } = await supabase.rpc("ensure_user_org");
      if (rpcErr) {
        setError(rpcErr.message);
        setOrganizationId(null);
        setOrganizationName(null);
        setRole(null);
        setLoading(false);
        return;
      }
      void rpcId;
      const { data: again } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", userId);
      memberships = again ?? [];
    }

    /**
     * Przy wielu członkostwach (np. własna pusta org z triggera + firma z zaproszenia):
     * 1) maks. liczba członków w organizacji,
     * 2) remis: wolisz org., gdzie rola ≠ `owner` (zaproszenie do firmy zamiast „pustego” GolBud),
     * 3) stabilny UUID.
     * Gdy zapytanie o liczby się nie uda, sortujemy tylko po (2)+(3).
     */
    const roleByOrg = new Map(memberships.map((m) => [m.organization_id as string, m.role as string]));
    let chosen = memberships[0];
    if (memberships.length > 1) {
      const orgIds = Array.from(new Set(memberships.map((m) => m.organization_id as string)));
      const { data: allInOrgs, error: cntErr } = await supabase
        .from("organization_members")
        .select("organization_id")
        .in("organization_id", orgIds);

      const counts = new Map<string, number>();
      if (!cntErr && allInOrgs?.length) {
        for (const r of allInOrgs) {
          const id = r.organization_id as string;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }

      const ownerRank = (orgId: string) => (roleByOrg.get(orgId) === "owner" ? 1 : 0);

      let candidates = [...orgIds];
      if (counts.size > 0) {
        let bestN = -1;
        for (const id of orgIds) {
          bestN = Math.max(bestN, counts.get(id) ?? 0);
        }
        candidates = orgIds.filter((id) => (counts.get(id) ?? 0) === bestN);
      }

      candidates.sort((a, b) => {
        if (ownerRank(a) !== ownerRank(b)) return ownerRank(a) - ownerRank(b);
        return a.localeCompare(b);
      });
      const bestId = candidates[0];
      chosen = memberships.find((m) => m.organization_id === bestId) ?? memberships[0];
    }

    if (!memberships.length) {
      setError("Nie udało się wczytać organizacji.");
      setOrganizationId(null);
      setOrganizationName(null);
      setRole(null);
      setLoading(false);
      return;
    }

    const oid = chosen?.organization_id as string | undefined;
    const userRole = (chosen?.role as MemberRole | undefined) ?? null;

    if (!oid) {
      setError("Brak przypisania do organizacji.");
      setOrganizationId(null);
      setOrganizationName(null);
      setRole(null);
      setLoading(false);
      return;
    }

    const { data: org, error: orgErr } = await supabase.from("organizations").select("id,name").eq("id", oid).single();

    if (orgErr || !org) {
      setError(orgErr?.message || "Nie udało się wczytać organizacji.");
      setOrganizationId(null);
      setOrganizationName(null);
      setRole(null);
    } else {
      setOrganizationId(org.id);
      setOrganizationName(org.name);
      setRole(userRole ?? "member");
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <OrgContext.Provider value={{ organizationId, organizationName, userId, role, loading, error, refresh }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error("useOrg musi być użyte wewnątrz OrgProvider.");
  }
  return ctx;
}

export function canManageOrg(role: MemberRole | null) {
  return role === "owner" || role === "office" || role === "manager";
}

/** Wgląd w finanse (płatności, faktury) — tylko role zarządcze. */
export function canSeeFinances(role: MemberRole | null) {
  return role === "owner" || role === "office" || role === "manager";
}

/** Poufne dane płacowe: indywidualne stawki, wypłaty i karty miesięczne. */
export function canViewPayroll(role: MemberRole | null) {
  return role === "owner" || role === "manager";
}

/** Nowe zlecenie / lead — biuro, kierownik, handlowiec (nie pracownik terenowy). */
export function canCreateCases(role: MemberRole | null) {
  return role === "owner" || role === "office" || role === "manager" || role === "sales";
}

/** Przypisania zespołu do sprawy (odpowiedzialni + teren). */
export function canManageCaseTeam(role: MemberRole | null) {
  return canManageOrg(role) || role === "sales";
}

/** Role „terenowe": ograniczony widok (tylko swoje budowy, bez finansów). */
export function isFieldRole(role: MemberRole | null) {
  return role === "brygadzista" || role === "podwykonawca" || role === "member";
}

/** Ewidencja godzin — wpisuje brygadzista lub biuro/kierownik; zwykły pracownik tylko podgląd (brak). */
export function canEditWorkHours(role: MemberRole | null) {
  return canManageOrg(role) || role === "brygadzista";
}

/** Czy rola może tworzyć/edytować dane firmowe (sprzęt, magazyn, polisy, samochody, raporty). */
export function canManageResources(role: MemberRole | null) {
  return canManageOrg(role);
}

/**
 * Dostęp do Asystenta AI (globalnie i przy sprawie) — wszystkie role oprócz
 * podwykonawcy i zwykłego pracownika. Widoczność konkretnych danych (finanse,
 * kadry, flota itd.) w treści odpowiedzi jest dalej zawężana osobno wg roli
 * oraz przez RLS (np. handlowiec/brygadzista widzą tylko swoje sprawy).
 */
export function canUseAssistant(role: MemberRole | null) {
  return canManageOrg(role) || role === "sales" || role === "brygadzista";
}
