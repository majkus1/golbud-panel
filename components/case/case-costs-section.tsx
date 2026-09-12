"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DateInput } from "@/components/date-input";
import { showToast } from "@/components/toast";
import { postAuthenticatedJson } from "@/lib/authed-fetch";
import { currency, formatDate, parseAmount } from "@/lib/format";
import { notify } from "@/lib/notify-client";
import { supabase } from "@/lib/supabase";
import { warsawTodayIso } from "@/lib/warsaw-today";
import type {
  Attachment,
  CaseDirectCost,
  CaseDirectCostType,
  SupplierInvoice,
  SupplierInvoiceCategory,
  SupplierInvoiceStatus
} from "@/lib/types";

const INVOICE_CATEGORIES: { id: SupplierInvoiceCategory; label: string }[] = [
  { id: "materialy", label: "Materiały" },
  { id: "robocizna", label: "Robocizna / usługi" },
  { id: "sprzet", label: "Sprzęt" },
  { id: "transport", label: "Transport" },
  { id: "podwykonawca", label: "Podwykonawca" },
  { id: "inne", label: "Inne" }
];

const DIRECT_COST_TYPES: { id: CaseDirectCostType; label: string }[] = [
  { id: "materialy", label: "Materiały" },
  { id: "robocizna", label: "Robocizna" },
  { id: "podwykonawcy", label: "Podwykonawcy" },
  { id: "transport", label: "Transport" },
  { id: "sprzet", label: "Sprzęt" },
  { id: "inne", label: "Inne" }
];

const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function statusFromAmounts(gross: number, paid: number): SupplierInvoiceStatus {
  if (paid >= gross && gross > 0) return "oplacona";
  if (paid > 0) return "czesciowo";
  return "nieoplacona";
}

function shouldAlertAmount(amount: number): boolean {
  return amount >= 2000;
}

function categoryLabel(value: string): string {
  return INVOICE_CATEGORIES.find((c) => c.id === value)?.label || DIRECT_COST_TYPES.find((c) => c.id === value)?.label || value;
}

