"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { canManageOrg, canViewPayroll, useOrg } from "@/components/org-context";
import { supabase } from "@/lib/supabase";

export default function DictionariesHubPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <DictionariesInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

type DictionaryCard = {
  href: string;
  icon: string;
  title: string;
  description: string;
  count: number | null;
  countLabel: (n: number) => string;
  comingSoon?: boolean;
};

function DictionariesInner() {
  const { organizationId, role } = useOrg();
  const canUse = canManageOrg(role);
  const showPayroll = canViewPayroll(role);
  const [counts, setCounts] = useState<{
    templates: number;
    piecework: number;
    crews: number;
    materials: number;
    services: number;
    positions: number;
  } | null>(null);

  useEffect(() => {
    if (!organizationId || !canUse) return;
    let cancelled = false;
    void (async () => {
      const [templates, piecework, crews, materials, services, positions] = await Promise.all([
        supabase.from("estimate_templates").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
        showPayroll ? supabase.from("piecework_activities").select("id", { count: "exact", head: true }).eq("organization_id", organizationId) : Promise.resolve({ count: 0 }),
        supabase.from("crews").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
        supabase.from("catalog_items").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("category", "material"),
        supabase.from("catalog_items").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("category", "labor"),
        supabase.from("job_positions").select("id", { count: "exact", head: true }).eq("organization_id", organizationId)
      ]);
      if (cancelled) return;
      setCounts({
        templates: templates.count ?? 0,
        piecework: piecework.count ?? 0,
        crews: crews.count ?? 0,
        materials: materials.count ?? 0,
        services: services.count ?? 0,
        positions: positions.count ?? 0
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, canUse, showPayroll]);

  if (!organizationId) return null;
  if (!canUse) {
    return (
      <div className="rounded-xl2 border border-stone-200/80 bg-white p-6 shadow-card">
        <h1 className="text-xl font-bold text-ink">Słowniki</h1>
        <p className="mt-2 text-sm text-steel">Słowniki firmowe są dostępne tylko dla ról zarządczych.</p>
      </div>
    );
  }

  const cards: DictionaryCard[] = [
    {
      href: "/settings/estimate-templates",
      icon: "📋",
      title: "Warianty kosztorysów",
      description: "Gotowe zestawy pozycji (materiały + robocizna) do błyskawicznego wstawienia w wycenie nowego lub istniejącego zlecenia.",
      count: counts?.templates ?? null,
      countLabel: (n) => (n === 1 ? "1 szablon" : `${n} szablony/ów`)
    },
    ...(showPayroll ? [{
      href: "/settings/piecework-activities",
      icon: "🧱",
      title: "Czynności akordowe",
      description: "Słownik prac rozliczanych na sztuki/metry — stawka i jednostka do rozliczeń pracowników akordowych.",
      count: counts?.piecework ?? null,
      countLabel: (n) => (n === 1 ? "1 czynność" : `${n} czynności`)
    } satisfies DictionaryCard] : []),
    {
      href: "/settings/crews",
      icon: "👷",
      title: "Brygady",
      description: "Ekipy robocze wraz ze składem osobowym — wybór brygady na zleceniu przypisuje jej członków do realizacji.",
      count: counts?.crews ?? null,
      countLabel: (n) => (n === 1 ? "1 brygada" : `${n} brygad`)
    },
    {
      href: "/settings/catalog?category=material",
      icon: "🧰",
      title: "Materiały",
      description: "Pozycje materiałowe z sugerowaną stawką do szybkiego dodania w kosztorysie.",
      count: counts?.materials ?? null,
      countLabel: (n) => (n === 1 ? "1 pozycja" : `${n} pozycji`)
    },
    {
      href: "/settings/catalog?category=labor",
      icon: "🛠️",
      title: "Usługi / robocizna",
      description: "Pozycje robocizny z sugerowaną stawką do szybkiego dodania w kosztorysie.",
      count: counts?.services ?? null,
      countLabel: (n) => (n === 1 ? "1 pozycja" : `${n} pozycji`)
    },
    {
      href: "/settings/job-positions",
      icon: "🪪",
      title: "Stanowiska pracowników",
      description: "Nazwy stanowisk (kierownik, brygadzista, pomocnik...) używane w karcie pracownika i raportach.",
      count: counts?.positions ?? null,
      countLabel: (n) => (n === 1 ? "1 stanowisko" : `${n} stanowisk`)
    }
  ];

  return (
    <div className="grid max-w-5xl gap-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Ustawienia</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Słowniki</h1>
        <p className="mt-2 max-w-2xl text-sm text-steel">
          Jedno miejsce na wszystkie firmowe słowniki. Uzupełnij je raz, a potem korzystaj z nich przy zakładaniu zleceń, wycenach i rozliczeniach — bez ręcznego przepisywania.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex flex-col justify-between rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:border-moss/50 hover:shadow-lg sm:p-5"
          >
            <div>
              <span className="text-2xl">{card.icon}</span>
              <h2 className="mt-3 text-base font-bold text-ink group-hover:text-moss-dark">{card.title}</h2>
              <p className="mt-1.5 text-xs leading-5 text-steel">{card.description}</p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs font-semibold text-steel">{card.count == null ? "…" : card.countLabel(card.count)}</span>
              <span className="text-xs font-semibold text-moss-dark">Otwórz →</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
