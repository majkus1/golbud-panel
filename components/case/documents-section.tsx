"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { postAuthenticatedBlob } from "@/lib/authed-fetch";
import { uploadCaseAttachment } from "@/lib/case-attachments";
import { DOCUMENT_TEMPLATES, getDocumentTemplate, type DocumentCategory } from "@/lib/document-templates";
import { formatDate, formatMoney, isDue } from "@/lib/format";
import { describeNetGross, formatPlMoney, grossFromNet } from "@/lib/money-vat";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import { ORGANIZATION_OFFER_SELECT, sellerProfileFromOrganization } from "@/lib/organization-offer-profile";
import { supabase } from "@/lib/supabase";
import type { CaseRow, Payment } from "@/lib/types";

const GROUP_LABELS: Record<DocumentCategory, string> = {
  umowa: "Umowy",
  aneks: "Aneksy",
  protokół: "Protokoły",
  "wezwanie do zapłaty": "Wezwania do zapłaty",
  oświadczenie: "Oświadczenia i potwierdzenia"
};

/**
 * Generator dokumentów z wzorów. Zakładka Umowa pokazuje tylko umowy i aneksy, sekcje
 * Dokumentacji — protokoły albo pozostałe wzory. Gotowy PDF od razu trafia do sprawy
 * (z oznaczeniem „z wzoru”), pobranie bez zapisu jest opcją dodatkową.
 */
