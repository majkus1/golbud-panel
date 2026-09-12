"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { showToast } from "@/components/toast";
import { canManageOrg, useOrg } from "@/components/org-context";
import { formatMoney } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { CatalogItem, EstimateTemplate, EstimateTemplateLine, Unit } from "@/lib/types";
import { UNITS } from "@/lib/types";

export default function EstimateTemplatesSettingsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <EstimateTemplatesInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function EstimateTemplatesInner() {
  const { organizationId, role, userId } = useOrg();
  const canUse = canManageOrg(role) || role === "sales";
  const [templates, setTemplates] = useState<EstimateTemplate[]>([]);
  const [linesByTemplate, setLinesByTemplate] = useState<Record<string, EstimateTemplateLine[]>>({});
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const [{ data: t }, { data: cat }] = await Promise.all([
      supabase.from("estimate_templates").select("*").eq("organization_id", organizationId).order("sort_order").order("name"),
      supabase.from("catalog_items").select("*").eq("organization_id", organizationId).order("sort_order")
    ]);
    const list = (t || []) as EstimateTemplate[];
    setTemplates(list);
    setCatalog((cat || []) as CatalogItem[]);
    const map: Record<string, EstimateTemplateLine[]> = {};
    for (const tpl of list) {
      const { data: ln } = await supabase.from("estimate_template_lines").select("*").eq("template_id", tpl.id).order("sort_order");
      map[tpl.id] = (ln || []) as EstimateTemplateLine[];
    }
    setLinesByTemplate(map);
    setSelectedId((prev) => (prev && list.some((x) => x.id === prev) ? prev : list[0]?.id ?? null));
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedTemplate = templates.find((t) => t.id === selectedId) || null;
  const selectedLines = selectedId ? linesByTemplate[selectedId] || [] : [];
  const laborSum = useMemo(() => selectedLines.filter((l) => l.section === "labor").reduce((s, l) => s + Number(l.line_total), 0), [selectedLines]);
  const matSum = useMemo(() => selectedLines.filter((l) => l.section === "material").reduce((s, l) => s + Number(l.line_total), 0), [selectedLines]);

  const addTemplate = async () => {
    if (!organizationId || !newName.trim()) return;
    const maxSort = templates.reduce((m, t) => Math.max(m, t.sort_order), -1);
    const { data, error } = await supabase
      .from("estimate_templates")
      .insert({ organization_id: organizationId, name: newName.trim(), sort_order: maxSort + 10, created_by: userId })
      .select("id")
      .single();
    if (error || !data) {
      showToast("Nie udało się utworzyć szablonu", "error");
      return;
    }
    setNewName("");
    setSelectedId(data.id);
    showToast("Utworzono szablon");
    await load();
  };

  const renameTemplate = async (id: string, name: string) => {
    if (!name.trim()) return;
    const { error } = await supabase.from("estimate_templates").update({ name: name.trim() }).eq("id", id);
    if (error) { showToast("Nie udało się zapisać nazwy", "error"); return; }
    await load();
  };

  const updateDescription = async (id: string, description: string) => {
    await supabase.from("estimate_templates").update({ description: description.trim() || null }).eq("id", id);
  };

  const removeTemplate = async (id: string) => {
    if (!confirm("Usunąć ten szablon wraz ze wszystkimi jego pozycjami?")) return;
    const { error } = await supabase.from("estimate_templates").delete().eq("id", id);
    if (error) { showToast("Nie udało się usunąć szablonu", "error"); return; }
    showToast("Usunięto szablon");
    if (selectedId === id) setSelectedId(null);
    await load();
  };

  const addLine = async (section: "labor" | "material") => {
    if (!selectedId) return;
    const maxSort = selectedLines.reduce((m, l) => Math.max(m, l.sort_order), -1);
    await supabase.from("estimate_template_lines").insert({
      organization_id: organizationId,
      template_id: selectedId,
      section,
      label: section === "labor" ? "Robocizna — pozycja" : "Materiał — pozycja",
      unit: "m²" as Unit,
      quantity: 1,
      unit_rate: 0,
      sort_order: maxSort + 10
    });
    await load();
  };

  const addLineFromCatalog = async (item: CatalogItem) => {
    if (!selectedId) return;
    const maxSort = selectedLines.reduce((m, l) => Math.max(m, l.sort_order), -1);
    await supabase.from("estimate_template_lines").insert({
      organization_id: organizationId,
      template_id: selectedId,
      section: item.category === "labor" ? "labor" : "material",
      label: item.label,
      unit: item.default_unit,
      quantity: 1,
      unit_rate: item.suggested_rate ?? 0,
      sort_order: maxSort + 10
    });
    await load();
  };

  const updateLine = async (line: EstimateTemplateLine, patch: Partial<Pick<EstimateTemplateLine, "label" | "unit" | "quantity" | "unit_rate" | "section">>) => {
    const { error } = await supabase.from("estimate_template_lines").update(patch).eq("id", line.id);
    if (error) { showToast("Nie udało się zapisać pozycji", "error"); return; }
    await load();
  };

  const deleteLine = async (id: string) => {
    const { error } = await supabase.from("estimate_template_lines").delete().eq("id", id);
    if (error) { showToast("Nie udało się usunąć pozycji", "error"); return; }
    await load();
  };

  if (!organizationId) return null;
  if (!canUse) {
    return (
      <div className="rounded-xl2 border border-stone-200/80 bg-white p-6 shadow-card">
        <h1 className="text-xl font-bold text-ink">Warianty kosztorysów</h1>
        <p className="mt-2 text-sm text-steel">Ten słownik jest dostępny dla ról biuro / kierownik / handlowiec.</p>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Słowniki</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Warianty kosztorysów (szablony)</h1>
        <p className="mt-2 max-w-2xl text-sm text-steel">
          Gotowe zestawy pozycji (materiały + robocizna), które wstawisz jednym kliknięciem przy zakładaniu nowego zlecenia albo w wycenie istniejącej sprawy.
        </p>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card">
          <h2 className="text-sm font-bold text-ink">Szablony ({templates.length})</h2>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row lg:flex-col">
            <input
              className="input flex-1 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addTemplate()}
              placeholder="Nazwa nowego szablonu"
            />
            <button type="button" onClick={() => void addTemplate()} disabled={!newName.trim()} className="shrink-0 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
              + Szablon
            </button>
          </div>
          {loading ? (
            <p className="mt-4 text-sm text-steel">Wczytywanie...</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {templates.map((t) => {
                const lines = linesByTemplate[t.id] || [];
                const sum = lines.reduce((s, l) => s + Number(l.line_total), 0);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        selectedId === t.id ? "border-moss bg-moss/10" : "border-stone-200 bg-white hover:bg-stone-50"
                      }`}
                    >
                      <p className="truncate text-sm font-semibold text-ink">{t.name}</p>
                      <p className="mt-0.5 text-xs text-steel">{lines.length} poz. · {formatMoney(sum)}</p>
                    </button>
                  </li>
                );
              })}
              {templates.length === 0 && (
                <li className="rounded-lg border border-dashed border-stone-200 p-6 text-center text-xs text-steel">Brak szablonów — dodaj pierwszy powyżej.</li>
              )}
            </ul>
          )}
        </section>

        {selectedTemplate ? (
          <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <label className="grid gap-1 text-xs font-semibold text-ink">
                  Nazwa szablonu
                  <input
                    key={`name-${selectedTemplate.id}`}
                    className="input font-normal"
                    defaultValue={selectedTemplate.name}
                    onBlur={(e) => { if (e.target.value !== selectedTemplate.name) void renameTemplate(selectedTemplate.id, e.target.value); }}
                  />
                </label>
                <label className="mt-2 grid gap-1 text-xs font-semibold text-ink">
                  Opis (widoczny tylko w tym słowniku)
                  <input
                    key={`desc-${selectedTemplate.id}`}
                    className="input font-normal"
                    defaultValue={selectedTemplate.description || ""}
                    placeholder="np. do remontów łazienek do 8 m²"
                    onBlur={(e) => void updateDescription(selectedTemplate.id, e.target.value)}
                  />
                </label>
              </div>
              <button type="button" onClick={() => void removeTemplate(selectedTemplate.id)} className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50">
                Usuń szablon
              </button>
            </div>

            <div className="mt-4 grid gap-2 rounded-xl2 bg-stone-50 p-3">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void addLine("labor")} className="rounded-lg bg-sky-50 px-3 py-2.5 text-sm font-semibold text-sky-700 hover:bg-sky-100">
                  + Robocizna
                </button>
                <button type="button" onClick={() => void addLine("material")} className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100">
                  + Materiał
                </button>
              </div>
              <label className="grid gap-1 text-xs font-medium text-steel">
                Dodaj z katalogu pozycji
                <select
                  className="input"
                  defaultValue=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const item = catalog.find((c) => c.id === id);
                    if (item) void addLineFromCatalog(item);
                    e.target.value = "";
                  }}
                >
                  <option value="">— wybierz pozycję z katalogu —</option>
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>{c.label} ({c.category === "labor" ? "rob." : "mat."})</option>
                  ))}
                </select>
              </label>
            </div>

            {selectedLines.length === 0 ? (
              <p className="mt-3 rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-sm text-steel">Brak pozycji w szablonie. Dodaj pierwszą powyżej.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs uppercase text-steel">
                    <tr>
                      <th className="py-2">Sekcja</th>
                      <th className="py-2">Opis</th>
                      <th className="py-2">Jedn.</th>
                      <th className="py-2">Ilość</th>
                      <th className="py-2">Stawka</th>
                      <th className="py-2">Wartość</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {selectedLines.map((line) => (
                      <tr key={line.id}>
                        <td className="py-2 pr-2">
                          <select className="input py-1 text-xs" value={line.section} onChange={(e) => void updateLine(line, { section: e.target.value as "labor" | "material" })}>
                            <option value="labor">robocizna</option>
                            <option value="material">materiał</option>
                          </select>
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            key={`${line.id}-label-${line.label}`}
                            className="input py-1 text-xs"
                            defaultValue={line.label}
                            onBlur={(e) => { if (e.target.value !== line.label) void updateLine(line, { label: e.target.value }); }}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <select className="input py-1 text-xs" value={line.unit} onChange={(e) => void updateLine(line, { unit: e.target.value as Unit })}>
                            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            key={`${line.id}-qty-${line.quantity}`}
                            type="number" min="0" step="0.01"
                            className="input w-24 py-1 text-xs"
                            defaultValue={line.quantity}
                            onBlur={(e) => { if (Number(e.target.value) !== line.quantity) void updateLine(line, { quantity: Number(e.target.value) }); }}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            key={`${line.id}-rate-${line.unit_rate}`}
                            type="number" min="0" step="0.01"
                            className="input w-24 py-1 text-xs"
                            defaultValue={line.unit_rate}
                            onBlur={(e) => { if (Number(e.target.value) !== line.unit_rate) void updateLine(line, { unit_rate: Number(e.target.value) }); }}
                          />
                        </td>
                        <td className="py-2 pr-2 font-medium">{formatMoney(line.line_total)}</td>
                        <td className="py-2">
                          <button type="button" className="text-xs font-medium text-rose-500 hover:underline" onClick={() => void deleteLine(line.id)}>Usuń</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl2 border border-sky-200/70 bg-sky-50/50 p-3">
                <p className="text-[0.7rem] font-medium uppercase tracking-wide text-sky-700">Robocizna</p>
                <p className="mt-0.5 text-sm font-bold text-ink">{formatMoney(laborSum)}</p>
              </div>
              <div className="rounded-xl2 border border-amber-200/70 bg-amber-50/50 p-3">
                <p className="text-[0.7rem] font-medium uppercase tracking-wide text-amber-700">Materiał</p>
                <p className="mt-0.5 text-sm font-bold text-ink">{formatMoney(matSum)}</p>
              </div>
              <div className="rounded-xl2 border border-moss/30 bg-moss/10 p-3">
                <p className="text-[0.7rem] font-medium uppercase tracking-wide text-moss-dark">Razem netto</p>
                <p className="mt-0.5 text-sm font-bold text-moss-dark">{formatMoney(laborSum + matSum)}</p>
              </div>
            </div>
          </section>
        ) : (
          <section className="flex min-w-0 items-center justify-center rounded-xl2 border border-dashed border-stone-300 bg-white p-10 text-center text-sm text-steel">
            {templates.length === 0 ? "Utwórz pierwszy szablon, aby zacząć." : "Wybierz szablon z listy po lewej."}
          </section>
        )}
      </div>
    </div>
  );
}
