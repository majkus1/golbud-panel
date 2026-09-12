"use client";

import { DateInput } from "@/components/date-input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { showToast } from "@/components/toast";
import { Badge, Button, EmptyState } from "@/components/ui";
import {
  INVOICE_KIND_LABELS,
  INVOICE_KINDS,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  UNITS,
  VAT_RATES
} from "@/lib/domain";
import { buildInvoiceNumber, computeInvoiceLine, summarizeInvoice, vatBreakdown } from "@/lib/invoice";
import { downloadAuthenticatedFile, downloadAuthenticatedPdf } from "@/lib/download-authenticated-pdf";
import { postAuthenticatedJson } from "@/lib/authed-fetch";
import { INVOICE_EMAIL_DEFAULTS, ORGANIZATION_INVOICE_MAIL_SELECT } from "@/lib/organization-offer-profile";
import { supabase } from "@/lib/supabase";
import type {
  CaseRow,
  Invoice,
  InvoiceKind,
  InvoiceLine,
  InvoiceStatus,
  OfferLine,
  OfferVariant,
  PaymentMethod,
  Unit,
  VatRate
} from "@/lib/types";

const PLN = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", minimumFractionDigits: 2 });
const money = (n: number) => PLN.format(Number(n) || 0);

const STATUS_TONE: Record<InvoiceStatus, "neutral" | "moss" | "amber" | "red"> = {
  szkic: "neutral",
  wystawiona: "amber",
  "opłacona": "moss",
  anulowana: "red"
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type Props = {
  caseId: string;
  organizationId: string;
  userId: string;
  caseRow: CaseRow | null;
  variants: OfferVariant[];
  /** Odświeżenie danych karty sprawy (np. płatności) po akcjach faktury. */
  onCaseDataChange?: () => Promise<void> | void;
};

export function InvoicesSection({ caseId, organizationId, userId, caseRow, variants, onCaseDataChange }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [newKind, setNewKind] = useState<InvoiceKind>("proforma");
  const [newVariantId, setNewVariantId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [defaultVatRate, setDefaultVatRate] = useState<number>(23);
  const detailRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: inv }, { data: org }] = await Promise.all([
      supabase.from("invoices").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
      supabase.from("organizations").select("offer_default_vat_rate").eq("id", organizationId).maybeSingle()
    ]);
    setInvoices((inv || []) as Invoice[]);
    const v = Number(org?.offer_default_vat_rate);
    if (Number.isFinite(v)) setDefaultVatRate(v);
    setLoading(false);
  }, [caseId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createInvoice = async () => {
    setCreating(true);
    try {
      const year = new Date().getFullYear();
      const { data: seq, error: seqErr } = await supabase.rpc("next_invoice_seq", {
        p_org: organizationId,
        p_kind: newKind,
        p_year: year
      });
      if (seqErr || seq == null) {
        showToast(seqErr?.message || "Nie udało się nadać numeru faktury", "error");
        return;
      }
      const number = buildInvoiceNumber(newKind, Number(seq), year);

      const { data: created, error: invErr } = await supabase
        .from("invoices")
        .insert({
          organization_id: organizationId,
          case_id: caseId,
          kind: newKind,
          number,
          number_seq: Number(seq),
          number_year: year,
          issue_date: todayIso(),
          sale_date: todayIso(),
          due_date: addDaysIso(7),
          payment_method: "przelew",
          buyer_name: caseRow?.client_name || "",
          buyer_address: caseRow?.location || null,
          buyer_email: caseRow?.email || null,
          notes: null,
          source_variant_id: newVariantId || null,
          created_by: userId
        })
        .select("id")
        .single();

      if (invErr || !created) {
        showToast(invErr?.message || "Nie udało się utworzyć faktury", "error");
        return;
      }

      if (newVariantId) {
        const { data: offerLines } = await supabase
          .from("offer_lines")
          .select("*")
          .eq("variant_id", newVariantId)
          .order("sort_order");
        const lines = (offerLines || []) as OfferLine[];
        if (lines.length > 0) {
          const payload = lines.map((l, idx) => ({
            organization_id: organizationId,
            invoice_id: created.id,
            name: l.label,
            unit: l.unit,
            quantity: Number(l.quantity) || 0,
            unit_price_net: Number(l.unit_rate) || 0,
            discount_pct: 0,
            vat_rate: defaultVatRate,
            sort_order: idx
          }));
          await supabase.from("invoice_lines").insert(payload);
        }
      }

      showToast("Faktura utworzona", "success");
      setNewVariantId("");
      setSelectedId(created.id);
      await load();
    } finally {
      setCreating(false);
    }
  };

  const selected = useMemo(() => invoices.find((i) => i.id === selectedId) ?? null, [invoices, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const frame = requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);

  const selectInvoice = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  return (
    <section className="grid min-w-0 max-w-full gap-4 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Faktury</h2>
          <p className="text-xs text-steel">
            Proforma, zaliczkowa, końcowa i VAT — spięte z wyceną i płatnościami. Eksport PDF oraz XML (KSeF FA(2)).
          </p>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 rounded-lg border border-stone-200 bg-concrete/40 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="grid min-w-0 gap-1 text-sm font-semibold text-ink">
          Typ faktury
          <select value={newKind} onChange={(e) => setNewKind(e.target.value as InvoiceKind)} className="input min-w-0">
            {INVOICE_KINDS.map((k) => (
              <option key={k} value={k}>
                {INVOICE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-semibold text-ink">
          Na podstawie wariantu oferty (opcjonalnie)
          <select value={newVariantId} onChange={(e) => setNewVariantId(e.target.value)} className="input min-w-0">
            <option value="">— pusta faktura —</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" block className="sm:w-auto sm:self-end" onClick={() => void createInvoice()} disabled={creating}>
          {creating ? "Tworzenie..." : "Utwórz fakturę"}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-steel">Wczytywanie...</p>
      ) : invoices.length === 0 ? (
        <EmptyState
          title="Brak faktur"
          description="Wystaw fakturę proforma lub zaliczkową na podstawie wariantu oferty, albo utwórz pustą fakturę."
        />
      ) : (
        <div className="grid gap-2">
          {invoices.map((inv) => (
            <button
              key={inv.id}
              type="button"
              onClick={() => selectInvoice(inv.id)}
              className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-left transition ${
                selectedId === inv.id ? "border-moss bg-moss/5" : "border-stone-200 hover:border-moss/40"
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{inv.number}</span>
                  <Badge tone="neutral">{INVOICE_KIND_LABELS[inv.kind]}</Badge>
                  <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-steel">
                  Wystawiona: {inv.issue_date} · termin: {inv.due_date || "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold text-ink">{money(inv.gross_total)}</p>
                <p className="text-xs text-steel">netto {money(inv.net_total)}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div ref={detailRef} className="scroll-mt-24">
          <InvoiceEditor
            key={selected.id}
            invoice={selected}
            organizationId={organizationId}
            caseId={caseId}
            defaultVatRate={defaultVatRate}
            onChange={load}
            onCaseDataChange={onCaseDataChange}
            onDeleted={() => {
              setSelectedId(null);
              void load();
            }}
          />
        </div>
      )}
    </section>
  );
}

function InvoiceEditor({
  invoice,
  organizationId,
  caseId,
  defaultVatRate,
  onChange,
  onCaseDataChange,
  onDeleted
}: {
  invoice: Invoice;
  organizationId: string;
  caseId: string;
  defaultVatRate: number;
  onChange: () => Promise<void> | void;
  onCaseDataChange?: () => Promise<void> | void;
  onDeleted: () => void;
}) {
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notesDraft, setNotesDraft] = useState(invoice.notes || "");

  const [accountantEmail, setAccountantEmail] = useState<string | null>(null);
  const [mailDefaults, setMailDefaults] = useState<{ subject: string; body: string; orgName: string }>({
    subject: INVOICE_EMAIL_DEFAULTS.subject,
    body: INVOICE_EMAIL_DEFAULTS.body,
    orgName: "GolBud"
  });

  const [showSend, setShowSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendToBuyer, setSendToBuyer] = useState(true);
  const [sendToAccountant, setSendToAccountant] = useState(false);
  const [extraEmail, setExtraEmail] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendMessage, setSendMessage] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("organizations")
        .select(`name, ${ORGANIZATION_INVOICE_MAIL_SELECT}`)
        .eq("id", organizationId)
        .maybeSingle();
      if (!active || !data) return;
      const row = data as { name?: string | null; accountant_email?: string | null; invoice_email_subject?: string | null; invoice_email_body?: string | null };
      setAccountantEmail(row.accountant_email?.trim() || null);
      setMailDefaults({
        subject: row.invoice_email_subject?.trim() || INVOICE_EMAIL_DEFAULTS.subject,
        body: row.invoice_email_body?.trim() || INVOICE_EMAIL_DEFAULTS.body,
        orgName: row.name?.trim() || "GolBud"
      });
    })();
    return () => {
      active = false;
    };
  }, [organizationId]);

  const loadLines = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("invoice_lines").select("*").eq("invoice_id", invoice.id).order("sort_order");
    setLines((data || []) as InvoiceLine[]);
    setLoading(false);
  }, [invoice.id]);

  useEffect(() => {
    void loadLines();
  }, [loadLines]);

  const totals = useMemo(() => summarizeInvoice(lines), [lines]);
  const buckets = useMemo(() => vatBreakdown(lines), [lines]);

  const patchHeader = async (patch: Partial<Invoice>) => {
    const { error } = await supabase.from("invoices").update(patch).eq("id", invoice.id);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    await onChange();
  };

  const addLine = async () => {
    const { error } = await supabase.from("invoice_lines").insert({
      organization_id: organizationId,
      invoice_id: invoice.id,
      name: "",
      unit: "usługa",
      quantity: 1,
      unit_price_net: 0,
      discount_pct: 0,
      vat_rate: defaultVatRate,
      sort_order: lines.length
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    await loadLines();
    await onChange();
  };

  const updateLine = async (line: InvoiceLine, patch: Partial<InvoiceLine>) => {
    const { error } = await supabase.from("invoice_lines").update(patch).eq("id", line.id);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    await loadLines();
    await onChange();
  };

  const deleteLine = async (id: string) => {
    const { error } = await supabase.from("invoice_lines").delete().eq("id", id);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    await loadLines();
    await onChange();
  };

  const deleteInvoice = async () => {
    setBusy(true);
    const { error } = await supabase.from("invoices").delete().eq("id", invoice.id);
    setBusy(false);
    setShowDelete(false);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Faktura usunięta", "success");
    onDeleted();
  };

  const addToPayments = async () => {
    setBusy(true);
    const { error } = await supabase.from("payments").insert({
      organization_id: organizationId,
      case_id: caseId,
      title: `Faktura ${invoice.number}`,
      due_date: invoice.due_date,
      amount_due: totals.gross,
      amount_paid: 0,
      sort_order: 0
    });
    setBusy(false);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Dodano do płatności", "success");
    await onCaseDataChange?.();
  };

  const downloadPdf = () =>
    void downloadAuthenticatedPdf(`/api/cases/${caseId}/invoices/${invoice.id}/pdf`, `Faktura_${invoice.number.replace(/\//g, "_")}.pdf`);

  const downloadKsef = () =>
    void downloadAuthenticatedFile(`/api/cases/${caseId}/invoices/${invoice.id}/ksef`, `KSeF_${invoice.number.replace(/\//g, "_")}.xml`);

  const fillTemplate = (tpl: string): string =>
    tpl
      .replace(/\{numer\}/g, invoice.number)
      .replace(/\{kwota\}/g, money(totals.gross))
      .replace(/\{termin\}/g, invoice.due_date || "—")
      .replace(/\{firma\}/g, mailDefaults.orgName);

  const openSend = () => {
    setSendToBuyer(!!invoice.buyer_email);
    setSendToAccountant(false);
    setExtraEmail("");
    setSendSubject(fillTemplate(mailDefaults.subject));
    setSendMessage(fillTemplate(mailDefaults.body));
    setShowSend(true);
  };

  const recipients = useMemo(() => {
    const list: string[] = [];
    if (sendToBuyer && invoice.buyer_email) list.push(invoice.buyer_email.trim());
    if (sendToAccountant && accountantEmail) list.push(accountantEmail);
    const extra = extraEmail.trim();
    if (extra) list.push(extra);
    return Array.from(new Set(list.filter(Boolean)));
  }, [sendToBuyer, sendToAccountant, extraEmail, invoice.buyer_email, accountantEmail]);

  const doSend = async () => {
    if (recipients.length === 0) {
      showToast("Wybierz co najmniej jednego odbiorcę", "error");
      return;
    }
    setSending(true);
    const res = await postAuthenticatedJson(`/api/cases/${caseId}/invoices/${invoice.id}/send`, {
      recipients,
      subject: sendSubject,
      message: sendMessage
    });
    setSending(false);
    if (!res.ok) {
      showToast(res.error, "error");
      return;
    }
    showToast("Faktura wysłana mailem", "success");
    setShowSend(false);
    await onChange();
  };

  const saveNotes = () => {
    const next = notesDraft.trim() || null;
    if (next !== (invoice.notes || null)) void patchHeader({ notes: next });
  };

  return (
    <div className="grid gap-4 rounded-lg border border-stone-300 bg-concrete/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ink">Edycja: {invoice.number}</h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={downloadPdf}>
            Pobierz PDF
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={downloadKsef}>
            Eksport KSeF (XML)
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={openSend}>
            Wyślij mailem
          </Button>
          <Button type="button" variant="subtle" size="sm" onClick={() => void addToPayments()} disabled={busy}>
            Dodaj do płatności
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={() => setShowDelete(true)} disabled={busy}>
            Usuń
          </Button>
        </div>
      </div>

      <details className="rounded-lg border border-stone-200 bg-white/70 p-3 text-sm text-steel">
        <summary className="cursor-pointer list-none font-semibold text-ink">
          <span className="mr-1 text-moss">ℹ</span> Co to jest „Eksport KSeF (XML)"?
        </summary>
        <p className="mt-2 leading-relaxed">
          KSeF (Krajowy System e-Faktur) to rządowa platforma Ministerstwa Finansów, przez którą firmy wystawiają i odbierają
          faktury w jednolitym formacie XML — schemie <strong>FA(2)</strong>. Przycisk „Eksport KSeF (XML)" pobiera fakturę
          właśnie w tym formacie. Taki plik można zaimportować do programu księgowego lub przekazać księgowej, a docelowo
          wysłać bezpośrednio do KSeF. Dla zwykłej wysyłki do klienta wystarczy „Pobierz PDF".
        </p>
      </details>

      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-steel">Dane dokumentu</p>
      <div className="-mt-2 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-ink">
          Status
          <select
            className="input"
            value={invoice.status}
            onChange={(e) => void patchHeader({ status: e.target.value as InvoiceStatus })}
          >
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink">
          Sposób płatności
          <select
            className="input"
            value={invoice.payment_method}
            onChange={(e) => void patchHeader({ payment_method: e.target.value as PaymentMethod })}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-ink">
          Data wystawienia
          <DateInput
            defaultValue={invoice.issue_date}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== invoice.issue_date) void patchHeader({ issue_date: e.target.value });
            }}
          />
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-ink">
          Data sprzedaży
          <DateInput
            defaultValue={invoice.sale_date || ""}
            onBlur={(e) => {
              if (e.target.value !== (invoice.sale_date || "")) void patchHeader({ sale_date: e.target.value || null });
            }}
          />
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-ink">
          Termin płatności
          <DateInput
            defaultValue={invoice.due_date || ""}
            onBlur={(e) => {
              if (e.target.value !== (invoice.due_date || "")) void patchHeader({ due_date: e.target.value || null });
            }}
          />
        </label>
      </div>

      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-steel">Nabywca</p>
      <div className="-mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs font-semibold text-ink sm:col-span-2">
          Nazwa nabywcy
          <input
            className="input"
            defaultValue={invoice.buyer_name}
            onBlur={(e) => {
              if (e.target.value !== invoice.buyer_name) void patchHeader({ buyer_name: e.target.value });
            }}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink">
          NIP nabywcy
          <input
            className="input"
            defaultValue={invoice.buyer_nip || ""}
            onBlur={(e) => {
              if (e.target.value !== (invoice.buyer_nip || "")) void patchHeader({ buyer_nip: e.target.value || null });
            }}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink">
          Miasto / kod
          <input
            className="input"
            defaultValue={invoice.buyer_city || ""}
            onBlur={(e) => {
              if (e.target.value !== (invoice.buyer_city || "")) void patchHeader({ buyer_city: e.target.value || null });
            }}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink sm:col-span-2">
          Adres nabywcy
          <input
            className="input"
            defaultValue={invoice.buyer_address || ""}
            onBlur={(e) => {
              if (e.target.value !== (invoice.buyer_address || "")) void patchHeader({ buyer_address: e.target.value || null });
            }}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink sm:col-span-2">
          E-mail nabywcy
          <input
            className="input"
            defaultValue={invoice.buyer_email || ""}
            onBlur={(e) => {
              if (e.target.value !== (invoice.buyer_email || "")) void patchHeader({ buyer_email: e.target.value || null });
            }}
          />
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-bold text-ink">Pozycje</h4>
          <Button type="button" variant="subtle" size="sm" onClick={() => void addLine()}>
            + pozycja
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-steel">Wczytywanie pozycji...</p>
        ) : lines.length === 0 ? (
          <p className="rounded-md border border-dashed border-stone-300 p-3 text-sm text-steel">
            Brak pozycji. Dodaj ręcznie lub utwórz fakturę z wariantu oferty.
          </p>
        ) : (
          <>
          {/* Mobile: karty pozycji */}
          <div className="grid gap-2.5 sm:hidden">
            {lines.map((line) => {
              const c = computeInvoiceLine(line);
              return (
                <div key={line.id} className="grid gap-2.5 rounded-xl2 border border-stone-200 bg-white p-3.5 shadow-card">
                  <input
                    key={`m-${line.id}-name-${line.name}`}
                    className="input py-1.5 text-sm font-semibold text-ink"
                    placeholder="Nazwa pozycji"
                    defaultValue={line.name}
                    onBlur={(e) => {
                      if (e.target.value !== line.name) void updateLine(line, { name: e.target.value });
                    }}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-0.5 text-xs font-medium text-steel">
                      Ilość
                      <input
                        key={`m-${line.id}-qty-${line.quantity}`}
                        type="number"
                        min="0"
                        step="0.01"
                        className="input py-1.5 text-sm"
                        defaultValue={line.quantity}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== Number(line.quantity)) void updateLine(line, { quantity: v });
                        }}
                      />
                    </label>
                    <label className="grid gap-0.5 text-xs font-medium text-steel">
                      J.m.
                      <select
                        className="input py-1.5 text-sm"
                        value={line.unit}
                        onChange={(e) => void updateLine(line, { unit: e.target.value as Unit })}
                      >
                        {UNITS.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-0.5 text-xs font-medium text-steel">
                      Cena netto
                      <input
                        key={`m-${line.id}-price-${line.unit_price_net}`}
                        type="number"
                        min="0"
                        step="0.01"
                        className="input py-1.5 text-sm"
                        defaultValue={line.unit_price_net}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== Number(line.unit_price_net)) void updateLine(line, { unit_price_net: v });
                        }}
                      />
                    </label>
                    <label className="grid gap-0.5 text-xs font-medium text-steel">
                      Rabat %
                      <input
                        key={`m-${line.id}-disc-${line.discount_pct}`}
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        className="input py-1.5 text-sm"
                        defaultValue={line.discount_pct}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== Number(line.discount_pct)) void updateLine(line, { discount_pct: v });
                        }}
                      />
                    </label>
                    <label className="grid gap-0.5 text-xs font-medium text-steel">
                      VAT %
                      <select
                        className="input py-1.5 text-sm"
                        value={String(line.vat_rate)}
                        onChange={(e) => void updateLine(line, { vat_rate: Number(e.target.value) as VatRate })}
                      >
                        {VAT_RATES.map((r) => (
                          <option key={r} value={r}>{r}%</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-stone-100 pt-2">
                    <button
                      type="button"
                      className="rounded-lg px-2 py-1 text-xs font-medium text-rose-500 hover:bg-rose-50"
                      onClick={() => void deleteLine(line.id)}
                    >
                      Usuń pozycję
                    </button>
                    <span className="text-base font-bold text-ink">{money(c.gross)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: tabela pozycji */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-xs uppercase text-steel">
                <tr>
                  <th className="py-2 pr-2">Nazwa</th>
                  <th className="py-2 pr-2">J.m.</th>
                  <th className="py-2 pr-2">Ilość</th>
                  <th className="py-2 pr-2">Cena netto</th>
                  <th className="py-2 pr-2">Rabat %</th>
                  <th className="py-2 pr-2">VAT %</th>
                  <th className="py-2 pr-2">Brutto</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {lines.map((line) => {
                  const c = computeInvoiceLine(line);
                  return (
                    <tr key={line.id}>
                      <td className="py-2 pr-2">
                        <input
                          key={`${line.id}-name-${line.name}`}
                          className="input py-1 text-xs"
                          defaultValue={line.name}
                          onBlur={(e) => {
                            if (e.target.value !== line.name) void updateLine(line, { name: e.target.value });
                          }}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          className="input py-1 text-xs"
                          value={line.unit}
                          onChange={(e) => void updateLine(line, { unit: e.target.value as Unit })}
                        >
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          key={`${line.id}-qty-${line.quantity}`}
                          type="number"
                          min="0"
                          step="0.01"
                          className="input w-20 py-1 text-xs"
                          defaultValue={line.quantity}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== Number(line.quantity)) void updateLine(line, { quantity: v });
                          }}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          key={`${line.id}-price-${line.unit_price_net}`}
                          type="number"
                          min="0"
                          step="0.01"
                          className="input w-24 py-1 text-xs"
                          defaultValue={line.unit_price_net}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== Number(line.unit_price_net)) void updateLine(line, { unit_price_net: v });
                          }}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          key={`${line.id}-disc-${line.discount_pct}`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          className="input w-16 py-1 text-xs"
                          defaultValue={line.discount_pct}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== Number(line.discount_pct)) void updateLine(line, { discount_pct: v });
                          }}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          className="input w-20 py-1 text-xs"
                          value={String(line.vat_rate)}
                          onChange={(e) => void updateLine(line, { vat_rate: Number(e.target.value) as VatRate })}
                        >
                          {VAT_RATES.map((r) => (
                            <option key={r} value={r}>
                              {r}%
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2 font-medium">{money(c.gross)}</td>
                      <td className="py-2">
                        <button
                          type="button"
                          className="text-xs text-rose-600 hover:underline"
                          onClick={() => void deleteLine(line.id)}
                        >
                          Usuń
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-xs text-steel">
          {buckets.map((b) => (
            <p key={`b-${b.rate}`}>
              VAT {b.rate}%: netto {money(b.net)} · VAT {money(b.vat)} · brutto {money(b.gross)}
            </p>
          ))}
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3 text-sm sm:w-64">
          <div className="flex justify-between">
            <span className="text-steel">Netto</span>
            <span className="font-semibold">{money(totals.net)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-steel">VAT</span>
            <span className="font-semibold">{money(totals.vat)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-stone-200 pt-1 text-base">
            <span className="font-bold text-ink">Do zapłaty</span>
            <span className="font-bold text-moss">{money(totals.gross)}</span>
          </div>
        </div>
      </div>

      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-steel">Uwagi i paragon</p>
      <div className="-mt-2 grid gap-3">
        <label className="grid gap-1 text-xs font-semibold text-ink">
          <span className="flex flex-wrap items-center justify-between gap-2">
            Uwagi / opis na fakturze
            <button
              type="button"
              onClick={() => {
                const tag = "Sprzedaż udokumentowana paragonem fiskalnym.";
                setNotesDraft((prev) => {
                  if (prev.includes(tag)) return prev;
                  const base = prev.trim();
                  const next = base ? `${base}\n${tag}` : tag;
                  void patchHeader({ notes: next });
                  return next;
                });
              }}
              className="rounded-md border border-stone-300 bg-white px-2 py-0.5 text-[0.7rem] font-medium text-steel hover:bg-stone-50"
            >
              + dopisz „z paragonem"
            </button>
          </span>
          <textarea
            className="input min-h-[72px] font-normal"
            placeholder="np. Sprzedaż udokumentowana paragonem fiskalnym nr 123 / dziękujemy za zlecenie"
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={saveNotes}
          />
        </label>

        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 accent-moss"
            checked={invoice.with_receipt}
            onChange={(e) => void patchHeader({ with_receipt: e.target.checked })}
          />
          Do faktury wystawiono paragon fiskalny
        </label>

        {invoice.with_receipt && (
          <div className="grid min-w-0 gap-3 rounded-lg border border-stone-200 bg-white/70 p-3 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-ink">
              Data paragonu
              <DateInput
                className="font-normal"
                defaultValue={invoice.receipt_date || ""}
                onBlur={(e) => {
                  if (e.target.value !== (invoice.receipt_date || "")) void patchHeader({ receipt_date: e.target.value || null });
                }}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Kwota paragonu (zł)
              <input
                type="number"
                min="0"
                step="0.01"
                className="input font-normal"
                defaultValue={invoice.receipt_amount ?? ""}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  const next = raw === "" ? null : Number(raw);
                  if (next !== (invoice.receipt_amount ?? null)) void patchHeader({ receipt_amount: next });
                }}
              />
            </label>
          </div>
        )}

        {invoice.sent_at && (
          <p className="text-xs text-moss">
            Wysłano mailem: {new Date(invoice.sent_at).toLocaleString("pl-PL")}
            {invoice.sent_to ? ` → ${invoice.sent_to}` : ""}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={showDelete}
        title="Usunąć fakturę?"
        message={`Faktura ${invoice.number} oraz jej pozycje zostaną trwale usunięte.`}
        confirmLabel="Usuń fakturę"
        variant="danger"
        loading={busy}
        onConfirm={() => void deleteInvoice()}
        onCancel={() => setShowDelete(false)}
      />

      {showSend && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Wyślij fakturę mailem">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-panel sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-bold text-ink">Wyślij fakturę {invoice.number}</h3>
              <button type="button" onClick={() => setShowSend(false)} className="rounded-lg px-2 py-1 text-sm text-steel hover:bg-stone-100" aria-label="Zamknij">
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm text-steel">Załącznik PDF zostanie dołączony automatycznie.</p>

            <div className="mt-4 grid gap-3">
              <div className="grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-steel">Odbiorcy</p>
                <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${invoice.buyer_email ? "border-stone-200" : "border-stone-100 opacity-60"}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-moss"
                    checked={sendToBuyer}
                    disabled={!invoice.buyer_email}
                    onChange={(e) => setSendToBuyer(e.target.checked)}
                  />
                  <span className="text-ink">Klient</span>
                  <span className="ml-auto text-xs text-steel">{invoice.buyer_email || "brak e-mail nabywcy"}</span>
                </label>
                <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${accountantEmail ? "border-stone-200" : "border-stone-100 opacity-60"}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-moss"
                    checked={sendToAccountant}
                    disabled={!accountantEmail}
                    onChange={(e) => setSendToAccountant(e.target.checked)}
                  />
                  <span className="text-ink">Księgowa</span>
                  <span className="ml-auto text-xs text-steel">{accountantEmail || "ustaw w: Ustawienia → Firma"}</span>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-ink">
                  Dodatkowy adres (opcjonalnie)
                  <input
                    type="email"
                    className="input font-normal"
                    placeholder="np. biuro@ksiegowosc.pl"
                    value={extraEmail}
                    onChange={(e) => setExtraEmail(e.target.value)}
                  />
                </label>
              </div>

              <label className="grid gap-1 text-xs font-semibold text-ink">
                Temat
                <input className="input font-normal" value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Treść wiadomości
                <textarea className="input min-h-[140px] font-normal" value={sendMessage} onChange={(e) => setSendMessage(e.target.value)} />
              </label>
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => setShowSend(false)} disabled={sending}>
                Anuluj
              </Button>
              <Button type="button" variant="primary" onClick={() => void doSend()} disabled={sending || recipients.length === 0}>
                {sending ? "Wysyłanie…" : `Wyślij (${recipients.length})`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
