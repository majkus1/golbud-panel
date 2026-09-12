"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { showToast } from "@/components/toast";
import { canManageOrg, useOrg } from "@/components/org-context";
import { formatDateTime } from "@/lib/format";
import { isLowStock } from "@/lib/ops-alerts";
import { supabase } from "@/lib/supabase";
import type { CaseRow, CatalogItem, OrgMemberProfile, Unit, WarehouseAuditLog, WarehouseItem, WarehouseMovement } from "@/lib/types";
import { UNITS } from "@/lib/types";

type MovementRow = WarehouseMovement & {
  warehouse_items?: { label: string; unit: string } | { label: string; unit: string }[] | null;
  cases?: { client_name: string } | { client_name: string }[] | null;
};

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => {
  const label = new Intl.DateTimeFormat("pl-PL", { month: "long" }).format(new Date(2024, i, 1));
  return { value: i + 1, label: label.charAt(0).toUpperCase() + label.slice(1) };
});

function currentPeriod() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function periodBounds(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function periodLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function yearOptions() {
  const current = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => current - i);
}

function authorEmail(members: OrgMemberProfile[], userId: string | null): string {
  if (!userId) return "nieznany użytkownik";
  return members.find((m) => m.user_id === userId)?.email || "nieznany użytkownik";
}

type ActivityEntry =
  | { kind: "movement"; at: string; movement: MovementRow }
  | { kind: "audit"; at: string; audit: WarehouseAuditLog };

export default function WarehousePage() {
  return (
    <AuthGate>
      {(session) => (
        <AppShell>
          <WarehouseInner userId={session.user.id} />
        </AppShell>
      )}
    </AuthGate>
  );
}

