"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { showToast } from "@/components/toast";
import { PROTOCOL_TYPES } from "@/lib/domain";
import { downloadAuthenticatedPdf } from "@/lib/download-authenticated-pdf";
import { formatDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { CaseProtocol, ProtocolType } from "@/lib/types";

export function ProtocolsSection({
  caseId,
  organizationId,
  userId,
  items,
  onChange
}: {
  caseId: string;
  organizationId: string;
  userId: string;
  items: CaseProtocol[];
  onChange: () => Promise<void>;
}) {
  const [ptype, setPtype] = useState<ProtocolType>("po ociepleniu");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState<ProtocolType>("po ociepleniu");
  const [editNotes, setEditNotes] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const { data, error } = await supabase
      .from("case_protocols")
      .insert({
        organization_id: organizationId,
        case_id: caseId,
        protocol_type: ptype,
        notes: notes.trim(),
        created_by: userId
      })
      .select("id")
      .single();
    if (!error && data) {
      setNotes("");
      await onChange();
    }
  };

  const downloadProtocolPdf = async (protocolId: string, protocolType: string) => {
    const fname = `protokol-${protocolType.replace(/\s+/g, "-")}`.slice(0, 100);
    await downloadAuthenticatedPdf(`/api/cases/${caseId}/protocols/${protocolId}/pdf`, `${fname}.pdf`);
  };

  const saveEdit = async (protocolId: string) => {
    setBusy(true);
    const { error } = await supabase
      .from("case_protocols")
      .update({ protocol_type: editType, notes: editNotes.trim() })
      .eq("id", protocolId);
    setBusy(false);
    if (error) {
      showToast("Nie udało się zapisać zmiany", "error");
      return;
    }
    setEditingId(null);
    await onChange();
  };

  const remove = async () => {
    if (!deletingId) return;
    setBusy(true);
    const { error } = await supabase.from("case_protocols").delete().eq("id", deletingId);
    setBusy(false);
    setDeletingId(null);
    if (error) {
      showToast("Nie udało się usunąć protokołu", "error");
      return;
    }
    await onChange();
  };

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <h2 className="text-lg font-bold text-ink">Protokoły (PDF)</h2>
      <div className="mt-4 grid gap-3 rounded-xl2 bg-stone-50 p-4 md:grid-cols-3">
        <select value={ptype} onChange={(e) => setPtype(e.target.value as ProtocolType)} className="input">
          {PROTOCOL_TYPES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <textarea className="input min-h-20 md:col-span-2" placeholder="Opis stanu, ustaleń, uwag…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button type="button" onClick={add} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-moss sm:px-4 sm:py-2.5 sm:text-sm md:col-span-3">
          Zapisz protokół
        </button>
      </div>
      <ul className="mt-5 grid gap-2.5 text-sm">
        {items.map((p) => {
          const editing = editingId === p.id;
          return (
          <li key={p.id} className="rounded-xl2 border border-stone-200 bg-white p-3.5 shadow-card">
            {editing ? (
              <div className="grid gap-2">
                <select value={editType} onChange={(e) => setEditType(e.target.value as ProtocolType)} className="input text-sm">
                  {PROTOCOL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <textarea
                  className="input min-h-20 text-sm"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Opis stanu, ustaleń, uwag…"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveEdit(p.id)}
                    className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-moss disabled:opacity-50"
                  >
                    {busy ? "Zapis…" : "Zapisz"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="inline-flex rounded-full bg-moss/12 px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-moss-dark">
                    {p.protocol_type}
                  </span>
                  <p className="mt-1.5 whitespace-pre-wrap text-steel">{p.notes || "—"}</p>
                  <p className="mt-1 text-xs text-stone-400">{formatDateTime(p.created_at)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void downloadProtocolPdf(p.id, p.protocol_type)}
                    className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-stone-50"
                  >
                    Pobierz PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(p.id);
                      setEditType(p.protocol_type);
                      setEditNotes(p.notes || "");
                    }}
                    className="rounded-lg px-2.5 py-2 text-xs font-semibold text-steel hover:bg-stone-100 hover:text-ink"
                  >
                    Edytuj
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingId(p.id)}
                    className="rounded-lg px-2.5 py-2 text-xs font-semibold text-steel hover:bg-rose-100 hover:text-rose-700"
                  >
                    Usuń
                  </button>
                </div>
              </div>
            )}
          </li>
          );
        })}
        {items.length === 0 && (
          <li className="rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-steel">Brak zapisanych protokołów.</li>
        )}
      </ul>

      <ConfirmDialog
        open={deletingId !== null}
        title="Usunąć protokół?"
        message="Wpis zniknie z historii sprawy. Wygenerowanych wcześniej plików PDF to nie usuwa."
        confirmLabel="Usuń"
        variant="danger"
        onCancel={() => setDeletingId(null)}
        onConfirm={() => void remove()}
        loading={busy}
      />
    </section>
  );
}
