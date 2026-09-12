"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { showToast } from "@/components/toast";
import { canManageOrg, useOrg } from "@/components/org-context";
import { formatDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { warsawTodayIso } from "@/lib/warsaw-today";
import { EQUIPMENT_CATEGORIES } from "@/lib/types";
import type { CaseRow, Equipment, EquipmentAssignment, EquipmentCategory } from "@/lib/types";

const CATEGORY_TONE: Record<EquipmentCategory, string> = {
  rusztowanie: "bg-sky-100 text-sky-700",
  maszyna: "bg-amber-100 text-amber-800",
  "narzędzie": "bg-emerald-100 text-emerald-700",
  sprzęt: "bg-stone-100 text-stone-600",
  inne: "bg-stone-100 text-stone-500"
};

type AssignmentRow = EquipmentAssignment & {
  cases?: { client_name: string; location: string | null } | { client_name: string; location: string | null }[] | null;
};

export default function EquipmentPage() {
  return (
    <AuthGate>
      {(session) => (
        <AppShell>
          <EquipmentInner userId={session.user.id} />
        </AppShell>
      )}
    </AuthGate>
  );
}

function EquipmentInner({ userId }: { userId: string }) {
  const { organizationId, role } = useOrg();
  const canManage = canManageOrg(role);
  const canOperate = canManage || role === "brygadzista" || role === "member";
  const todayIso = warsawTodayIso();

  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [cases, setCases] = useState<Pick<CaseRow, "id" | "client_name">[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<EquipmentCategory>("rusztowanie");
  const [unit, setUnit] = useState("szt.");
  const [totalQty, setTotalQty] = useState("0");

  const [activeAssign, setActiveAssign] = useState<Equipment | null>(null);
  const [assignQty, setAssignQty] = useState("1");
  const [assignCaseId, setAssignCaseId] = useState("");
  const [assignSiteLabel, setAssignSiteLabel] = useState("");
  const [assignNote, setAssignNote] = useState("");

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setLoadError(null);
    const [eqRes, asRes, casesRes] = await Promise.all([
      supabase.from("equipment").select("*").eq("organization_id", organizationId).order("sort_order").order("name"),
      supabase
        .from("equipment_assignments")
        .select("*, cases(client_name, location)")
        .eq("organization_id", organizationId)
        .eq("returned", false)
        .order("assigned_date", { ascending: false }),
      supabase.from("cases").select("id, client_name").eq("organization_id", organizationId).order("client_name").limit(120)
    ]);

    if (eqRes.error) {
      const missing = eqRes.error.message.includes("equipment") || eqRes.error.code === "42P01";
      setLoadError(missing ? "Uruchom migrację 0015_equipment.sql w Supabase (SQL Editor)." : eqRes.error.message);
      setEquipment([]);
    } else {
      setEquipment((eqRes.data || []) as Equipment[]);
    }
    setAssignments((asRes.data || []) as AssignmentRow[]);
    setCases((casesRes.data || []) as Pick<CaseRow, "id" | "client_name">[]);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSiteByEquipment = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assignments) {
      map.set(a.equipment_id, (map.get(a.equipment_id) || 0) + Number(a.quantity));
    }
    return map;
  }, [assignments]);

  const assignmentsByEquipment = useMemo(() => {
    const map = new Map<string, AssignmentRow[]>();
    for (const a of assignments) {
      const arr = map.get(a.equipment_id) || [];
      arr.push(a);
      map.set(a.equipment_id, arr);
    }
    return map;
  }, [assignments]);

  const addEquipment = async () => {
    if (!canManage || !organizationId || !name.trim()) return;
    const maxSort = equipment.reduce((m, e) => Math.max(m, e.sort_order), 0);
    const { error } = await supabase.from("equipment").insert({
      organization_id: organizationId,
      name: name.trim(),
      category,
      unit: unit.trim() || "szt.",
      total_quantity: Number(totalQty) || 0,
      sort_order: maxSort + 10
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setName("");
    setCategory("rusztowanie");
    setUnit("szt.");
    setTotalQty("0");
    setFormOpen(false);
    showToast("Dodano sprzęt");
    await load();
  };

  const saveTotal = async (item: Equipment, raw: string) => {
    if (!canManage) return;
    const total_quantity = Number(raw);
    if (!Number.isFinite(total_quantity) || total_quantity < 0 || total_quantity === Number(item.total_quantity)) return;
    const { error } = await supabase.from("equipment").update({ total_quantity }).eq("id", item.id);
    if (error) showToast("Nie udało się zapisać", "error");
    else {
      showToast("Zapisano");
      await load();
    }
  };

  const removeEquipment = async (id: string) => {
    if (!canManage) return;
    if (!confirm("Usunąć sprzęt wraz z historią przypisań?")) return;
    const { error } = await supabase.from("equipment").delete().eq("id", id);
    if (error) showToast(error.message, "error");
    else await load();
  };

  const submitAssignment = async () => {
    if (!canOperate || !organizationId || !activeAssign) return;
    const q = Number(assignQty);
    if (!Number.isFinite(q) || q <= 0) {
      showToast("Podaj poprawną ilość", "error");
      return;
    }
    const available = Number(activeAssign.total_quantity) - (onSiteByEquipment.get(activeAssign.id) || 0);
    if (q > available) {
      showToast(`Dostępne tylko ${available} ${activeAssign.unit}`, "error");
      return;
    }
    if (!assignCaseId && !assignSiteLabel.trim()) {
      showToast("Wybierz budowę lub wpisz miejsce", "error");
      return;
    }
    const { error } = await supabase.from("equipment_assignments").insert({
      organization_id: organizationId,
      equipment_id: activeAssign.id,
      case_id: assignCaseId || null,
      site_label: assignCaseId ? null : assignSiteLabel.trim() || null,
      quantity: q,
      assigned_date: todayIso,
      note: assignNote.trim() || null,
      created_by: userId
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Wydano na budowę");
    setActiveAssign(null);
    setAssignQty("1");
    setAssignCaseId("");
    setAssignSiteLabel("");
    setAssignNote("");
    await load();
  };

  const returnAssignment = async (a: AssignmentRow) => {
    if (!canOperate) return;
    const { error } = await supabase
      .from("equipment_assignments")
      .update({ returned: true, returned_date: todayIso })
      .eq("id", a.id);
    if (error) showToast(error.message, "error");
    else {
      showToast("Zwrócono na bazę");
      await load();
    }
  };

  const siteOf = (a: AssignmentRow): string => {
    const c = Array.isArray(a.cases) ? a.cases[0] : a.cases;
    if (c) return `${c.client_name}${c.location ? ` — ${c.location}` : ""}`;
    return a.site_label || "Bez przypisania";
  };

  if (!organizationId) return null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Sprzęt i rusztowania</h1>
        <p className="mt-2 text-sm text-steel">
          Baza sprzętu i rusztowań ze śledzeniem, ile sztuk znajduje się na której budowie. Wydaj na budowę i zwróć na bazę jednym kliknięciem.
        </p>
      </div>

      {loadError ? <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">{loadError}</section> : null}

      {canManage && (!formOpen ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          aria-expanded={false}
          className="flex w-full items-center justify-center gap-2 rounded-xl2 border border-dashed border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-ink shadow-card transition hover:border-moss/60 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-auto"
        >
          <span className="text-lg leading-none">+</span> Nowy sprzęt
        </button>
      ) : (
        <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-ink">Nowy sprzęt / rusztowanie</h2>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-steel hover:bg-stone-100 hover:text-ink">
              Zwiń
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-xs font-semibold text-ink lg:col-span-2">
              Nazwa <span className="text-rose-500" aria-hidden>*</span>
              <input className="input text-sm font-normal" placeholder="np. Rusztowanie ramowe Plettac" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Kategoria
              <select className="input text-sm font-normal" value={category} onChange={(e) => setCategory(e.target.value as EquipmentCategory)}>
                {EQUIPMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Jednostka
                <input className="input text-sm font-normal" placeholder="szt. / m² / mb" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Ilość łączna
                <input type="number" min={0} className="input text-sm font-normal" value={totalQty} onChange={(e) => setTotalQty(e.target.value)} />
              </label>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => void addEquipment()} disabled={!name.trim()} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
              Dodaj sprzęt
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50">
              Anuluj
            </button>
          </div>
        </section>
      ))}

      {activeAssign ? (
        <section className="rounded-lg border-2 border-moss bg-white p-5 shadow-panel">
          <h2 className="text-lg font-bold text-ink">Wydaj na budowę: {activeAssign.name}</h2>
          <p className="mt-1 text-sm text-steel">
            Dostępne na bazie: <strong className="text-ink">{Number(activeAssign.total_quantity) - (onSiteByEquipment.get(activeAssign.id) || 0)}</strong> {activeAssign.unit}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Ilość ({activeAssign.unit})
              <input type="number" min={0.01} step="any" className="input font-normal" value={assignQty} onChange={(e) => setAssignQty(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Budowa (zlecenie)
              <select className="input font-normal" value={assignCaseId} onChange={(e) => setAssignCaseId(e.target.value)}>
                <option value="">— wpiszę miejsce ręcznie —</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
            </label>
          </div>
          {!assignCaseId && (
            <input className="input mt-2 w-full font-normal" placeholder="Miejsce / opis budowy (gdy brak zlecenia na liście)" value={assignSiteLabel} onChange={(e) => setAssignSiteLabel(e.target.value)} />
          )}
          <input className="input mt-2 w-full font-normal" placeholder="Notatka (opcjonalnie)" value={assignNote} onChange={(e) => setAssignNote(e.target.value)} />
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void submitAssignment()} className="rounded-md bg-moss px-4 py-2 text-sm font-semibold text-white">
              Wydaj
            </button>
            <button type="button" onClick={() => setActiveAssign(null)} className="rounded-md border border-stone-300 px-4 py-2 text-sm">
              Anuluj
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg bg-white p-5 shadow-panel">
        <h2 className="text-lg font-bold text-ink">Sprzęt na bazie</h2>
        {loading ? (
          <p className="mt-3 text-sm text-steel">Wczytywanie…</p>
        ) : equipment.length === 0 ? (
          <p className="mt-3 text-sm text-steel">Brak sprzętu — dodaj pierwszą pozycję.</p>
        ) : (
          <ul className="mt-3 grid gap-2.5 text-sm">
            {equipment.map((item) => {
              const onSite = onSiteByEquipment.get(item.id) || 0;
              const available = Number(item.total_quantity) - onSite;
              const itemAssignments = assignmentsByEquipment.get(item.id) || [];
              return (
                <li key={item.id} className="relative rounded-xl2 border border-stone-200 bg-white p-3.5 pl-4 shadow-card">
                  <span className="absolute inset-y-0 left-0 w-1.5 rounded-l-xl2 bg-stone-200" aria-hidden />
                  <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{item.name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide ${CATEGORY_TONE[item.category]}`}>
                          {item.category}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-steel">
                        Na bazie: <strong className={available > 0 ? "text-emerald-700" : "text-steel"}>{available}</strong> · na budowach: <strong className={onSite > 0 ? "text-amber-700" : "text-steel"}>{onSite}</strong> · łącznie: {Number(item.total_quantity)} {item.unit}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canManage ? (
                        <label className="flex items-center gap-1 text-xs text-steel">
                          Łącznie
                          <input
                            key={`tot-${item.id}-${item.total_quantity}`}
                            type="number"
                            min={0}
                            className="input w-20 py-1 text-xs"
                            defaultValue={item.total_quantity}
                            onBlur={(e) => void saveTotal(item, e.target.value)}
                          />
                        </label>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setActiveAssign(item);
                          setAssignQty("1");
                        }}
                        className="rounded-lg bg-moss/10 px-3 py-2 text-xs font-semibold text-moss-dark hover:bg-moss/20"
                      >
                        Wydaj na budowę
                      </button>
                      {canManage ? (
                        <button type="button" onClick={() => void removeEquipment(item.id)} className="rounded-lg px-2 py-1 text-xs font-medium text-rose-500 hover:bg-rose-50">
                          Usuń
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {itemAssignments.length > 0 && (
                    <ul className="mt-3 grid gap-1.5 border-t border-stone-100 pt-3 text-xs">
                      {itemAssignments.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50/60 px-3 py-1.5">
                          <span className="text-ink">
                            <strong>{Number(a.quantity)} {item.unit}</strong> → {siteOf(a)}
                            <span className="text-steel"> · od {formatDate(a.assigned_date)}</span>
                            {a.note ? <span className="text-steel"> · {a.note}</span> : null}
                          </span>
                          <button type="button" onClick={() => void returnAssignment(a)} className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-800 hover:bg-amber-50">
                            Zwróć
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
