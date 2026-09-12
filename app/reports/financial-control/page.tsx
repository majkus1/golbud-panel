"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { DateInput } from "@/components/date-input";
import { ExpandableText } from "@/components/expandable-text";
import { InfoTip } from "@/components/info-tip";
import { canSeeFinances, canViewPayroll, useOrg } from "@/components/org-context";
import { showToast } from "@/components/toast";
import { downloadAuthenticatedPdf } from "@/lib/download-authenticated-pdf";
import {
  FINANCIAL_CONTROL_SECTIONS,
  type FinancialControlReportRow,
  SECTION_BY_ID,
  buildFinancialControlReport,
  formatFinancialMoney
} from "@/lib/financial-control-report";
import { currency, formatDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { warsawTodayIso } from "@/lib/warsaw-today";
import type {
  CaseRow,
  Crew,
  FinancialControlItem,
  FinancialControlSection,
  Payment
} from "@/lib/types";

type FormState = {
  id: string | null;
  section: FinancialControlSection;
  case_id: string;
  location: string;
  address: string;
  client_label: string;
  title: string;
  scope: string;
  amount: string;
  amount_label: string;
  payer: string;
  status_action: string;
  condition_label: string;
  phone: string;
  term_label: string;
  crew_label: string;
  notes: string;
};

const emptyForm: FormState = {
  id: null,
  section: "confirmed_receivable",
  case_id: "",
  location: "",
  address: "",
  client_label: "",
  title: "",
  scope: "",
  amount: "",
  amount_label: "",
  payer: "",
  status_action: "",
  condition_label: "",
  phone: "",
  term_label: "",
  crew_label: "",
  notes: ""
};

const FINANCIAL_CONTROL_HELP = {
  asOfDate: "Ustawia historyczny stan raportu. Pozycje utworzone później oraz płatności jeszcze wtedy niewymagalne nie są uwzględniane. Ta sama data trafia do PDF.",
  confirmed: "Niezapłacone, wymagalne pozycje z harmonogramu oraz ręcznie potwierdzone kwoty oczekujące na zapłatę lub odbiór.",
  potential: "Kwoty zależne od decyzji klienta, rozszerzenia zakresu albo spełnienia warunku. Nie są jeszcze pewnym przychodem.",
  cash: "Pozycje oznaczone do odbioru gotówką lub poza standardowym przelewem bankowym.",
  disputes: "Liczba aktywnych pozycji spornych, sądowych albo wymagających dodatkowej dokumentacji.",
  completion: "Kwoty możliwe do odebrania dopiero po dokończeniu prac, odbiorze lub rozliczeniu końcowym.",
  scheduled: "Liczba podpisanych albo zaplanowanych budów wymagających kontroli terminu, zakresu lub wejścia ekipy."
} as const;

function toInputDateLabel(value: string | null): string {
  return value ? formatDate(value) : "";
}

function cleanNumber(value: string): number | null {
  const raw = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function autoBadge(source: FinancialControlReportRow["source"]) {
  if (source === "payment") return "z płatności";
  if (source === "case") return "ze sprawy";
  return "ręcznie";
}

export default function FinancialControlPage() {
  return (
    <AuthGate>
      {(session) => (
        <AppShell>
          <FinancialControlInner userId={session.user.id} />
        </AppShell>
      )}
    </AuthGate>
  );
}

function FinancialControlInner({ userId }: { userId: string }) {
  const { organizationId, role } = useOrg();
  const [asOfDate, setAsOfDate] = useState(warsawTodayIso());
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [items, setItems] = useState<FinancialControlItem[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);

  const canUse = canSeeFinances(role);
  const showPayroll = canViewPayroll(role);

  const load = useCallback(async () => {
    if (!organizationId || !canUse) return;
    setLoading(true);
    setLoadError("");
    const [caseRes, paymentRes, itemRes, crewRes] = await Promise.all([
      supabase.from("case_records").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      supabase.from("payments").select("*").eq("organization_id", organizationId),
      supabase
        .from("financial_control_items")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("active", true)
        .order("section")
        .order("sort_order"),
      supabase.from("crews").select("*").eq("organization_id", organizationId).order("name")
    ]);

    if (itemRes.error) {
      const missing = itemRes.error.message.includes("financial_control_items") || itemRes.error.code === "42P01";
      setLoadError(
        missing
          ? "Brakuje tabeli rejestru. Uruchom migrację 0034_financial_control_items.sql w Supabase."
          : itemRes.error.message
      );
    }

    setCases((caseRes.data || []) as CaseRow[]);
    setPayments((paymentRes.data || []) as Payment[]);
    setItems((itemRes.data || []) as FinancialControlItem[]);
    setCrews((crewRes.data || []) as Crew[]);
    setLoading(false);
  }, [organizationId, canUse]);

  useEffect(() => {
    void load();
  }, [load]);

  const report = useMemo(
    () => buildFinancialControlReport({ asOfDate, cases, payments, items, crews, includeEmployeeSettlements: showPayroll }),
    [asOfDate, cases, payments, items, crews, showPayroll]
  );

  const caseById = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases]);
  const crewById = useMemo(() => new Map(crews.map((c) => [c.id, c.name])), [crews]);

  const resetForm = () => setForm(emptyForm);

  const fillCase = (caseId: string) => {
    const c = caseById.get(caseId);
    setForm((prev) => ({
      ...prev,
      case_id: caseId,
      location: prev.location || c?.location || c?.client_name || "",
      address: prev.address || c?.location || "",
      client_label: prev.client_label || c?.client_name || "",
      phone: prev.phone || c?.phone || "",
      scope: prev.scope || c?.work_description || "",
      term_label: prev.term_label || toInputDateLabel(c?.realization_end_date ?? c?.next_contact_date ?? null),
      crew_label: prev.crew_label || (c?.crew_id ? crewById.get(c.crew_id) ?? "" : "")
    }));
  };

  const editItem = (item: FinancialControlItem) => {
    setForm({
      id: item.id,
      section: item.section,
      case_id: item.case_id ?? "",
      location: item.location ?? "",
      address: item.address ?? "",
      client_label: item.client_label ?? "",
      title: item.title ?? "",
      scope: item.scope ?? "",
      amount: item.amount == null ? "" : String(item.amount),
      amount_label: item.amount_label ?? "",
      payer: item.payer ?? "",
      status_action: item.status_action ?? "",
      condition_label: item.condition_label ?? "",
      phone: item.phone ?? "",
      term_label: item.term_label ?? "",
      crew_label: item.crew_label ?? "",
      notes: item.notes ?? ""
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!organizationId) return;
    if (!form.location.trim() && !form.case_id) {
      showToast("Podaj lokalizację albo wybierz sprawę.", "error");
      return;
    }
    setSaving(true);
    const amount = cleanNumber(form.amount);
    const selectedCase = form.case_id ? caseById.get(form.case_id) : null;
    const payload = {
      organization_id: organizationId,
      case_id: form.case_id || null,
      section: form.section,
      location: form.location.trim() || selectedCase?.location || selectedCase?.client_name || "",
      address: form.address.trim() || null,
      client_label: form.client_label.trim() || null,
      title: form.title.trim() || null,
      scope: form.scope.trim() || null,
      amount,
      amount_label: form.amount_label.trim() || null,
      payer: form.payer.trim() || null,
      status_action: form.status_action.trim() || null,
      condition_label: form.condition_label.trim() || null,
      phone: form.phone.trim() || null,
      term_label: form.term_label.trim() || null,
      crew_label: form.crew_label.trim() || null,
      notes: form.notes.trim() || null,
      created_by: userId
    };

    const res = form.id
      ? await supabase.from("financial_control_items").update(payload).eq("id", form.id)
      : await supabase.from("financial_control_items").insert({
          ...payload,
          sort_order: items.filter((i) => i.section === form.section).length + 1
        });

    setSaving(false);
    if (res.error) {
      showToast(res.error.message, "error");
      return;
    }
    showToast(form.id ? "Pozycja zaktualizowana" : "Pozycja dodana");
    resetForm();
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć pozycję z rejestru?")) return;
    const { error } = await supabase.from("financial_control_items").update({ active: false }).eq("id", id);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Pozycja usunięta");
    await load();
  };

  const downloadPdf = async () => {
    if (!organizationId) return;
    setPdfBusy(true);
    try {
      const qs = new URLSearchParams({ organizationId, asOfDate });
      const ok = await downloadAuthenticatedPdf(
        `/api/reports/financial-control/pdf?${qs.toString()}`,
        `golbud-rejestr-naleznosci-i-budow-${asOfDate}`
      );
      if (ok) showToast("Raport PDF pobrany");
    } finally {
      setPdfBusy(false);
    }
  };

  if (!organizationId) return null;

  if (!canUse) {
    return (
      <div className="rounded-lg bg-white p-6 shadow-panel">
        <h1 className="text-xl font-bold text-ink">Rejestr należności i budów</h1>
        <p className="mt-2 text-sm text-steel">Ten raport zawiera dane finansowe i jest dostępny tylko dla właściciela, biura i kierownika.</p>
      </div>
    );
  }

  const kpis = [
    { label: "Należności potwierdzone", value: formatFinancialMoney(report.confirmedTotal), tone: "bg-moss/10 text-moss", help: FINANCIAL_CONTROL_HELP.confirmed },
    { label: "Zakresy potencjalne", value: formatFinancialMoney(report.potentialTotal), tone: "bg-amber-50 text-amber-700", help: FINANCIAL_CONTROL_HELP.potential },
    { label: "Gotówka / poza przelewem", value: formatFinancialMoney(report.cashTotal), tone: "bg-emerald-50 text-emerald-700", help: FINANCIAL_CONTROL_HELP.cash },
    { label: "Spory", value: String(report.disputeCount), tone: "bg-rose-50 text-rose-700", help: FINANCIAL_CONTROL_HELP.disputes },
    { label: "Do odbioru po zakończeniu", value: formatFinancialMoney(report.completionTotal), tone: "bg-stone-100 text-ink", help: FINANCIAL_CONTROL_HELP.completion },
    { label: "Budowy do kontroli", value: String(report.scheduledCount), tone: "bg-sky-50 text-sky-700", help: FINANCIAL_CONTROL_HELP.scheduled }
  ];

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link href="/reports" className="text-sm font-semibold text-moss hover:underline">
            ← Raporty
          </Link>
          <p className="mt-3 text-sm font-semibold uppercase tracking-[0.18em] text-steel">Kontrola finansów i budów</p>
          <h1 className="mt-2 break-words text-2xl font-bold text-ink sm:text-3xl">Rejestr należności i harmonogram budów</h1>
          <p className="mt-1 max-w-3xl break-words text-sm leading-6 text-steel">
            Jeden raport właścicielski: należności, gotówka, spory, kwoty warunkowe, budowy do wykonania oraz fundament pod rozliczenia ekip i pracowników.
          </p>
        </div>
        <div className="grid min-w-0 gap-2 min-[420px]:grid-cols-2 lg:flex lg:items-end">
          <label className="grid gap-1 text-xs font-semibold text-steel">
            <span className="inline-flex items-center gap-2">
              Stan na dzień
              <InfoTip text={FINANCIAL_CONTROL_HELP.asOfDate} />
            </span>
            <DateInput value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="min-w-0" />
          </label>
          <button
            type="button"
            onClick={() => void downloadPdf()}
            disabled={pdfBusy || loading}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-60"
          >
            {pdfBusy ? "Generowanie..." : "Generuj PDF"}
          </button>
        </div>
      </div>

      {loadError && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p>}

      <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="min-w-0 rounded-lg bg-white p-4 shadow-panel">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <p className="min-w-0 break-words text-xs leading-5 text-steel">{k.label}</p>
              <InfoTip text={k.help} />
            </div>
            <p className={`mt-2 break-words rounded-md px-2 py-1 text-lg font-bold ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </section>

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-ink">{form.id ? "Edytuj pozycję" : "Dodaj pozycję kontrolną"}</h2>
              <p className="mt-1 break-words text-xs leading-5 text-steel">Ręczne pozycje uzupełniają dane z płatności i spraw.</p>
            </div>
            {form.id && (
              <button type="button" onClick={resetForm} className="rounded-md border border-stone-300 px-2 py-1 text-xs font-semibold text-steel hover:bg-stone-50">
                nowa
              </button>
            )}
          </div>

          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Sekcja raportu
              <select className="input font-normal" value={form.section} onChange={(e) => setForm((f) => ({ ...f, section: e.target.value as FinancialControlSection }))}>
                {FINANCIAL_CONTROL_SECTIONS.filter((s) => showPayroll || s.id !== "employee_settlement").map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number}. {s.shortTitle}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-semibold text-ink">
              Powiązana sprawa
              <select className="input font-normal" value={form.case_id} onChange={(e) => fillCase(e.target.value)}>
                <option value="">bez powiązania</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.client_name} {c.location ? `- ${c.location}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Lokalizacja
                <input className="input font-normal" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Adres / temat
                <input className="input font-normal" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Kwota
                <input className="input font-normal" inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="np. 49000" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Kwota opisowo
                <input className="input font-normal" value={form.amount_label} onChange={(e) => setForm((f) => ({ ...f, amount_label: e.target.value }))} placeholder="np. ok. 60 000 zł" />
              </label>
            </div>

            <label className="grid gap-1 text-xs font-semibold text-ink">
              Tytuł / zakres skrócony
              <input className="input font-normal" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </label>

            <label className="grid gap-1 text-xs font-semibold text-ink">
              Zakres / uwagi do budowy
              <textarea className="input min-h-[88px] font-normal" value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))} />
            </label>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Kto płaci / tryb
                <input className="input font-normal" value={form.payer} onChange={(e) => setForm((f) => ({ ...f, payer: e.target.value }))} placeholder="klient, fundusz, gotówka..." />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Status / działanie
                <input className="input font-normal" value={form.status_action} onChange={(e) => setForm((f) => ({ ...f, status_action: e.target.value }))} />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Warunek / termin odbioru
                <input className="input font-normal" value={form.condition_label} onChange={(e) => setForm((f) => ({ ...f, condition_label: e.target.value }))} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Termin
                <input className="input font-normal" value={form.term_label} onChange={(e) => setForm((f) => ({ ...f, term_label: e.target.value }))} placeholder="np. od sierpnia" />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Telefon
                <input className="input font-normal" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-ink">
                Ekipa / osoba
                <input className="input font-normal" value={form.crew_label} onChange={(e) => setForm((f) => ({ ...f, crew_label: e.target.value }))} placeholder="Olek, Iwan, Polacy..." />
              </label>
            </div>

            <label className="grid gap-1 text-xs font-semibold text-ink">
              Notatka wewnętrzna
              <textarea className="input min-h-[72px] font-normal" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>

            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading}
              className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:opacity-60"
            >
              {saving ? "Zapisywanie..." : form.id ? "Zapisz zmiany" : "Dodaj do rejestru"}
            </button>
          </div>
        </div>

        <div className="grid min-w-0 gap-4">
          {loading ? (
            <p className="rounded-lg bg-white p-5 text-sm text-steel shadow-panel">Wczytywanie rejestru...</p>
          ) : (
            report.sections.map((section) => (
              <ReportSection
                key={section.id}
                section={section}
                manualItems={items}
                onEdit={editItem}
                onRemove={(id) => void remove(id)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ReportSection({
  section,
  manualItems,
  onEdit,
  onRemove
}: {
  section: ReturnType<typeof buildFinancialControlReport>["sections"][number];
  manualItems: FinancialControlItem[];
  onEdit: (item: FinancialControlItem) => void;
  onRemove: (id: string) => void;
}) {
  const meta = SECTION_BY_ID.get(section.id);
  const itemById = new Map(manualItems.map((i) => [i.id, i]));

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-ink">
            {meta?.number}. {meta?.title}
          </h2>
          <p className="mt-1 break-words text-xs leading-5 text-steel">{meta?.description}</p>
        </div>
        <div className="shrink-0 rounded-md bg-stone-100 px-3 py-2 text-sm font-bold text-ink">
          {section.id === "dispute" || section.id === "scheduled_build" ? `${section.rows.length} pozycji` : currency.format(section.total)}
        </div>
      </div>

      {section.rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-stone-300 p-4 text-sm text-steel">Brak pozycji w tej sekcji.</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {section.rows.map((row) => {
            const item = row.itemId ? itemById.get(row.itemId) : null;
            return (
              <article key={row.id} className="min-w-0 rounded-lg border border-stone-200 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words font-bold text-ink">{row.location || row.clientLabel || "Pozycja"}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[0.68rem] font-bold ${row.source === "manual" ? "bg-moss/10 text-moss" : "bg-stone-100 text-steel"}`}>
                        {autoBadge(row.source)}
                      </span>
                    </div>
                    {/* Gdy brak adresu, w tym miejscu ląduje zakres prac — potrafi mieć kilkanaście wierszy. */}
                    <div className="mt-1">
                      <ExpandableText text={row.address || row.clientLabel || row.title || row.scope} lines={2} className="leading-6 text-steel" emptyLabel="" />
                    </div>
                  </div>
                  <div className="min-w-0 text-left lg:shrink-0 lg:text-right">
                    <p className="break-words text-base font-bold text-ink">{row.amountLabel || (row.amount != null ? currency.format(row.amount) : "bez kwoty")}</p>
                    <p className="break-words text-xs text-steel">{row.payer || row.termLabel || row.crewLabel}</p>
                  </div>
                </div>

                <div className="mt-3 grid min-w-0 gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
                  <Info label="Zakres" value={row.scope || row.title} />
                  <Info label="Status / działanie" value={row.statusAction} />
                  <Info label="Warunek / termin" value={row.conditionLabel || row.termLabel} />
                  <Info label="Ekipa / telefon" value={[row.crewLabel, row.phone].filter(Boolean).join(" · ")} />
                </div>
                {row.notes && (
                  <div className="mt-3 rounded-md bg-stone-50 px-3 py-2">
                    <ExpandableText text={row.notes} lines={3} className="leading-6 text-steel" />
                  </div>
                )}

                {item && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => onEdit(item)} className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50">
                      Edytuj
                    </button>
                    <button type="button" onClick={() => onRemove(item.id)} className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">
                      Usuń
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-stone-50 px-3 py-2">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-stone-400">{label}</p>
      <div className="mt-1">
        <ExpandableText text={value} lines={3} className="text-ink" />
      </div>
    </div>
  );
}
