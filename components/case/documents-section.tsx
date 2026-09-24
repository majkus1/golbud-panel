"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/use-confirm";
import { postAuthenticatedBlob } from "@/lib/authed-fetch";
import { uploadCaseAttachment } from "@/lib/case-attachments";
import { buildDocumentContext, findMissingFields } from "@/lib/document-context";
import { DOCUMENT_TEMPLATES, getDocumentTemplate, type DocumentCategory } from "@/lib/document-templates";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import { ORGANIZATION_OFFER_SELECT, sellerProfileFromOrganization } from "@/lib/organization-offer-profile";
import { supabase } from "@/lib/supabase";
import type { CaseRow, ExtraWork, OfferLine, OfferVariant, Payment } from "@/lib/types";
import { warsawTodayIso } from "@/lib/warsaw-today";

const GROUP_LABELS: Record<DocumentCategory, string> = {
  umowa: "Umowy",
  aneks: "Aneksy",
  protokół: "Protokoły",
  "wezwanie do zapłaty": "Wezwania do zapłaty",
  oświadczenie: "Oświadczenia i potwierdzenia"
};

/**
 * Generator dokumentów z wzorów GolBud. Zakładka Umowa pokazuje umowy i aneksy, sekcje
 * Dokumentacji — protokoły albo pozostałe wzory. Treść wypełnia się danymi sprawy, firmy
 * i wybranego wariantu wyceny; przed zapisem generator mówi, czego brakuje i gdzie to uzupełnić.
 * Gotowy PDF od razu trafia do sprawy (z oznaczeniem „z wzoru”).
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
  intro,
  variants = [],
  linesByVariant = {},
  defaultVariantId = null,
  extras = []
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
  variants?: OfferVariant[];
  linesByVariant?: Record<string, OfferLine[]>;
  defaultVariantId?: string | null;
  extras?: ExtraWork[];
}) {
  const categoriesKey = categories?.join("|") ?? "";
  const templates = useMemo(
    () => (categoriesKey ? DOCUMENT_TEMPLATES.filter((t) => categoriesKey.split("|").includes(t.category)) : DOCUMENT_TEMPLATES),
    [categoriesKey]
  );
  const { confirm, confirmDialog } = useConfirm();
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  const [variantId, setVariantId] = useState<string>(defaultVariantId || variants[0]?.id || "");
  const [title, setTitle] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [body, setBody] = useState("");
  const [bodyEdited, setBodyEdited] = useState(false);
  const [signatures, setSignatures] = useState("");
  const [partyBoxes, setPartyBoxes] = useState(false);
  const [busy, setBusy] = useState<null | "download" | "save">(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const template = useMemo(() => getDocumentTemplate(templateId), [templateId]);

  useEffect(() => {
    if (!variantId && (defaultVariantId || variants[0]?.id)) setVariantId(defaultVariantId || variants[0].id);
  }, [defaultVariantId, variants, variantId]);

  // Dane wykonawcy. `undefined` = jeszcze się ładują — wzór wypełniamy dopiero po ich załadowaniu,
  // inaczej pierwsza wersja miałaby puste dane firmy.
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

  const context = useMemo(
    () =>
      buildDocumentContext({
        caseRow,
        seller: seller ?? null,
        lines: template?.usesVariant ? linesByVariant[variantId] ?? [] : [],
        payments,
        extras,
        todayIso: warsawTodayIso()
      }),
    [caseRow, seller, template?.usesVariant, linesByVariant, variantId, payments, extras]
  );

  const missing = useMemo(() => (template ? findMissingFields(template.requires, context) : []), [template, context]);

  const fillFromTemplate = useCallback(() => {
    if (!template) return;
    setTitle(template.title);
    setBody(template.buildBody(context));
    setBodyEdited(false);
    setSignatures(template.signatures.join(" | "));
    setPartyBoxes(template.parties === "boxes");
    setDocNumber("");
    setErr("");
    setOk("");
  }, [template, context]);

  // Wypełnienie po załadowaniu danych firmy oraz przy zmianie wzoru lub wariantu.
  // Poprawionej ręcznie treści nie nadpisujemy bez pytania.
  const [filledFor, setFilledFor] = useState("");
  useEffect(() => {
    if (seller === undefined || !template) return;
    const key = `${template.id}|${template.usesVariant ? variantId : ""}|${caseRow?.id ?? ""}`;
    if (key === filledFor) return;
    setFilledFor(key);
    if (bodyEdited && filledFor) {
      void confirm({
        title: "Zastąpić poprawioną treść?",
        message: "Treść dokumentu była poprawiana ręcznie. Nowy wzór lub wariant wypełni ją od nowa i poprawki znikną.",
        confirmLabel: "Wypełnij od nowa",
        variant: "default"
      }).then((yes) => {
        if (yes) fillFromTemplate();
      });
      return;
    }
    fillFromTemplate();
  }, [seller, template, variantId, caseRow?.id, filledFor, bodyEdited, fillFromTemplate, confirm]);

  const buildPayload = () => ({
    title: title.trim() || template?.title || "DOKUMENT",
    body: body.trim(),
    docNumber: docNumber.trim() || null,
    templateId: template?.id ?? null,
    signatures: signatures
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean),
    showParties: partyBoxes
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

  const saveToCase = async () => {
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
    setOk(`Zapisano „${result.attachment.file_name}” w sprawie — jest na liście plików.`);
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
        <div className="grid gap-3 sm:grid-cols-2">
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
          {template?.usesVariant && (
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Wariant wyceny (stawki i kwoty)
              <select className="input font-normal" value={variantId} onChange={(e) => setVariantId(e.target.value)} disabled={variants.length === 0}>
                {variants.length === 0 && <option value="">— brak wariantów —</option>}
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({(linesByVariant[v.id] || []).length} poz.)
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {missing.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <p className="font-semibold">W dokumencie zostaną wielokropki — brakuje:</p>
            <ul className="mt-1 list-inside list-disc text-xs">
              {missing.map((m) => (
                <li key={m.field}>
                  {m.label} <span className="text-amber-700">— {m.where}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-amber-800">Uzupełnij dane i kliknij „wypełnij od nowa” albo dopisz je ręcznie w treści.</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-ink">
            Nazwa dokumentu (plik)
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
              onClick={fillFromTemplate}
              className="rounded-md border border-stone-300 bg-white px-2 py-0.5 text-[0.7rem] font-medium text-steel hover:bg-stone-50"
            >
              ↺ wypełnij od nowa
            </button>
          </span>
          <textarea
            className="input min-h-[360px] font-mono text-[0.8rem] font-normal leading-relaxed"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setBodyEdited(true);
            }}
            placeholder="Treść dokumentu…"
          />
        </label>
        <details className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-steel">
          <summary className="cursor-pointer font-semibold text-ink">Jak formatować treść</summary>
          <ul className="mt-2 grid gap-0.5 font-mono">
            <li># TYTUŁ — tytuł na środku</li>
            <li>§ 1 Przedmiot umowy — paragraf (numer i tytuł na środku)</li>
            <li>1. / a) / - — punkt listy; dwie spacje na początku = podpunkt</li>
            <li>[ ] tekst / [x] tekst — pole do zaznaczenia</li>
            <li>| Lp. | Nazwa | — tabela; wiersz | --- | --- | pod nagłówkiem</li>
            <li>{"<>"} tekst — na środku, {">>"} tekst — do prawej</li>
            <li>**tekst** — pogrubienie; ---strona--- — nowa strona</li>
            <li>[podpisy: INWESTOR | WYKONAWCA] — podpisy w tym miejscu</li>
          </ul>
        </details>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="grid gap-1 text-xs font-semibold text-ink">
            Podpisy na końcu (oddziel znakiem |, puste = bez podpisów)
            <input className="input font-normal" value={signatures} onChange={(e) => setSignatures(e.target.value)} placeholder="INWESTOR | WYKONAWCA" />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm font-medium text-ink">
            <input type="checkbox" className="h-4 w-4 accent-moss" checked={partyBoxes} onChange={(e) => setPartyBoxes(e.target.checked)} />
            Ramki stron nad treścią
          </label>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={saveToCase}
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
      {confirmDialog}
    </div>
  );
}