export function CaseCostsSection({
  organizationId,
  caseId,
  userId,
  caseLabel,
  onChange
}: {
  organizationId: string;
  caseId: string;
  userId: string;
  caseLabel: string;
  onChange?: () => Promise<void> | void;
}) {
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [directCosts, setDirectCosts] = useState<CaseDirectCost[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [accountantEmail, setAccountantEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const [invoiceForm, setInvoiceForm] = useState({
    supplier_name: "",
    invoice_number: "",
    invoice_date: warsawTodayIso(),
    due_date: "",
    category: "materialy" as SupplierInvoiceCategory,
    net_total: "",
    gross_total: "",
    paid_amount: "",
    notes: ""
  });
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [directForm, setDirectForm] = useState({
    cost_type: "inne" as CaseDirectCostType,
    title: "",
    amount: "",
    cost_date: warsawTodayIso(),
    notes: ""
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [invoiceRes, directRes, attachmentRes, orgRes] = await Promise.all([
      supabase.from("supplier_invoices").select("*").eq("case_id", caseId).order("invoice_date", { ascending: false }),
      supabase.from("case_direct_costs").select("*").eq("case_id", caseId).order("cost_date", { ascending: false }),
      supabase.from("attachments").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
      supabase.from("organizations").select("accountant_email").eq("id", organizationId).maybeSingle()
    ]);
    if (invoiceRes.error) showToast(invoiceRes.error.message, "error");
    setInvoices((invoiceRes.data || []) as SupplierInvoice[]);
    setDirectCosts((directRes.data || []) as CaseDirectCost[]);
    setAttachments((attachmentRes.data || []) as Attachment[]);
    setAccountantEmail((orgRes.data?.accountant_email as string | null)?.trim() || "");
    setLoading(false);
  }, [caseId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const attachmentById = useMemo(() => new Map(attachments.map((a) => [a.id, a])), [attachments]);
  const totals = useMemo(() => {
    const invoiceGross = invoices.reduce((acc, i) => acc + Number(i.gross_total || 0), 0);
    const invoicePaid = invoices.reduce((acc, i) => acc + Number(i.paid_amount || 0), 0);
    const direct = directCosts.reduce((acc, c) => acc + Number(c.amount || 0), 0);
    return { invoiceGross, invoicePaid, direct, total: invoiceGross + direct, unpaid: Math.max(0, invoiceGross - invoicePaid) };
  }, [invoices, directCosts]);

  const uploadAttachment = async (): Promise<string | null> => {
    if (!invoiceFile) return null;
    if (invoiceFile.size > MAX_UPLOAD_BYTES) {
      showToast("Plik za duży (max 15 MB).", "error");
      return null;
    }
    if (!ALLOWED_MIME.has(invoiceFile.type)) {
      showToast("Dozwolone pliki: PDF, JPG, PNG, WebP.", "error");
      return null;
    }
    const safe = invoiceFile.name.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]+/g, "_").slice(0, 120);
    const path = `${organizationId}/${caseId}/${crypto.randomUUID()}_${safe}`;
    const { error: upErr } = await supabase.storage.from("case-attachments").upload(path, invoiceFile, {
      contentType: invoiceFile.type,
      upsert: false
    });
    if (upErr) {
      showToast(upErr.message, "error");
      return null;
    }
    const { data, error } = await supabase
      .from("attachments")
      .insert({
        organization_id: organizationId,
        case_id: caseId,
        storage_path: path,
        file_name: invoiceFile.name,
        mime_type: invoiceFile.type,
        size_bytes: invoiceFile.size,
        category: "materiały",
        description: `Faktura kosztowa: ${invoiceForm.supplier_name || invoiceFile.name}`,
        uploaded_by: userId
      })
      .select("id")
      .single();
    if (error) {
      showToast(error.message, "error");
      return null;
    }
    return data.id as string;
  };

  const saveInvoice = async () => {
    if (!invoiceForm.supplier_name.trim()) {
      showToast("Podaj dostawcę / hurtownię.", "error");
      return;
    }
    const gross = parseAmount(invoiceForm.gross_total);
    if (gross <= 0) {
      showToast("Podaj kwotę brutto.", "error");
      return;
    }
    setSaving(true);
    const attachmentId = await uploadAttachment();
    if (invoiceFile && !attachmentId) {
      setSaving(false);
      return;
    }
    const paid = parseAmount(invoiceForm.paid_amount);
    const { error } = await supabase.from("supplier_invoices").insert({
      organization_id: organizationId,
      case_id: caseId,
      supplier_name: invoiceForm.supplier_name.trim(),
      invoice_number: invoiceForm.invoice_number.trim() || null,
      invoice_date: invoiceForm.invoice_date,
      due_date: invoiceForm.due_date || null,
      category: invoiceForm.category,
      net_total: invoiceForm.net_total.trim() ? parseAmount(invoiceForm.net_total) : null,
      gross_total: gross,
      paid_amount: paid,
      status: statusFromAmounts(gross, paid),
      notes: invoiceForm.notes.trim() || null,
      attachment_id: attachmentId,
      created_by: userId
    });
    setSaving(false);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Faktura kosztowa dodana");
    if (shouldAlertAmount(gross) || paid < gross) {
      void notify({
        type: "financial_alert",
        organizationId,
        title: paid < gross ? "Nowa nieopłacona faktura kosztowa" : "Nowa duża faktura kosztowa",
        body: `${invoiceForm.supplier_name.trim()}: ${currency.format(gross)} · ${caseLabel}`,
        href: `/cases/${caseId}?tab=costs`,
        entityId: caseId
      });
    }
    setInvoiceForm((f) => ({ ...f, supplier_name: "", invoice_number: "", net_total: "", gross_total: "", paid_amount: "", notes: "" }));
    setInvoiceFile(null);
    await load();
    await onChange?.();
  };

  const saveDirectCost = async () => {
    const amount = parseAmount(directForm.amount);
    if (!directForm.title.trim() || amount <= 0) {
      showToast("Podaj nazwę kosztu i kwotę.", "error");
      return;
    }
    const { error } = await supabase.from("case_direct_costs").insert({
      organization_id: organizationId,
      case_id: caseId,
      cost_type: directForm.cost_type,
      title: directForm.title.trim(),
      amount,
      cost_date: directForm.cost_date,
      notes: directForm.notes.trim() || null,
      created_by: userId
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Koszt bezpośredni dodany");
    if (shouldAlertAmount(amount)) {
      void notify({
        type: "financial_alert",
        organizationId,
        title: "Nowy duży koszt budowy",
        body: `${directForm.title.trim()}: ${currency.format(amount)} · ${caseLabel}`,
        href: `/cases/${caseId}?tab=costs`,
        entityId: caseId
      });
    }
    setDirectForm((f) => ({ ...f, title: "", amount: "", notes: "" }));
    await load();
  };

  const sendToAccountant = async (invoice: SupplierInvoice) => {
    setSendingId(invoice.id);
    const res = await postAuthenticatedJson(`/api/cases/${caseId}/supplier-invoices/${invoice.id}/send`, {
      recipients: accountantEmail ? [accountantEmail] : undefined
    });
    setSendingId(null);
    if (!res.ok) {
      showToast(res.error, "error");
      return;
    }
    showToast("Wysłano fakturę kosztową do księgowej");
    await load();
  };

  const openAttachment = async (attachmentId: string | null | undefined) => {
    if (!attachmentId) return;
    const a = attachmentById.get(attachmentId);
    if (!a) return;
    const { data, error } = await supabase.storage.from("case-attachments").createSignedUrl(a.storage_path, 3600);
    if (error || !data?.signedUrl) {
      showToast(error?.message || "Nie udało się otworzyć pliku", "error");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="grid min-w-0 gap-4">
      <div className="rounded-lg bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink">Koszty budowy i faktury hurtowni</h2>
            <p className="mt-1 max-w-3xl text-sm text-steel">
              Faktury zakupowe, skany do księgowej i szybkie koszty przypisane bezpośrednio do tego zlecenia.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:min-w-[520px]">
            <Kpi label="Faktury" value={currency.format(totals.invoiceGross)} />
            <Kpi label="Zapłacono" value={currency.format(totals.invoicePaid)} />
            <Kpi label="Do zapłaty" value={currency.format(totals.unpaid)} tone={totals.unpaid > 0 ? "text-amber-700" : "text-emerald-700"} />
            <Kpi label="Razem koszty" value={currency.format(totals.total)} />
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(320px,440px)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-4">
          <Panel title="Dodaj fakturę kosztową" hint="Hurtownia, transport, sprzęt, usługa lub faktura podwykonawcy. Opcjonalnie dodaj PDF/skan.">
            <input className="input text-sm" placeholder="Hurtownia / dostawca" value={invoiceForm.supplier_name} onChange={(e) => setInvoiceForm((f) => ({ ...f, supplier_name: e.target.value }))} />
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input text-sm" placeholder="Numer faktury" value={invoiceForm.invoice_number} onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_number: e.target.value }))} />
              <select className="input text-sm" value={invoiceForm.category} onChange={(e) => setInvoiceForm((f) => ({ ...f, category: e.target.value as SupplierInvoiceCategory }))}>
                {INVOICE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <DateInput className="text-sm" value={invoiceForm.invoice_date} onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_date: e.target.value }))} />
              <DateInput className="text-sm" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm((f) => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="input text-sm" placeholder="Netto" inputMode="decimal" value={invoiceForm.net_total} onChange={(e) => setInvoiceForm((f) => ({ ...f, net_total: e.target.value }))} />
              <input className="input text-sm" placeholder="Brutto" inputMode="decimal" value={invoiceForm.gross_total} onChange={(e) => setInvoiceForm((f) => ({ ...f, gross_total: e.target.value }))} />
              <input className="input text-sm" placeholder="Zapłacono" inputMode="decimal" value={invoiceForm.paid_amount} onChange={(e) => setInvoiceForm((f) => ({ ...f, paid_amount: e.target.value }))} />
            </div>
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Skan/PDF faktury
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="block w-full text-xs text-steel file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-ink hover:file:bg-stone-200"
                onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
              />
              {invoiceFile ? <span className="font-normal text-steel">{invoiceFile.name}</span> : null}
            </label>
            <textarea className="input min-h-[70px] text-sm" placeholder="Uwagi dla firmy / księgowości" value={invoiceForm.notes} onChange={(e) => setInvoiceForm((f) => ({ ...f, notes: e.target.value }))} />
            <button type="button" onClick={() => void saveInvoice()} disabled={saving} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-60">
              {saving ? "Zapisywanie..." : "Dodaj fakturę"}
            </button>
          </Panel>

          <Panel title="Koszt bez faktury" hint="Paliwo, wynajem, transport, drobne zakupy lub inny koszt, który ma wejść do rentowności.">
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="input text-sm" value={directForm.cost_type} onChange={(e) => setDirectForm((f) => ({ ...f, cost_type: e.target.value as CaseDirectCostType }))}>
                {DIRECT_COST_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <DateInput className="text-sm" value={directForm.cost_date} onChange={(e) => setDirectForm((f) => ({ ...f, cost_date: e.target.value }))} />
            </div>
            <input className="input text-sm" placeholder="Nazwa kosztu" value={directForm.title} onChange={(e) => setDirectForm((f) => ({ ...f, title: e.target.value }))} />
            <input className="input text-sm" placeholder="Kwota" inputMode="decimal" value={directForm.amount} onChange={(e) => setDirectForm((f) => ({ ...f, amount: e.target.value }))} />
            <textarea className="input min-h-[64px] text-sm" placeholder="Uwagi" value={directForm.notes} onChange={(e) => setDirectForm((f) => ({ ...f, notes: e.target.value }))} />
            <button type="button" onClick={() => void saveDirectCost()} className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink">
              Dodaj koszt
            </button>
          </Panel>
        </div>

        <div className="grid min-w-0 gap-4">
          <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-base font-bold text-ink">Faktury kosztowe przy zleceniu</h3>
                <p className="text-xs text-steel">Wyślij pojedynczą fakturę do księgowej albo otwórz podpięty skan.</p>
              </div>
              {/* Adres pochodzi z Ustawień firmy — mówimy to wprost, żeby nie wyglądał na wpisany na sztywno. */}
              <p className="text-xs text-steel">
                {accountantEmail ? (
                  <>
                    Księgowa: <span className="font-semibold text-ink">{accountantEmail}</span>
                    <span className="text-stone-400"> · z Ustawienia → Firma</span>
                  </>
                ) : (
                  "Adres księgowej: ustaw w Ustawienia → Firma"
                )}
              </p>
            </div>
            {loading ? (
              <p className="mt-4 text-sm text-steel">Wczytywanie...</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="text-xs uppercase text-steel">
                    <tr>
                      <th className="py-2 pr-3 text-left">Dostawca</th>
                      <th className="py-2 pr-3 text-left">Kategoria</th>
                      <th className="py-2 pr-3 text-right">Brutto</th>
                      <th className="py-2 pr-3 text-right">Do zapłaty</th>
                      <th className="py-2 pr-3 text-left">Termin</th>
                      <th className="py-2 text-right">Akcje</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {invoices.map((i) => {
                      const attachment = attachmentById.get(i.attachment_id || "");
                      const left = Math.max(0, Number(i.gross_total || 0) - Number(i.paid_amount || 0));
                      return (
                        <tr key={i.id}>
                          <td className="py-2 pr-3">
                            <p className="font-semibold text-ink">{i.supplier_name}</p>
                            <p className="text-xs text-steel">{i.invoice_number || "bez numeru"} · {formatDate(i.invoice_date)}</p>
                            {i.sent_at ? <p className="text-[0.68rem] font-semibold text-emerald-700">wysłano: {formatDate(i.sent_at.slice(0, 10))}</p> : null}
                          </td>
                          <td className="py-2 pr-3">{categoryLabel(i.category)}</td>
                          <td className="py-2 pr-3 text-right font-semibold">{currency.format(Number(i.gross_total || 0))}</td>
                          <td className={`py-2 pr-3 text-right font-bold ${left > 0 ? "text-amber-700" : "text-emerald-700"}`}>{currency.format(left)}</td>
                          <td className="py-2 pr-3">{i.due_date ? formatDate(i.due_date) : "brak"}</td>
                          <td className="py-2">
                            <div className="flex justify-end gap-2">
                              <button type="button" disabled={!attachment} onClick={() => void openAttachment(i.attachment_id)} className="rounded-md border border-stone-300 px-2 py-1 text-xs font-semibold text-ink hover:bg-stone-50 disabled:opacity-40">
                                Plik
                              </button>
                              <button type="button" disabled={!accountantEmail || sendingId === i.id} onClick={() => void sendToAccountant(i)} className="rounded-md bg-ink px-2 py-1 text-xs font-semibold text-white hover:bg-moss disabled:opacity-40">
                                {sendingId === i.id ? "Wysyłka..." : "Do księgowej"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {invoices.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-steel">Brak faktur kosztowych przy tej sprawie.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
            <h3 className="text-base font-bold text-ink">Koszty bezpośrednie</h3>
            <div className="mt-3 grid gap-2">
              {directCosts.map((c) => (
                <div key={c.id} className="flex flex-col gap-2 rounded-lg border border-stone-200 p-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{c.title}</p>
                    <p className="text-xs text-steel">{categoryLabel(c.cost_type)} · {formatDate(c.cost_date)}</p>
                    {c.notes ? <p className="mt-1 text-xs text-steel">{c.notes}</p> : null}
                  </div>
                  <p className="shrink-0 font-bold text-ink">{currency.format(Number(c.amount || 0))}</p>
                </div>
              ))}
              {directCosts.length === 0 && <p className="rounded-lg border border-dashed border-stone-300 p-5 text-center text-sm text-steel">Brak kosztów bezpośrednich.</p>}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-steel">{label}</p>
      <p className={`mt-1 text-sm font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div>
        <h3 className="text-base font-bold text-ink">{title}</h3>
        <p className="mt-1 text-xs text-steel">{hint}</p>
      </div>
      {children}
    </section>
  );
}
