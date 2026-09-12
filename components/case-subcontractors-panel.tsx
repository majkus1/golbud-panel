"use client";

import { DateInput } from "@/components/date-input";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOrg } from "@/components/org-context";
import { SUBCONTRACTOR_STATUSES, UNITS } from "@/lib/domain";
import { formatDate, formatMoney } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { CaseSubcontractor, Subcontractor, SubcontractorStatus, Unit } from "@/lib/types";

type Props = { caseId: string };

export function CaseSubcontractorsPanel({ caseId }: Props) {
  const { organizationId } = useOrg();
  const [rows, setRows] = useState<CaseSubcontractor[]>([]);
  const [subs, setSubs] = useState<Subcontractor[]>([]);
  const [pickerId, setPickerId] = useState("");

  const load = useCallback(async () => {
    if (!organizationId) return;
    const [{ data: cs }, { data: s }] = await Promise.all([
      supabase.from("case_subcontractors").select("*").eq("case_id", caseId).order("created_at"),
      supabase.from("subcontractors").select("*").eq("organization_id", organizationId).eq("archived", false).order("name")
    ]);
    setRows((cs || []) as CaseSubcontractor[]);
    setSubs((s || []) as Subcontractor[]);
  }, [caseId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const subById = useMemo(() => new Map(subs.map((s) => [s.id, s])), [subs]);

  const assign = async () => {
    if (!organizationId || !pickerId) return;
    const sub = subById.get(pickerId);
    if (!sub) return;
    const { error } = await supabase.from("case_subcontractors").insert({
      organization_id: organizationId,
      case_id: caseId,
      subcontractor_id: pickerId,
      scope: sub.trade || "",
      rate: sub.default_rate,
      unit: "usługa" as Unit,
      status: "planowane" as SubcontractorStatus
    });
    if (error) {
      window.alert("Nie udało się przypisać: " + error.message);
      return;
    }
    setPickerId("");
    await load();
  };

  const update = async (row: CaseSubcontractor, patch: Partial<CaseSubcontractor>) => {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("case_subcontractors").update(patch).eq("id", row.id);
    if (error) {
      window.alert("Nie zapisano: " + error.message);
      await load();
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć przypisanie podwykonawcy?")) return;
    await supabase.from("case_subcontractors").delete().eq("id", id);
    await load();
  };

  const total = rows.reduce((sum, r) => sum + Number(r.agreed_total || 0), 0);

  return (
    <section className="grid gap-4 rounded-lg bg-white p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Podwykonawcy / ekipy zewnętrzne</h2>
          <p className="text-xs text-steel">
            Baza dostępna w{" "}
            <Link href="/settings/subcontractors" className="font-semibold text-moss hover:underline">
              Ustawieniach → Podwykonawcy
            </Link>
            .
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="text-xs text-steel">Zakontraktowane łącznie</p>
          <p className="font-bold text-ink">{total > 0 ? formatMoney(total) : "—"}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-xs" value={pickerId} onChange={(e) => setPickerId(e.target.value)}>
          <option value="">— wybierz podwykonawcę —</option>
          {subs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.trade ? `· ${s.trade}` : ""}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void assign()} disabled={!pickerId} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
          Przypisz do sprawy
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-stone-300 p-4 text-sm text-steel">Brak podwykonawców przypisanych do sprawy.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs uppercase text-steel">
              <tr>
                <th className="py-2 pr-3">Podwykonawca</th>
                <th className="py-2 pr-3">Zakres</th>
                <th className="py-2 pr-3">Stawka</th>
                <th className="py-2 pr-3">Jedn.</th>
                <th className="py-2 pr-3">Kwota umowna</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Termin</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => {
                const sub = subById.get(r.subcontractor_id);
                return (
                  <tr key={r.id}>
                    <td className="py-2 pr-3">
                      <p className="font-semibold text-ink">{sub?.name || "(usunięty)"}</p>
                      <p className="text-xs text-steel">{sub?.phone || sub?.email || ""}</p>
                    </td>
                    <td className="py-2 pr-3">
                      <input className="input py-1" value={r.scope} onChange={(e) => void update(r, { scope: e.target.value })} />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className="input w-24 py-1"
                        inputMode="decimal"
                        value={r.rate ?? ""}
                        onChange={(e) => void update(r, { rate: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select className="input py-1" value={r.unit ?? ""} onChange={(e) => void update(r, { unit: (e.target.value || null) as Unit | null })}>
                        <option value="">—</option>
                        {UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className="input w-28 py-1"
                        inputMode="decimal"
                        value={r.agreed_total ?? ""}
                        onChange={(e) => void update(r, { agreed_total: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select className="input py-1" value={r.status} onChange={(e) => void update(r, { status: e.target.value as SubcontractorStatus })}>
                        {SUBCONTRACTOR_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-col gap-1 text-xs">
                        <DateInput className="py-1" value={r.start_date ?? ""} onChange={(e) => void update(r, { start_date: e.target.value || null })} />
                        <DateInput className="py-1" value={r.end_date ?? ""} onChange={(e) => void update(r, { end_date: e.target.value || null })} />
                        {r.start_date && <span className="text-steel">od {formatDate(r.start_date)}</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <button type="button" onClick={() => void remove(r.id)} className="text-xs text-rose-600 hover:underline">
                        usuń
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
