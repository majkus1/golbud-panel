"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { canManageOrg, useOrg } from "@/components/org-context";
import { supabase } from "@/lib/supabase";
import type { Subcontractor } from "@/lib/types";

export default function SubcontractorsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <SubcontractorsInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

type Form = {
  name: string;
  trade: string;
  contact_name: string;
  phone: string;
  email: string;
  default_rate: string;
  notes: string;
};

const empty: Form = { name: "", trade: "", contact_name: "", phone: "", email: "", default_rate: "", notes: "" };

function SubcontractorsInner() {
  const { organizationId, role } = useOrg();
  const canEdit = canManageOrg(role);
  const [list, setList] = useState<Subcontractor[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const { data } = await supabase
      .from("subcontractors")
      .select("*")
      .eq("organization_id", organizationId)
      .order("archived")
      .order("name");
    setList((data || []) as Subcontractor[]);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (s: Subcontractor) => {
    setEditingId(s.id);
    setFormOpen(true);
    setForm({
      name: s.name,
      trade: s.trade || "",
      contact_name: s.contact_name || "",
      phone: s.phone || "",
      email: s.email || "",
      default_rate: s.default_rate != null ? String(s.default_rate) : "",
      notes: s.notes || ""
    });
  };

  const cancel = () => {
    setEditingId(null);
    setForm(empty);
    setFormOpen(false);
  };

  const save = async () => {
    if (!organizationId || !form.name.trim()) return;
    const payload = {
      organization_id: organizationId,
      name: form.name.trim(),
      trade: form.trade.trim() || null,
      contact_name: form.contact_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      default_rate: form.default_rate ? Number(form.default_rate) : null,
      notes: form.notes.trim() || null
    };
    let err: { message: string } | null = null;
    if (editingId) {
      ({ error: err } = await supabase.from("subcontractors").update(payload).eq("id", editingId));
    } else {
      ({ error: err } = await supabase.from("subcontractors").insert(payload));
    }
    if (err) {
      window.alert("Nie udało się zapisać: " + err.message);
      return;
    }
    cancel();
    await load();
  };

  const toggleArchive = async (s: Subcontractor) => {
    await supabase.from("subcontractors").update({ archived: !s.archived }).eq("id", s.id);
    await load();
  };

  const remove = async (s: Subcontractor) => {
    if (!confirm(`Usunąć podwykonawcę „${s.name}”?`)) return;
    const { error } = await supabase.from("subcontractors").delete().eq("id", s.id);
    if (error) {
      window.alert("Nie da się usunąć (prawdopodobnie jest powiązany ze sprawami). Zarchiwizuj zamiast tego.");
      return;
    }
    await load();
  };

  if (!organizationId) return null;

  const visible = list.filter((s) => showArchived || !s.archived);

  return (
    <div className="grid max-w-4xl gap-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Ustawienia</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Podwykonawcy / ekipy zewnętrzne</h1>
        <p className="mt-2 text-sm text-steel">Baza firm i osób, które przypisujesz do realizacji w karcie sprawy.</p>
      </div>

      {canEdit && !formOpen && (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          aria-expanded={false}
          className="flex w-full items-center justify-center gap-2 rounded-xl2 border border-dashed border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-ink shadow-card transition hover:border-moss/60 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-auto"
        >
          <span className="text-lg leading-none">+</span> Nowy podwykonawca
        </button>
      )}

      {canEdit && formOpen && (
        <section className="grid gap-3 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-ink">{editingId ? "Edycja podwykonawcy" : "Nowy podwykonawca"}</h2>
            <button type="button" onClick={cancel} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-steel hover:bg-stone-100 hover:text-ink">
              Zwiń
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-ink md:col-span-2">
              Nazwa firmy / brygady <span className="text-rose-500" aria-hidden>*</span>
              <input className="input text-sm font-normal" placeholder="np. Alfa Elewacje sp. z o.o." value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Specjalizacja
              <input className="input text-sm font-normal" placeholder="np. elewacja, rusztowania, blacharstwo" value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Osoba kontaktowa
              <input className="input text-sm font-normal" placeholder="Imię i nazwisko" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Telefon
              <input className="input text-sm font-normal" placeholder="np. 600 100 200" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              E-mail
              <input className="input text-sm font-normal" placeholder="np. biuro@firma.pl" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Domyślna stawka <span className="font-normal text-steel">· PLN</span>
              <input className="input text-sm font-normal" placeholder="0" inputMode="decimal" value={form.default_rate} onChange={(e) => setForm({ ...form, default_rate: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink md:col-span-2">
              Notatki <span className="font-normal text-steel">(opcjonalnie)</span>
              <textarea className="input text-sm font-normal" placeholder="Zakres współpracy, warunki, uwagi…" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => void save()} disabled={!form.name.trim()} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50">
              {editingId ? "Zapisz zmiany" : "Dodaj podwykonawcę"}
            </button>
            {editingId && (
              <button type="button" onClick={cancel} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50">
                Anuluj
              </button>
            )}
          </div>
        </section>
      )}

      <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-ink">Lista ({visible.length})</h2>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-steel">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-moss" />
            pokaż zarchiwizowanych
          </label>
        </div>
        <ul className="grid gap-2.5 text-sm">
          {visible.map((s) => (
            <li
              key={s.id}
              className={`relative grid gap-2 overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card md:grid-cols-[1fr_auto] md:items-start ${
                s.archived ? "border-stone-200 bg-stone-50" : "border-stone-200 bg-white"
              }`}
            >
              <span className={`absolute inset-y-0 left-0 w-1.5 ${s.archived ? "bg-stone-300" : "bg-moss"}`} aria-hidden />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">{s.name}</p>
                  {s.trade && (
                    <span className="inline-flex rounded-full bg-moss/12 px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-moss-dark">
                      {s.trade}
                    </span>
                  )}
                  {s.archived && (
                    <span className="inline-flex rounded-full bg-stone-200 px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-stone-600">
                      archiwum
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-steel">
                  {s.contact_name && <span>👤 {s.contact_name}</span>}
                  {s.phone && (
                    <a href={`tel:${s.phone.replace(/\s/g, "")}`} className="font-medium hover:text-moss">
                      📞 {s.phone}
                    </a>
                  )}
                  {s.email && (
                    <a href={`mailto:${s.email}`} className="font-medium hover:text-moss">
                      ✉ {s.email}
                    </a>
                  )}
                  {s.default_rate != null && <span>💰 {s.default_rate} PLN</span>}
                </div>
                {s.notes && <p className="mt-1.5 text-xs text-steel">{s.notes}</p>}
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => startEdit(s)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50">
                    Edytuj
                  </button>
                  <button type="button" onClick={() => void toggleArchive(s)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50">
                    {s.archived ? "Przywróć" : "Archiwizuj"}
                  </button>
                  <button type="button" onClick={() => void remove(s)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50">
                    Usuń
                  </button>
                </div>
              )}
            </li>
          ))}
          {visible.length === 0 && (
            <li className="rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-steel">Brak podwykonawców — dodaj pierwszego.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