export function DocumentsSection({
  caseId,
  organizationId,
  userId,
  caseRow,
  payments,
  onChange,
  categories,
  heading = "Dokument z wzoru",
  intro
}: {
  caseId: string;
  organizationId: string;
  userId: string;
  caseRow: CaseRow | null;
  payments: Payment[];
  onChange: () => Promise<void>;
  /** Grupy wzorów do wyboru; bez tego — wszystkie. */
  categories?: DocumentCategory[];
  heading?: string;
  intro?: string;
}) {
  const templates = useMemo(
    () => (categories ? DOCUMENT_TEMPLATES.filter((t) => categories.includes(t.category)) : DOCUMENT_TEMPLATES),
    [categories]
  );
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [body, setBody] = useState("");
  const [signLeft, setSignLeft] = useState("");
  const [signRight, setSignRight] = useState("");
  const [showParties, setShowParties] = useState(true);
  const [showSignatures, setShowSignatures] = useState(true);
  const [busy, setBusy] = useState<null | "download" | "save">(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const template = useMemo(() => getDocumentTemplate(templateId), [templateId]);

  // Dane wykonawcy do treści dokumentów. `undefined` = jeszcze się ładują; szablon
  // wstawiamy dopiero po załadowaniu, inaczej pierwsza wersja miałaby puste pola
  // administratora danych i wykonawcy — tak właśnie wyglądały dokumenty do tej pory.
  const [seller, setSeller] = useState<OfferSellerProfile | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("organizations")
      .select(ORGANIZATION_OFFER_SELECT)
      .eq("id", organizationId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setSeller(sellerProfileFromOrganization(data));
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const applyTemplate = useCallback(
    (id: string) => {
      const tpl = getDocumentTemplate(id);
      if (!tpl) return;
      // Pole w sprawie to „szacowana wartość netto” — brutto liczymy ze stawki VAT firmy,
      // żeby dokument nie podpisywał kwoty netto jako brutto.
      const vatRate = seller?.defaultVatRate ?? 23;
      const netValue = caseRow?.estimated_value ? Number(caseRow.estimated_value) : null;
      const valueNet = netValue ? formatPlMoney(netValue) : "";
      const valueGross = netValue ? formatPlMoney(grossFromNet(netValue, vatRate).gross) : "";
      const valueDescription = describeNetGross(netValue, vatRate);
      const endDate = caseRow?.realization_end_date ? formatDate(caseRow.realization_end_date) : "";
      const sellerAddress = [seller?.addressLine, seller?.postalCity].filter((part) => part && part.trim()).join(", ");
      const unpaidPayments = payments
        .map((payment) => ({
          payment,
          balance: Math.max(0, Number(payment.amount_due || 0) - Number(payment.amount_paid || 0))
        }))
        .filter(({ balance }) => balance > 0);
      const overduePayments = unpaidPayments.filter(({ payment }) => isDue(payment.due_date));
      const debtRows = overduePayments.length > 0 ? overduePayments : unpaidPayments;
      const debtTotal = debtRows.reduce((sum, row) => sum + row.balance, 0);
      const overduePaymentSummary = debtRows
        .map(({ payment, balance }) => {
          const due = payment.due_date ? `, termin ${formatDate(payment.due_date)}` : "";
          return `${payment.title}${due}: ${formatMoney(balance)}`;
        })
        .join("; ");
      const ctx = {
        clientName: caseRow?.client_name || "",
        clientAddress: caseRow?.location || "",
        clientPhone: caseRow?.phone || "",
        clientEmail: caseRow?.email || "",
        scope: caseRow?.work_description || "",
        todayPl: new Date().toLocaleDateString("pl-PL"),
        valueGross,
        valueNet,
        valueDescription,
        startDate: "",
        endDate,
        debtAmount: debtTotal > 0 ? formatMoney(debtTotal) : "",
        overduePaymentSummary,
        sellerLegalName: seller?.legalName ?? "",
        sellerNip: seller?.nip ?? "",
        sellerAddress,
        sellerPhone: seller?.phone ?? ""
      };
      setTitle(tpl.title);
      setBody(tpl.buildBody(ctx));
      setSignLeft(tpl.signLeft);
      setSignRight(tpl.signRight);
      setShowParties(tpl.showParties);
      setShowSignatures(tpl.showSignatures);
      setDocNumber("");
      setErr("");
      setOk("");
    },
    [caseRow, payments, seller]
  );

  useEffect(() => {
    // Czekamy na dane wykonawcy — wypełnienie szablonu przed ich załadowaniem dałoby
    // dokument z pustymi polami, a ponowne wypełnienie skasowałoby edycję użytkownika.
    if (templateId && seller !== undefined) applyTemplate(templateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, caseRow?.id, seller]);

  const buildPayload = () => ({
    title: title.trim(),
    body: body.trim(),
    docNumber: docNumber.trim() || null,
    showParties,
    showSignatures,
    signLeft: signLeft.trim(),
    signRight: signRight.trim()
  });

  const fileBase = () => {
    const base = `${title || "dokument"}_${caseRow?.client_name || ""}`;
    return base.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]+/g, "_").slice(0, 90).trim() || "dokument";
  };

  const download = async () => {
    if (!body.trim()) {
      setErr("Treść dokumentu jest pusta.");
      return;
    }
    setBusy("download");
    setErr("");
    setOk("");
    const res = await postAuthenticatedBlob(`/api/cases/${caseId}/document/pdf`, buildPayload());
    if (!res.ok) {
      setErr(res.error);
      setBusy(null);
      return;
    }
    const url = URL.createObjectURL(res.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBase()}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setBusy(null);
  };

  const saveToAttachments = async () => {
    if (!body.trim()) {
      setErr("Treść dokumentu jest pusta.");
      return;
    }
    setBusy("save");
    setErr("");
    setOk("");
    const res = await postAuthenticatedBlob(`/api/cases/${caseId}/document/pdf`, buildPayload());
    if (!res.ok) {
      setErr(res.error);
      setBusy(null);
      return;
    }
    const result = await uploadCaseAttachment(supabase, {
      organizationId,
      caseId,
      userId,
      file: res.blob,
      fileName: `${fileBase()}.pdf`,
      mimeType: "application/pdf",
      category: template?.category ?? "umowa",
      source: "generated",
      templateId: template?.id ?? null
    });
    if (!result.ok) {
      setErr(result.error);
      setBusy(null);
      return;
    }
    setOk(`Zapisano „${result.attachment.file_name}” w sprawie — jest na liście poniżej.`);
    setBusy(null);
    await onChange();
  };

  const groups = (Object.keys(GROUP_LABELS) as DocumentCategory[])
    .map((category) => ({ category, items: templates.filter((t) => t.category === category) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="min-w-0">
      <h3 className="text-base font-bold text-ink">{heading}</h3>
      <p className="mt-1 text-xs text-steel">
        {intro ?? "Wybierz wzór, sprawdź treść uzupełnioną danymi sprawy i zapisz PDF w sprawie."}
      </p>

      {err && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
      {ok && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</p>}

      <div className="mt-4 grid gap-4">
        <label className="grid gap-1 text-xs font-semibold text-ink">
          Wzór dokumentu
          <select className="input font-normal" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g.category} label={GROUP_LABELS[g.category]}>
                {g.items.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-ink">
            Tytuł na dokumencie
            <input className="input font-normal" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-ink">
            Numer dokumentu (opcjonalnie)
            <input className="input font-normal" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="np. UM/2026/0001" />
          </label>
        </div>

        <label className="grid gap-1 text-xs font-semibold text-ink">
          <span className="flex flex-wrap items-center justify-between gap-2">
            Treść dokumentu
            <button
              type="button"
              onClick={() => applyTemplate(templateId)}
              className="rounded-md border border-stone-300 bg-white px-2 py-0.5 text-[0.7rem] font-medium text-steel hover:bg-stone-50"
            >
              ↺ przywróć wzór
            </button>
          </span>
          <textarea
            className="input min-h-[320px] font-normal leading-relaxed"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Treść dokumentu…"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-ink">
            Podpis — lewa strona
            <input className="input font-normal" value={signLeft} onChange={(e) => setSignLeft(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-ink">
            Podpis — prawa strona
            <input className="input font-normal" value={signRight} onChange={(e) => setSignRight(e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap gap-4 text-sm font-medium text-ink">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-moss" checked={showParties} onChange={(e) => setShowParties(e.target.checked)} />
            Pokaż blok stron (Wykonawca / Zamawiający)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-moss" checked={showSignatures} onChange={(e) => setShowSignatures(e.target.checked)} />
            Pokaż miejsca na podpisy
          </label>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={saveToAttachments}
            disabled={busy !== null}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-60"
          >
            {busy === "save" ? "Zapisywanie…" : "Zapisz PDF w sprawie"}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={busy !== null}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-moss hover:bg-moss/10 disabled:opacity-60"
          >
            {busy === "download" ? "Generowanie…" : "Tylko pobierz"}
          </button>
        </div>
      </div>
    </div>
  );
}