function WarehouseInner({ userId }: { userId: string }) {
  const { organizationId, role } = useOrg();
  const canManage = canManageOrg(role);
  const canOperate = canManage || role === "brygadzista" || role === "member";
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [auditLog, setAuditLog] = useState<WarehouseAuditLog[]>([]);
  const [members, setMembers] = useState<OrgMemberProfile[]>([]);
  const [cases, setCases] = useState<Pick<CaseRow, "id" | "client_name">[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState<Unit>("szt.");
  const [minQty, setMinQty] = useState("0");
  const [activeMove, setActiveMove] = useState<WarehouseItem | null>(null);
  const [moveType, setMoveType] = useState<"in" | "out">("in");
  const [moveQty, setMoveQty] = useState("1");
  const [moveNote, setMoveNote] = useState("");
  const [moveCaseId, setMoveCaseId] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [periodYear, setPeriodYear] = useState(() => currentPeriod().year);
  const [periodMonth, setPeriodMonth] = useState(() => currentPeriod().month);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(true);

  const periodRange = useMemo(() => periodBounds(periodYear, periodMonth), [periodYear, periodMonth]);
  const selectedPeriodLabel = useMemo(() => periodLabel(periodYear, periodMonth), [periodYear, periodMonth]);
  const isCurrentPeriod = useMemo(() => {
    const now = currentPeriod();
    return periodYear === now.year && periodMonth === now.month;
  }, [periodYear, periodMonth]);

  const loadItems = useCallback(async () => {
    if (!organizationId) return;
    setLoadingItems(true);
    setLoadError(null);
    const [itemsRes, casesRes, membersRes] = await Promise.all([
      supabase.from("warehouse_items").select("*").eq("organization_id", organizationId).order("sort_order").order("label"),
      supabase.from("cases").select("id, client_name").eq("organization_id", organizationId).order("client_name").limit(80),
      supabase.from("org_member_profiles").select("user_id, email, role").eq("organization_id", organizationId)
    ]);

    if (itemsRes.error) {
      const missing = itemsRes.error.message.includes("warehouse") || itemsRes.error.code === "42P01";
      setLoadError(missing ? "Uruchom migrację 0011_fleet_and_warehouse.sql w Supabase." : itemsRes.error.message);
      setItems([]);
    } else {
      setItems((itemsRes.data || []) as WarehouseItem[]);
    }
    setCases((casesRes.data || []) as Pick<CaseRow, "id" | "client_name">[]);
    setMembers((membersRes.data || []) as OrgMemberProfile[]);
    setLoadingItems(false);
  }, [organizationId]);

  const logAudit = useCallback(
    async (row: {
      action: WarehouseAuditLog["action"];
      label: string;
      warehouse_item_id?: string | null;
      details?: string | null;
    }) => {
      if (!organizationId) return;
      await supabase.from("warehouse_audit_log").insert({
        organization_id: organizationId,
        warehouse_item_id: row.warehouse_item_id ?? null,
        action: row.action,
        label: row.label,
        details: row.details ?? null,
        created_by: userId
      });
    },
    [organizationId, userId]
  );

  const loadMovements = useCallback(async () => {
    if (!organizationId) return;
    setLoadingMovements(true);
    const movRes = await supabase
      .from("warehouse_movements")
      .select("*, warehouse_items(label, unit), cases(client_name)")
      .eq("organization_id", organizationId)
      .gte("created_at", `${periodRange.start}T00:00:00`)
      .lte("created_at", `${periodRange.end}T23:59:59.999`)
      .order("created_at", { ascending: false })
      .limit(500);

    const auditRes = await supabase
      .from("warehouse_audit_log")
      .select("*")
      .eq("organization_id", organizationId)
      .gte("created_at", `${periodRange.start}T00:00:00`)
      .lte("created_at", `${periodRange.end}T23:59:59.999`)
      .order("created_at", { ascending: false })
      .limit(200);

    setMovements((movRes.data || []) as MovementRow[]);
    if (auditRes.error && (auditRes.error.code === "42P01" || auditRes.error.message.includes("warehouse_audit_log"))) {
      setAuditLog([]);
    } else {
      setAuditLog((auditRes.data || []) as WarehouseAuditLog[]);
    }
    setLoadingMovements(false);
  }, [organizationId, periodRange]);

  const load = useCallback(async () => {
    await Promise.all([loadItems(), loadMovements()]);
  }, [loadItems, loadMovements]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  const lowCount = useMemo(() => items.filter((i) => isLowStock(Number(i.quantity), Number(i.min_quantity))).length, [items]);

  const activityLog = useMemo((): ActivityEntry[] => {
    const rows: ActivityEntry[] = [
      ...movements.map((movement) => ({ kind: "movement" as const, at: movement.created_at, movement })),
      ...auditLog.map((audit) => ({ kind: "audit" as const, at: audit.created_at, audit }))
    ];
    rows.sort((a, b) => b.at.localeCompare(a.at));
    return rows;
  }, [movements, auditLog]);

  const usageOut = useMemo(() => {
    const map = new Map<string, { label: string; unit: string; total: number }>();
    for (const m of movements) {
      if (m.movement_type !== "out") continue;
      const wi = Array.isArray(m.warehouse_items) ? m.warehouse_items[0] : m.warehouse_items;
      const key = m.warehouse_item_id;
      const cur = map.get(key) || { label: wi?.label || "?", unit: wi?.unit || "", total: 0 };
      cur.total += Number(m.quantity);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [movements]);

  const usageByCase = useMemo(() => {
    const map = new Map<string, { name: string; items: Map<string, { label: string; unit: string; total: number }> }>();
    for (const m of movements) {
      if (m.movement_type !== "out") continue;
      const key = m.case_id || "__none__";
      const c = Array.isArray(m.cases) ? m.cases[0] : m.cases;
      const group = map.get(key) || { name: c?.client_name || "Bez powiązania ze zleceniem", items: new Map() };
      const wi = Array.isArray(m.warehouse_items) ? m.warehouse_items[0] : m.warehouse_items;
      const itemKey = m.warehouse_item_id;
      const cur = group.items.get(itemKey) || { label: wi?.label || "?", unit: wi?.unit || "", total: 0 };
      cur.total += Number(m.quantity);
      group.items.set(itemKey, cur);
      map.set(key, group);
    }
    return Array.from(map.values())
      .map((g) => ({ name: g.name, items: Array.from(g.items.values()).sort((a, b) => b.total - a.total) }))
      .sort((a, b) => (a.name === "Bez powiązania ze zleceniem" ? 1 : b.name === "Bez powiązania ze zleceniem" ? -1 : a.name.localeCompare(b.name)));
  }, [movements]);

  const addItem = async () => {
    if (!canManage || !organizationId || !label.trim()) return;
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order), 0);
    const { error } = await supabase.from("warehouse_items").insert({
      organization_id: organizationId,
      label: label.trim(),
      unit,
      min_quantity: Number(minQty) || 0,
      sort_order: maxSort + 10
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    await logAudit({
      action: "item_created",
      label: label.trim(),
      details: `Jednostka: ${unit}, stan min.: ${Number(minQty) || 0}`
    });
    setLabel("");
    setMinQty("0");
    setFormOpen(false);
    showToast("Dodano pozycję");
    await load();
  };

  const importCatalog = async () => {
    if (!canManage || !organizationId) return;
    setImportBusy(true);
    const [{ data: catalog }, { data: existing }] = await Promise.all([
      supabase.from("catalog_items").select("*").eq("organization_id", organizationId).eq("category", "material"),
      supabase.from("warehouse_items").select("catalog_item_id").eq("organization_id", organizationId)
    ]);
    const linked = new Set((existing || []).map((e) => e.catalog_item_id).filter(Boolean));
    const toAdd = ((catalog || []) as CatalogItem[]).filter((c) => !linked.has(c.id));
    if (toAdd.length === 0) {
      showToast("Wszystkie materiały z katalogu są już na magazynie");
      setImportBusy(false);
      return;
    }
    let sort = items.reduce((m, i) => Math.max(m, i.sort_order), 0);
    for (const c of toAdd) {
      sort += 10;
      await supabase.from("warehouse_items").insert({
        organization_id: organizationId,
        catalog_item_id: c.id,
        label: c.label,
        unit: c.default_unit,
        quantity: 0,
        min_quantity: 0,
        sort_order: sort
      });
    }
    setImportBusy(false);
    await logAudit({
      action: "items_imported",
      label: `${toAdd.length} pozycji z katalogu`,
      details: toAdd.map((c) => c.label).join(", ")
    });
    showToast(`Dodano ${toAdd.length} pozycji z katalogu`);
    await load();
  };

  const saveMin = async (item: WarehouseItem, raw: string) => {
    if (!canManage) return;
    const min_quantity = Number(raw) || 0;
    if (min_quantity === Number(item.min_quantity)) return;
    const { error } = await supabase.from("warehouse_items").update({ min_quantity }).eq("id", item.id);
    if (error) showToast("Nie udało się zapisać", "error");
    else {
      await logAudit({
        action: "min_quantity_changed",
        label: item.label,
        warehouse_item_id: item.id,
        details: `Stan min.: ${item.min_quantity} → ${min_quantity} ${item.unit}`
      });
      showToast("Zapisano");
      await load();
    }
  };

  const submitMovement = async () => {
    if (!canOperate || !organizationId || !activeMove) return;
    const q = Number(moveQty);
    if (!Number.isFinite(q) || q <= 0) {
      showToast("Podaj poprawną ilość", "error");
      return;
    }
    if (moveType === "out" && q > Number(activeMove.quantity)) {
      showToast("Za mało na stanie", "error");
      return;
    }
    const { error } = await supabase.from("warehouse_movements").insert({
      organization_id: organizationId,
      warehouse_item_id: activeMove.id,
      movement_type: moveType,
      quantity: q,
      note: moveNote.trim() || null,
      case_id: moveType === "out" && moveCaseId ? moveCaseId : null,
      created_by: userId
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast(moveType === "in" ? "Przyjęto na magazyn" : "Wydano z magazynu");
    setActiveMove(null);
    setMoveQty("1");
    setMoveNote("");
    setMoveCaseId("");
    await load();
  };

  if (!organizationId) return null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Magazyn</h1>
        <p className="mt-2 text-sm text-steel">
          Stan materiałów na bazie. Przyjęcia i zużycie — opcjonalnie powiązanie ze sprawą. Niski stan trafia do porannego maila.
        </p>
        {lowCount > 0 ? <p className="mt-2 text-sm font-medium text-amber-800">{lowCount} pozycji poniżej minimum.</p> : null}
      </div>

      {loadError ? <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">{loadError}</section> : null}

      {canManage && (!formOpen ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            aria-expanded={false}
            className="flex items-center justify-center gap-2 rounded-xl2 border border-dashed border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-ink shadow-card transition hover:border-moss/60 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <span className="text-lg leading-none">+</span> Nowa pozycja
          </button>
          <button
            type="button"
            disabled={importBusy}
            onClick={() => void importCatalog()}
            className="rounded-xl2 border border-stone-200/80 bg-white px-4 py-3 text-sm font-semibold text-moss shadow-card transition hover:bg-stone-50 disabled:opacity-50"
          >
            {importBusy ? "Import…" : "Importuj materiały z katalogu"}
          </button>
        </div>
      ) : (
        <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-ink">Nowa pozycja</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={importBusy}
                onClick={() => void importCatalog()}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-moss hover:bg-moss/10 disabled:opacity-50"
              >
                {importBusy ? "Import…" : "Importuj z katalogu"}
              </button>
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-steel hover:bg-stone-100 hover:text-ink">
                Zwiń
              </button>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Nazwa materiału <span className="text-rose-500" aria-hidden>*</span>
              <input className="input text-sm font-normal" placeholder="np. Klej do płytek" value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Jednostka
              <select className="input text-sm font-normal sm:w-24" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Stan min.
              <input className="input text-sm font-normal sm:w-24" type="number" min={0} placeholder="0" value={minQty} onChange={(e) => setMinQty(e.target.value)} title="Stan minimalny — alert" />
            </label>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => void addItem()} disabled={!label.trim()} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
              Dodaj pozycję
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50">
              Anuluj
            </button>
          </div>
        </section>
      ))}

      {activeMove ? (
        <section className="rounded-lg border-2 border-moss bg-white p-5 shadow-panel">
          <h2 className="text-lg font-bold text-ink">
            {moveType === "in" ? "Przyjęcie" : "Zużycie"}: {activeMove.label}
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input type="number" min={0.01} step="any" className="input" value={moveQty} onChange={(e) => setMoveQty(e.target.value)} />
            <select className="input" value={moveType} onChange={(e) => setMoveType(e.target.value as "in" | "out")}>
              <option value="in">+ Przyjęcie</option>
              <option value="out">− Zużycie</option>
            </select>
          </div>
          {moveType === "out" ? (
            <select className="input mt-2 w-full" value={moveCaseId} onChange={(e) => setMoveCaseId(e.target.value)}>
              <option value="">Bez powiązania ze sprawą</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.client_name}
                </option>
              ))}
            </select>
          ) : null}
          <input className="input mt-2 w-full" placeholder="Notatka (opcjonalnie)" value={moveNote} onChange={(e) => setMoveNote(e.target.value)} />
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void submitMovement()} className="rounded-md bg-moss px-4 py-2 text-sm font-semibold text-white">
              Zapisz ruch
            </button>
            <button type="button" onClick={() => setActiveMove(null)} className="rounded-md border border-stone-300 px-4 py-2 text-sm">
              Anuluj
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg bg-white p-5 shadow-panel">
        <h2 className="text-lg font-bold text-ink">Stan na magazynie</h2>
        {loadingItems ? (
          <p className="mt-3 text-sm text-steel">Wczytywanie…</p>
        ) : items.length === 0 ? (
          <p className="mt-3 text-sm text-steel">Brak pozycji — dodaj ręcznie lub zaimportuj z katalogu.</p>
        ) : (
          <ul className="mt-3 grid gap-2.5 text-sm">
            {items.map((item) => {
              const low = isLowStock(Number(item.quantity), Number(item.min_quantity));
              return (
                <li
                  key={item.id}
                  className={`relative grid gap-3 overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card sm:flex sm:flex-wrap sm:items-center sm:justify-between ${
                    low ? "border-amber-200 bg-amber-50/50" : "border-stone-200 bg-white"
                  }`}
                >
                  <span className={`absolute inset-y-0 left-0 w-1.5 ${low ? "bg-amber-400" : "bg-stone-200"}`} aria-hidden />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`font-semibold ${low ? "text-amber-900" : "text-ink"}`}>{item.label}</p>
                      {low && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-amber-700">
                          Niski stan
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-steel">
                      Stan: <strong className="text-ink">{Number(item.quantity)}</strong> {item.unit}
                      {item.location ? ` · ${item.location}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canManage ? (
                      <label className="flex items-center gap-1 text-xs text-steel">
                        Min.
                        <input
                          key={`min-${item.id}-${item.min_quantity}`}
                          type="number"
                          min={0}
                          className="input w-16 py-1 text-xs"
                          defaultValue={item.min_quantity}
                          onBlur={(e) => void saveMin(item, e.target.value)}
                        />
                      </label>
                    ) : (
                      <span className="text-xs text-steel">Min. {Number(item.min_quantity)} {item.unit}</span>
                    )}
                    <button
                      type="button"
                      className="flex-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 sm:flex-none"
                      onClick={() => {
                        setActiveMove(item);
                        setMoveType("in");
                      }}
                    >
                      + Przyjęcie
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-lg bg-stone-100 px-3 py-2 text-xs font-semibold text-ink hover:bg-stone-200 sm:flex-none"
                      onClick={() => {
                        setActiveMove(item);
                        setMoveType("out");
                      }}
                    >
                      − Zużycie
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="min-w-0 max-w-full rounded-lg bg-white p-4 shadow-panel sm:p-5">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink">Zużycie — {selectedPeriodLabel}</h2>
            <p className="mt-0.5 text-xs text-steel">Podsumowanie przyjęć i wydań w wybranym miesiącu.</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-steel">
              Miesiąc
              <select
                className="input min-w-0 py-1.5 text-sm font-normal"
                value={periodMonth}
                onChange={(e) => setPeriodMonth(Number(e.target.value))}
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-steel">
              Rok
              <select
                className="input min-w-0 py-1.5 text-sm font-normal"
                value={periodYear}
                onChange={(e) => setPeriodYear(Number(e.target.value))}
              >
                {yearOptions().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            {!isCurrentPeriod ? (
              <button
                type="button"
                onClick={() => {
                  const now = currentPeriod();
                  setPeriodYear(now.year);
                  setPeriodMonth(now.month);
                }}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50"
              >
                Bieżący miesiąc
              </button>
            ) : null}
          </div>
        </div>

        {loadingMovements ? (
          <p className="mt-3 text-sm text-steel">Wczytywanie ruchów…</p>
        ) : (
          <>
        {usageOut.length === 0 ? (
          <p className="mt-3 text-sm text-steel">Brak wydań w wybranym okresie.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {usageOut.map((u) => (
              <li key={u.label} className="flex justify-between gap-3 py-2">
                <span className="min-w-0">{u.label}</span>
                <span className="shrink-0 font-medium">
                  {u.total} {u.unit}
                </span>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-5 text-sm font-bold text-ink">Zużycie wg zlecenia</h3>
        {usageByCase.length === 0 ? (
          <p className="mt-1 text-sm text-steel">Brak wydań powiązanych ze zleceniami w wybranym okresie.</p>
        ) : (
          <div className="mt-2 grid gap-3">
            {usageByCase.map((g) => (
              <div key={g.name} className="rounded-lg border border-stone-200 bg-stone-50/60 p-3">
                <p className="text-sm font-semibold text-ink">{g.name}</p>
                <ul className="mt-1 divide-y divide-stone-100 text-sm">
                  {g.items.map((u) => (
                    <li key={u.label} className="flex justify-between gap-3 py-1.5">
                      <span className="min-w-0 text-steel">{u.label}</span>
                      <span className="shrink-0 font-medium text-ink">
                        {u.total} {u.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <p className="mt-4 text-xs font-semibold text-steel">Dziennik zmian ({selectedPeriodLabel})</p>
        <p className="mt-0.5 text-[0.7rem] text-stone-400">Każdy ruch i zmiana pozycji — z datą, godziną i autorem.</p>
        {activityLog.length === 0 ? (
          <p className="mt-2 text-sm text-steel">Brak wpisów w wybranym okresie.</p>
        ) : (
        <ul className="mt-2 max-h-80 divide-y divide-stone-100 overflow-y-auto">
          {activityLog.map((entry) => {
            if (entry.kind === "audit") {
              const a = entry.audit;
              const actionLabel =
                a.action === "item_created"
                  ? "Nowa pozycja"
                  : a.action === "items_imported"
                    ? "Import z katalogu"
                    : "Zmiana stanu min.";
              return (
                <li key={`audit-${a.id}`} className="grid gap-1 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="font-semibold text-ink">{actionLabel}: {a.label}</span>
                    <time className="shrink-0 text-xs text-steel" dateTime={a.created_at}>
                      {formatDateTime(a.created_at)}
                    </time>
                  </div>
                  <p className="text-xs text-steel">
                    <span className="font-medium text-ink">{authorEmail(members, a.created_by)}</span>
                    {a.details ? ` · ${a.details}` : ""}
                  </p>
                </li>
              );
            }

            const m = entry.movement;
            const wi = Array.isArray(m.warehouse_items) ? m.warehouse_items[0] : m.warehouse_items;
            const c = Array.isArray(m.cases) ? m.cases[0] : m.cases;
            const isIn = m.movement_type === "in";
            return (
              <li key={`mov-${m.id}`} className="grid gap-1 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className={`font-semibold ${isIn ? "text-emerald-800" : "text-ink"}`}>
                    {isIn ? "Przyjęcie" : "Zużycie"} · {wi?.label || "?"}
                  </span>
                  <time className="shrink-0 text-xs text-steel" dateTime={m.created_at}>
                    {formatDateTime(m.created_at)}
                  </time>
                </div>
                <p className="text-xs text-steel">
                  <span className={`font-bold ${isIn ? "text-emerald-700" : "text-rose-700"}`}>
                    {isIn ? "+" : "−"}
                    {Number(m.quantity)} {wi?.unit}
                  </span>
                  {" · "}
                  <span className="font-medium text-ink">{authorEmail(members, m.created_by)}</span>
                  {c ? ` · zlecenie: ${c.client_name}` : ""}
                  {m.note ? ` · notatka: ${m.note}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
        )}
          </>
        )}
      </section>
    </div>
  );
}
