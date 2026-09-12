"use client";

import { DateInput } from "@/components/date-input";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiAssistantPanel } from "@/components/ai-assistant-panel";
import { CaseSubcontractorsPanel } from "@/components/case-subcontractors-panel";
import { AsBuiltEstimatesSection } from "@/components/case/as-built-estimates-section";
import { CaseCostsSection } from "@/components/case/case-costs-section";
import { CaseEmailsSection } from "@/components/case/case-emails-section";
import { EstimateImport } from "@/components/case/estimate-import";
import { TemplateApplyPanel } from "@/components/case/template-apply-panel";
import { InvoicesSection } from "@/components/case/invoices-section";
import { ProcessTimeline } from "@/components/case/process-timeline";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CaseActivityPreview } from "@/components/case-activity-preview";
import { CaseLeadBadge } from "@/components/case-lead-badge";
import { canManageOrg, canManageCaseTeam, canSeeFinances, canUseAssistant, isFieldRole, useOrg } from "@/components/org-context";
import { CaseTeamPicker } from "@/components/case-team-picker";
import { CaseAuthorLine } from "@/components/case-author-line";
import { fetchCrewMemberUserIds, notifyCaseAssignees, splitCaseAssignees, syncCaseAssignees } from "@/lib/case-assignees";
import { loadOrganizationMemberDirectory, memberDisplayName } from "@/lib/case-leads";
import { saveOfferLinesAsTemplate } from "@/lib/estimate-templates";
import { StatusBadge } from "@/components/status-badge";
import { TasksPanel } from "@/components/tasks-panel";
import { showToast } from "@/components/toast";
import { postAuthenticatedBlob } from "@/lib/authed-fetch";
import { DOCUMENT_TEMPLATES, getDocumentTemplate } from "@/lib/document-templates";
import { ATTACHMENT_CATEGORIES, MEMBER_ROLE_LABELS, PROTOCOL_TYPES, UNITS } from "@/lib/domain";
import { AS_BUILT_ESTIMATE_LABEL, AS_BUILT_ESTIMATE_TITLE } from "@/lib/as-built-estimate";
import { downloadAuthenticatedPdf } from "@/lib/download-authenticated-pdf";
import { formatDate, formatDateTime, formatMoney, isDue } from "@/lib/format";
import { describeNetGross, formatPlMoney, grossFromNet } from "@/lib/money-vat";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import { ORGANIZATION_OFFER_SELECT, sellerProfileFromOrganization } from "@/lib/organization-offer-profile";
import { supabase } from "@/lib/supabase";
import type {
  Attachment,
  AttachmentCategory,
  CaseAsBuiltEstimate,
  CaseAssigneeRow,
  CaseNote,
  CaseProtocol,
  CaseRow,
  CaseScheduleItem,
  CatalogItem,
  ExtraWork,
  OfferLine,
  OfferVariant,
  OrgMemberProfile,
  Payment,
  ProtocolType,
  Reminder,
  Unit
} from "@/lib/types";

type Tab =
  | "overview"
  | "offer"
  | "invoices"
  | "schedule"
  | "payments"
  | "costs"
  | "reminders"
  | "extras"
  | "protocols"
  | "documents"
  | "as-built"
  | "files"
  | "notes"
  | "emails"
  | "tasks"
  | "subcontractors"
  | "assistant";

const primaryTabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Przegląd" },
  { id: "offer", label: "Wycena / oferta" },
  { id: "invoices", label: "Faktury" },
  { id: "schedule", label: "Harmonogram" },
  { id: "payments", label: "Płatności" },
  { id: "costs", label: "Koszty" },
  { id: "assistant", label: "Asystent AI" },
  { id: "tasks", label: "Zadania" },
  { id: "emails", label: "Korespondencja" },
  { id: "notes", label: "Notatki" },
];

const secondaryTabs: { id: Tab; label: string }[] = [
  { id: "reminders", label: "Przypomnienia" },
  { id: "subcontractors", label: "Podwykonawcy" },
  { id: "extras", label: "Prace dodatkowe" },
  { id: "protocols", label: "Protokoły" },
  { id: "as-built", label: AS_BUILT_ESTIMATE_LABEL },
  { id: "documents", label: "Dokumenty" },
  { id: "files", label: "Pliki" },
];

const ALL_TAB_IDS = new Set<Tab>([...primaryTabs, ...secondaryTabs].map((t) => t.id));

/** Kompaktowe przyciski akcji — mobile first. */
// „Edytuj dane" to zwykła akcja pomocnicza, nie główne działanie na karcie — stąd wariant
// obrysowany zamiast wypełnionego. Ciemne tło zostawiamy aktywnej zakładce.
const btnCaseSecondary =
  "inline-flex shrink-0 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-moss/40 hover:bg-stone-50 sm:px-4 sm:py-2 sm:text-sm";
const btnCaseDanger =
  "inline-flex shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 sm:px-4 sm:py-2 sm:text-sm";
const btnSectionAdd =
  "shrink-0 rounded-lg bg-moss px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-ink sm:px-3 sm:py-2 sm:text-sm";
const tabScrollClass =
  "flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:flex-initial sm:flex-wrap sm:overflow-visible";
function tabBtnClass(active: boolean): string {
  return `shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition sm:rounded-lg sm:px-3 sm:py-2 sm:text-sm ${
    active ? "bg-ink text-white" : "bg-white text-steel ring-1 ring-stone-200 hover:bg-stone-50"
  }`;
}

/**
 * Zakładka Asystenta wyróżnia się akcentem bursztynowym, ale nieaktywna zachowuje się
 * jak pozostałe — ciemne tło zarezerwowane jest dla zakładki, na której faktycznie jesteśmy.
 */
function aiTabBtnClass(active: boolean): string {
  return `shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-black transition sm:rounded-lg sm:px-3 sm:py-2 sm:text-sm ${
    active
      ? "bg-ink text-white shadow-sm"
      : "bg-amberline/10 text-ink ring-1 ring-amberline/50 hover:bg-amberline/20"
  }`;
}

function parseTab(value: string | null): Tab {
  return value && ALL_TAB_IDS.has(value as Tab) ? (value as Tab) : "overview";
}

export function CaseDetailView({ organizationId, userId }: { organizationId: string; userId: string }) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const caseId = params.id;
  const { role } = useOrg();
  const showFinances = canSeeFinances(role);
  const canManage = canManageOrg(role);
  const canEditTeam = canManageCaseTeam(role);
  const fieldView = isFieldRole(role);
  const showAssistant = canUseAssistant(role);

  const visiblePrimaryTabs = useMemo(() => {
    return primaryTabs.filter((t) => {
      if (!showFinances && (t.id === "invoices" || t.id === "payments" || t.id === "costs")) return false;
      if (fieldView && (t.id === "offer" || t.id === "invoices" || t.id === "payments" || t.id === "costs")) return false;
      // Korespondencja z klientem to dana handlowa — role terenowe jej nie widzą.
      if (t.id === "emails" && fieldView) return false;
      if (t.id === "assistant" && !showAssistant) return false;
      return true;
    });
  }, [showFinances, fieldView, showAssistant]);
  const visibleSecondaryTabs = useMemo(() => {
    return secondaryTabs.filter((t) => {
      if (!showFinances && t.id === "reminders") return false;
      if (fieldView && ["reminders", "subcontractors", "extras", "documents", "as-built"].includes(t.id)) return false;
      return true;
    });
  }, [showFinances, fieldView]);
  const allowedTabIds = useMemo(
    () => new Set<Tab>([...visiblePrimaryTabs, ...visibleSecondaryTabs].map((t) => t.id)),
    [visiblePrimaryTabs, visibleSecondaryTabs]
  );

  const [tab, setTab] = useState<Tab>(() => parseTab(searchParams.get("tab")));
  const [showMore, setShowMore] = useState(false);

  // Synchronizacja aktywnej zakładki z adresem URL (?tab=...) — odświeżenie/udostępnienie linku zachowuje widok.
  const selectTab = useCallback(
    (next: Tab) => {
      setTab(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === "overview") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  // Zmiana zakładki z zewnątrz (np. przycisk wstecz przeglądarki) aktualizuje stan.
  useEffect(() => {
    const fromUrl = parseTab(searchParams.get("tab"));
    setTab((prev) => (prev === fromUrl ? prev : fromUrl));
  }, [searchParams]);

  // Rola bez dostępu do zakładki (np. faktury) → wróć do przeglądu.
  useEffect(() => {
    setTab((prev) => (allowedTabIds.has(prev) ? prev : "overview"));
  }, [allowedTabIds]);
  const moreRef = useRef<HTMLDivElement>(null);
  const [caseRow, setCaseRow] = useState<CaseRow | null>(null);
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [variants, setVariants] = useState<OfferVariant[]>([]);
  const [linesByVariant, setLinesByVariant] = useState<Record<string, OfferLine[]>>({});
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [schedule, setSchedule] = useState<CaseScheduleItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [extras, setExtras] = useState<ExtraWork[]>([]);
  const [protocols, setProtocols] = useState<CaseProtocol[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [asBuiltEstimates, setAsBuiltEstimates] = useState<CaseAsBuiltEstimate[]>([]);

  const [responsibleUserIds, setResponsibleUserIds] = useState<string[]>([]);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [members, setMembers] = useState<OrgMemberProfile[]>([]);
  const [editingTeam, setEditingTeam] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);

  const [selVariant, setSelVariant] = useState<string | null>(null);
  const [newVariantName, setNewVariantName] = useState("Wariant podstawowy");
  const [contractAdvancePct, setContractAdvancePct] = useState(30);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const load = useCallback(async () => {
    const [{ data: c }, { data: n }, { data: v }, { data: cat }, { data: sch }, { data: pay }, { data: rem }, { data: ex }, { data: pr }, { data: att }, { data: ab }, { data: ca }, directory] =
      await Promise.all([
        supabase.from("case_records").select("*").eq("id", caseId).maybeSingle(),
        supabase.from("case_notes").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
        supabase.from("offer_variants").select("*").eq("case_id", caseId).order("sort_order"),
        supabase.from("catalog_items").select("*").eq("organization_id", organizationId).order("sort_order"),
        supabase.from("case_schedule_items").select("*").eq("case_id", caseId).order("sort_order"),
        supabase.from("payments").select("*").eq("case_id", caseId).order("sort_order"),
        supabase.from("reminders").select("*").eq("case_id", caseId).order("remind_at"),
        supabase.from("extra_works").select("*").eq("case_id", caseId).order("work_date", { ascending: false }),
        supabase.from("case_protocols").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
        supabase.from("attachments").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
        supabase.from("case_as_built_estimates").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
        supabase.from("case_assignees").select("user_id, assignment_role").eq("case_id", caseId),
        loadOrganizationMemberDirectory(supabase, organizationId)
      ]);

    setCaseRow((c || null) as CaseRow | null);
    setNotes((n || []) as CaseNote[]);
    const vars = (v || []) as OfferVariant[];
    setVariants(vars);
    setCatalog((cat || []) as CatalogItem[]);
    setSchedule((sch || []) as CaseScheduleItem[]);
    setPayments((pay || []) as Payment[]);
    setReminders((rem || []) as Reminder[]);
    setExtras((ex || []) as ExtraWork[]);
    setProtocols((pr || []) as CaseProtocol[]);
    setAttachments((att || []) as Attachment[]);
    setAsBuiltEstimates((ab || []) as CaseAsBuiltEstimate[]);
    const team = splitCaseAssignees((ca || []) as CaseAssigneeRow[]);
    setResponsibleUserIds(team.responsibleUserIds);
    setAssignedUserIds(team.assignedUserIds);
    setMembers(directory);

    const map: Record<string, OfferLine[]> = {};
    for (const vr of vars) {
      const { data: ln } = await supabase.from("offer_lines").select("*").eq("variant_id", vr.id).order("sort_order");
      map[vr.id] = (ln || []) as OfferLine[];
    }
    setLinesByVariant(map);
    setSelVariant((prev) => {
      if (vars.length === 0) return null;
      if (prev && vars.some((v) => v.id === prev)) return prev;
      return vars[0].id;
    });
  }, [caseId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMore(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const saveTeam = async () => {
    setSavingTeam(true);
    const result = await syncCaseAssignees(supabase, caseId, {
      responsibleUserIds,
      assignedUserIds
    });
    if (!result.ok) {
      showToast(result.error, "error");
      setSavingTeam(false);
      return;
    }
    await notifyCaseAssignees(caseId, result.addedUserIds);
    showToast("Zapisano zespół sprawy");
    setEditingTeam(false);
    setSavingTeam(false);
    await load();
  };

  const assignCrewMembers = async () => {
    if (!caseRow?.crew_id) return;
    const { userIds, withoutAccountCount } = await fetchCrewMemberUserIds(supabase, organizationId, caseRow.crew_id);
    if (userIds.length === 0) {
      showToast(
        withoutAccountCount > 0
          ? `Ta ekipa ma ${withoutAccountCount} os., ale żadna nie ma konta systemowego`
          : "Ta ekipa nie ma jeszcze żadnych osób",
        "error"
      );
      return;
    }
    setAssignedUserIds((prev) => Array.from(new Set([...prev, ...userIds.filter((id) => !responsibleUserIds.includes(id))])));
    showToast(
      withoutAccountCount > 0
        ? `Dopisano ${userIds.length} os. z ekipy (${withoutAccountCount} os. bez konta pominięto). Zapisz zespół, aby utrwalić.`
        : `Dopisano ${userIds.length} os. z ekipy. Zapisz zespół, aby utrwalić.`
    );
  };

  const selectedLines = useMemo(() => (selVariant ? linesByVariant[selVariant] || [] : []), [linesByVariant, selVariant]);
  const laborSum = useMemo(() => selectedLines.filter((l) => l.section === "labor").reduce((s, l) => s + Number(l.line_total), 0), [selectedLines]);
  const matSum = useMemo(() => selectedLines.filter((l) => l.section === "material").reduce((s, l) => s + Number(l.line_total), 0), [selectedLines]);

  const overduePayments = useMemo(
    () =>
      payments.filter((p) => {
        if (!p.due_date || p.amount_paid >= p.amount_due) return false;
        return isDue(p.due_date);
      }),
    [payments]
  );

  const openOfferPdf = async () => {
    if (!selVariant) return;
    const v = variants.find((x) => x.id === selVariant);
    const base = (v?.name || "oferta").replace(/[^\w\s\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/g, "_").slice(0, 80);
    await downloadAuthenticatedPdf(`/api/cases/${caseId}/variants/${selVariant}/pdf`, `${base || "oferta"}.pdf`);
  };

  const openContractPdf = async () => {
    if (!selVariant) return;
    const pct = Math.min(100, Math.max(0, Number(contractAdvancePct) || 0));
    await downloadAuthenticatedPdf(
      `/api/cases/${caseId}/contract/pdf?variantId=${selVariant}&advancePct=${pct}`,
      "umowa.pdf"
    );
  };

  const addVariant = async () => {
    const name = newVariantName.trim() || "Nowy wariant";
    const maxSort = variants.reduce((m, v) => Math.max(m, v.sort_order), -1);
    const { data, error } = await supabase
      .from("offer_variants")
      .insert({
        organization_id: organizationId,
        case_id: caseId,
        name,
        sort_order: maxSort + 10
      })
      .select("id")
      .single();
    if (!error && data) {
      setNewVariantName("Wariant premium");
      setSelVariant(data.id);
      await load();
    }
  };

  const addLine = async (section: "labor" | "material") => {
    if (!selVariant) return;
    const maxSort = selectedLines.reduce((m, l) => Math.max(m, l.sort_order), -1);
    await supabase.from("offer_lines").insert({
      organization_id: organizationId,
      variant_id: selVariant,
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
    if (!selVariant) return;
    const maxSort = selectedLines.reduce((m, l) => Math.max(m, l.sort_order), -1);
    await supabase.from("offer_lines").insert({
      organization_id: organizationId,
      variant_id: selVariant,
      section: item.category === "labor" ? "labor" : "material",
      label: item.label,
      unit: item.default_unit,
      quantity: 1,
      unit_rate: item.suggested_rate ?? 0,
      sort_order: maxSort + 10
    });
    await load();
  };

  const updateLine = async (line: OfferLine, patch: Partial<Pick<OfferLine, "label" | "unit" | "quantity" | "unit_rate" | "section">>) => {
    const { error } = await supabase.from("offer_lines").update(patch).eq("id", line.id);
    if (error) { showToast("Nie udało się zapisać pozycji", "error"); return; }
    showToast("Zapisano");
    await load();
  };

  const deleteLine = async (id: string) => {
    const { error } = await supabase.from("offer_lines").delete().eq("id", id);
    if (error) { showToast("Nie udało się usunąć pozycji", "error"); return; }
    showToast("Usunięto pozycję");
    await load();
  };

  const saveVariantAsTemplate = async () => {
    if (!saveTemplateName.trim()) return;
    setSavingTemplate(true);
    const result = await saveOfferLinesAsTemplate(supabase, organizationId, userId, saveTemplateName, selectedLines);
    setSavingTemplate(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    showToast(`Zapisano szablon „${saveTemplateName.trim()}”`);
    setSaveTemplateOpen(false);
    setSaveTemplateName("");
  };

  const deleteCase = async () => {
    setDeleting(true);
    const { error } = await supabase.from("cases").delete().eq("id", caseId);
    setDeleting(false);
    if (!error) router.push("/cases");
  };

  const [noteDraft, setNoteDraft] = useState("");

  if (!caseRow) {
    return <p className="text-sm text-steel">Ładowanie sprawy...</p>;
  }

  return (
    <div className="grid min-w-0 max-w-full gap-4 sm:gap-6">
      <div className="flex min-w-0 flex-col gap-3 sm:gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-steel sm:text-sm">Karta sprawy</p>
          <h1 className="mt-1.5 truncate text-xl font-bold text-ink sm:mt-2 sm:text-3xl">{caseRow.client_name}</h1>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge status={caseRow.status} />
            <span className="text-xs font-semibold text-steel">Prowadzi:</span>
            <CaseLeadBadge userIds={responsibleUserIds} members={members} />
          </div>
          {/* „Kto założył sprawę” dało się dotąd odczytać wyłącznie z dziennika zmian.
              Autor jest zapisany przy samej sprawie, więc pokazujemy go wprost. */}
          <CaseAuthorLine createdBy={caseRow.created_by} createdAt={caseRow.created_at} members={members} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!fieldView && (
            <Link href={`/cases/${caseId}/edit`} className={btnCaseSecondary}>
              <span className="sm:hidden">Edytuj</span>
              <span className="hidden sm:inline">Edytuj dane</span>
            </Link>
          )}
          {canManage && (
            <button type="button" onClick={() => setShowDelete(true)} className={btnCaseDanger}>
              <span className="sm:hidden">Usuń</span>
              <span className="hidden sm:inline">Usuń sprawę</span>
            </button>
          )}
        </div>
      </div>

      <nav className="relative z-20 min-w-0 max-w-full border-b border-stone-200" aria-label="Sekcje sprawy">
        <div className="flex min-w-0 max-w-full items-center gap-1.5 pb-1 sm:flex-wrap sm:pb-2">
          <div className={tabScrollClass}>
            {visiblePrimaryTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTab(t.id)}
                className={t.id === "assistant" ? aiTabBtnClass(tab === t.id) : tabBtnClass(tab === t.id)}
              >
                {t.id === "assistant" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="rounded-md bg-amberline px-1.5 py-0.5 text-[0.65rem] font-black tracking-[0.12em] text-ink">AI</span>
                    GolBud AI
                  </span>
                ) : (
                  t.label
                )}
              </button>
            ))}
          </div>
          <div ref={moreRef} className="relative shrink-0">
            {(() => {
              const activeSecondary = visibleSecondaryTabs.find((t) => t.id === tab);
              return (
                <button
                  type="button"
                  onClick={() => setShowMore((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={showMore}
                  className={tabBtnClass(!!activeSecondary)}
                >
                  <span className="sm:hidden">{activeSecondary ? activeSecondary.label : "Więcej"}</span>
                  <span className="hidden sm:inline">
                    Więcej
                    {activeSecondary ? <span className="font-normal opacity-80">{`: ${activeSecondary.label}`}</span> : null}
                  </span>
                  <span className="ml-0.5 opacity-70 sm:ml-1">▾</span>
                </button>
              );
            })()}
            {showMore && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-44 rounded-lg border border-stone-200 bg-white shadow-lg sm:rounded-md">
                {visibleSecondaryTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      selectTab(t.id);
                      setShowMore(false);
                    }}
                    className={`block w-full px-3 py-2 text-left text-xs font-semibold first:rounded-t-lg last:rounded-b-lg sm:px-4 sm:py-2.5 sm:text-sm ${
                      tab === t.id ? "bg-ink text-white" : "text-ink hover:bg-stone-50"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </nav>

      {tab === "overview" && (
        <section className="grid min-w-0 gap-4 rounded-lg bg-white p-4 shadow-panel sm:p-5">
          <ProcessTimeline status={caseRow.status} embedded />

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h2 className="text-lg font-bold text-ink">Kontakt i lokalizacja</h2>
            <dl className="mt-3 grid gap-2 text-sm text-steel">
              <div>
                <dt className="font-semibold text-ink">Telefon</dt>
                <dd>{caseRow.phone || "—"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Email</dt>
                <dd>{caseRow.email || "—"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Lokalizacja</dt>
                <dd>{caseRow.location || "—"}</dd>
              </div>
              {!fieldView && (
                <div>
                  <dt className="font-semibold text-ink">Źródło</dt>
                  <dd>{caseRow.source}</dd>
                </div>
              )}
            </dl>
            </div>
            <div>
              <h2 className="text-lg font-bold text-ink">{fieldView ? "Terminy" : "Terminy i kwoty"}</h2>
              <dl className="mt-3 grid gap-2 text-sm text-steel">
                {!fieldView && (
                  <div>
                    <dt className="font-semibold text-ink">Kolejny kontakt</dt>
                    <dd className={isDue(caseRow.next_contact_date) ? "font-semibold text-amber-700" : ""}>
                      {formatDate(caseRow.next_contact_date)}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="font-semibold text-ink">Planowany koniec</dt>
                  <dd>{formatDate(caseRow.realization_end_date)}</dd>
                </div>
                {!fieldView && (
                  <div>
                    <dt className="font-semibold text-ink">Szacowana wartość</dt>
                    <dd>{formatMoney(caseRow.estimated_value)}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink">Zakres prac</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-steel">{caseRow.work_description}</p>
          </div>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-ink">Zespół sprawy</h2>
              {canEditTeam && (
                <div className="flex flex-wrap gap-2">
                  {!editingTeam ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditingTeam(true)}
                        className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-moss hover:text-moss"
                      >
                        Edytuj zespół
                      </button>
                      <Link
                        href={`/cases/${caseId}/edit`}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-moss hover:bg-moss/10"
                      >
                        Pełna edycja →
                      </Link>
                    </>
                  ) : (
                    <>
                      {caseRow.crew_id && (
                        <button
                          type="button"
                          onClick={() => void assignCrewMembers()}
                          className="rounded-lg border border-moss/40 bg-moss/10 px-3 py-1.5 text-xs font-semibold text-moss-dark hover:bg-moss/20"
                        >
                          Przypisz członków brygady
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTeam(false);
                          void load();
                        }}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-steel hover:bg-stone-50"
                      >
                        Anuluj
                      </button>
                      <button
                        type="button"
                        disabled={savingTeam}
                        onClick={() => void saveTeam()}
                        className="rounded-lg bg-moss px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink disabled:opacity-60"
                      >
                        {savingTeam ? "Zapis…" : "Zapisz zespół"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {editingTeam && canEditTeam ? (
              <CaseTeamPicker
                members={members}
                responsibleUserIds={responsibleUserIds}
                assignedUserIds={assignedUserIds}
                onResponsibleChange={setResponsibleUserIds}
                onAssignedChange={setAssignedUserIds}
              />
            ) : (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <CaseTeamChipList
                  title="Prowadzący"
                  hint="Prowadzą sprawę po stronie biura"
                  tone="sky"
                  userIds={responsibleUserIds}
                  members={members}
                />
                <CaseTeamChipList
                  title="Przypisani do realizacji"
                  hint="Widzą budowę na terenie — bez finansów"
                  tone="moss"
                  userIds={assignedUserIds}
                  members={members}
                />
              </div>
            )}
          </div>
          {!fieldView && overduePayments.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-900">Zaległe płatności</p>
              <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
                {overduePayments.map((p) => (
                  <li key={p.id}>
                    {p.title} — należność {formatMoney(p.amount_due)}, wpłacono {formatMoney(p.amount_paid)}, termin {formatDate(p.due_date)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {canManage && (
            <CaseActivityPreview caseId={caseId} organizationId={organizationId} />
          )}
        </section>
      )}

      {tab === "offer" && (
        <div className="grid min-w-0 gap-4">
          {/* KROK 1 — wybór / utworzenie wariantu */}
          <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">Krok 1 · Wariant</p>
            <h2 className="mt-0.5 text-base font-bold text-ink">Wybierz lub utwórz wariant oferty</h2>
            <p className="mt-0.5 text-xs text-steel">
              Wariant to jedna wersja wyceny (np. &quot;podstawowy&quot;, &quot;premium&quot;). Możesz mieć kilka i wygenerować z nich osobne PDF-y.
            </p>

            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-sm font-semibold text-ink">
                Aktywny wariant
                <select value={selVariant || ""} onChange={(e) => setSelVariant(e.target.value || null)} className="input w-full">
                  {variants.length === 0 && <option value="">— brak wariantów —</option>}
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input value={newVariantName} onChange={(e) => setNewVariantName(e.target.value)} className="input sm:flex-1" placeholder="Nazwa nowego wariantu (np. Wariant premium)" />
                <button type="button" onClick={addVariant} className={`${btnSectionAdd} w-full sm:w-auto`}>
                  + Wariant
                </button>
              </div>
            </div>

            {selVariant &&
              (() => {
                const v = variants.find((x) => x.id === selVariant);
                return v ? <VariantScopeEditor key={v.id} variant={v} onSaved={load} /> : null;
              })()}
          </section>

          {/* KROK 2 — kosztorys */}
          {selVariant && (
            <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">Krok 2 · Kosztorys</p>
                  <h2 className="mt-0.5 text-base font-bold text-ink">Pozycje wyceny</h2>
                  <p className="mt-0.5 text-xs text-steel">Dodaj pozycje ręcznie, z katalogu, zastosuj szablon lub zaimportuj plik od kosztorysanta.</p>
                </div>
                {selectedLines.length > 0 && !saveTemplateOpen && (
                  <button
                    type="button"
                    onClick={() => { setSaveTemplateOpen(true); setSaveTemplateName(variants.find((v) => v.id === selVariant)?.name || ""); }}
                    className="shrink-0 rounded-lg border border-moss/40 px-3 py-1.5 text-xs font-semibold text-moss-dark hover:bg-moss/10"
                  >
                    Zapisz jako szablon
                  </button>
                )}
              </div>

              {saveTemplateOpen && (
                <div className="mt-3 grid gap-2 rounded-xl2 border border-moss/30 bg-moss/5 p-3 sm:flex sm:items-center">
                  <input
                    className="input flex-1 text-sm"
                    autoFocus
                    value={saveTemplateName}
                    onChange={(e) => setSaveTemplateName(e.target.value)}
                    placeholder="Nazwa nowego szablonu"
                    onKeyDown={(e) => e.key === "Enter" && void saveVariantAsTemplate()}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={savingTemplate || !saveTemplateName.trim()}
                      onClick={() => void saveVariantAsTemplate()}
                      className="shrink-0 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-moss disabled:opacity-50"
                    >
                      {savingTemplate ? "Zapisywanie…" : "Zapisz"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSaveTemplateOpen(false); setSaveTemplateName(""); }}
                      className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-stone-50"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-3 grid gap-2 rounded-xl2 bg-stone-50 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => addLine("labor")} className="rounded-lg bg-sky-50 px-2.5 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100 sm:px-3 sm:py-2.5 sm:text-sm">
                    + Robocizna
                  </button>
                  <button type="button" onClick={() => addLine("material")} className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 sm:px-3 sm:py-2.5 sm:text-sm">
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
                      <option key={c.id} value={c.id}>
                        {c.label} ({c.category === "labor" ? "rob." : "mat."})
                      </option>
                    ))}
                  </select>
                </label>
                <TemplateApplyPanel
                  mode="persist"
                  organizationId={organizationId}
                  variantId={selVariant}
                  baseSortOrder={selectedLines.length}
                  onImported={load}
                />
                <EstimateImport
                  variantId={selVariant}
                  organizationId={organizationId}
                  baseSortOrder={selectedLines.length}
                  onImported={load}
                />
              </div>

              {selectedLines.length === 0 ? (
                <p className="mt-3 rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-sm text-steel">
                  Brak pozycji w kosztorysie. Dodaj pierwszą pozycję powyżej.
                </p>
              ) : (
                <>
                  {/* Mobile: karty pozycji */}
                  <div className="mt-3 grid gap-2.5 sm:hidden">
                    {selectedLines.map((line) => (
                      <div
                        key={line.id}
                        className={`relative grid gap-2.5 overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card ${
                          line.section === "labor" ? "border-sky-200 bg-sky-50/30" : "border-amber-200 bg-amber-50/30"
                        }`}
                      >
                        <span className={`absolute inset-y-0 left-0 w-1.5 ${line.section === "labor" ? "bg-sky-400" : "bg-amber-400"}`} aria-hidden />
                        <div className="flex items-center justify-between gap-2">
                          <select
                            className={`rounded-lg border-0 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide ring-1 ring-inset focus:ring-2 focus:ring-moss ${
                              line.section === "labor" ? "bg-sky-100 text-sky-700 ring-sky-200" : "bg-amber-100 text-amber-800 ring-amber-200"
                            }`}
                            value={line.section}
                            onChange={(e) => void updateLine(line, { section: e.target.value as "labor" | "material" })}
                          >
                            <option value="labor">robocizna</option>
                            <option value="material">materiał</option>
                          </select>
                          <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-rose-500 hover:bg-rose-50" onClick={() => void deleteLine(line.id)}>
                            Usuń
                          </button>
                        </div>
                        <input
                          key={`m-${line.id}-label-${line.label}`}
                          className="input py-1.5 text-sm font-semibold text-ink"
                          placeholder="Opis pozycji"
                          defaultValue={line.label}
                          onBlur={(e) => { if (e.target.value !== line.label) void updateLine(line, { label: e.target.value }); }}
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <label className="grid gap-0.5 text-xs font-medium text-steel">
                            Ilość
                            <input
                              key={`m-${line.id}-qty-${line.quantity}`}
                              type="number"
                              min="0"
                              step="0.01"
                              className="input py-1.5 text-sm"
                              defaultValue={line.quantity}
                              onBlur={(e) => { if (Number(e.target.value) !== line.quantity) void updateLine(line, { quantity: Number(e.target.value) }); }}
                            />
                          </label>
                          <label className="grid gap-0.5 text-xs font-medium text-steel">
                            J.m.
                            <select className="input py-1.5 text-sm" value={line.unit} onChange={(e) => void updateLine(line, { unit: e.target.value as Unit })}>
                              {UNITS.map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-0.5 text-xs font-medium text-steel">
                            Stawka
                            <input
                              key={`m-${line.id}-rate-${line.unit_rate}`}
                              type="number"
                              min="0"
                              step="0.01"
                              className="input py-1.5 text-sm"
                              defaultValue={line.unit_rate}
                              onBlur={(e) => { if (Number(e.target.value) !== line.unit_rate) void updateLine(line, { unit_rate: Number(e.target.value) }); }}
                            />
                          </label>
                        </div>
                        <div className="flex items-center justify-between border-t border-stone-100 pt-2">
                          <span className="text-xs font-medium text-steel">Wartość</span>
                          <span className="text-base font-bold text-ink">{formatMoney(line.line_total)}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop: tabela pozycji */}
                  <div className="mt-3 hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[720px] text-left text-sm">
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
                              <select
                                className="input py-1 text-xs"
                                value={line.section}
                                onChange={(e) => void updateLine(line, { section: e.target.value as "labor" | "material" })}
                              >
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
                                {UNITS.map((u) => (
                                  <option key={u} value={u}>{u}</option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 pr-2">
                              <input
                                key={`${line.id}-qty-${line.quantity}`}
                                type="number"
                                min="0"
                                step="0.01"
                                className="input w-24 py-1 text-xs"
                                defaultValue={line.quantity}
                                onBlur={(e) => { if (Number(e.target.value) !== line.quantity) void updateLine(line, { quantity: Number(e.target.value) }); }}
                              />
                            </td>
                            <td className="py-2 pr-2">
                              <input
                                key={`${line.id}-rate-${line.unit_rate}`}
                                type="number"
                                min="0"
                                step="0.01"
                                className="input w-24 py-1 text-xs"
                                defaultValue={line.unit_rate}
                                onBlur={(e) => { if (Number(e.target.value) !== line.unit_rate) void updateLine(line, { unit_rate: Number(e.target.value) }); }}
                              />
                            </td>
                            <td className="py-2 pr-2 font-medium">{formatMoney(line.line_total)}</td>
                            <td className="py-2">
                              <button type="button" className="text-xs font-medium text-rose-500 hover:underline" onClick={() => void deleteLine(line.id)}>
                                Usuń
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Podsumowanie */}
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-xl2 border border-sky-200/70 bg-sky-50/50 p-3">
                      <p className="text-[0.7rem] font-medium uppercase tracking-wide text-sky-700">Robocizna</p>
                      <p className="mt-0.5 text-sm font-bold text-ink sm:text-base">{formatMoney(laborSum)}</p>
                    </div>
                    <div className="rounded-xl2 border border-amber-200/70 bg-amber-50/50 p-3">
                      <p className="text-[0.7rem] font-medium uppercase tracking-wide text-amber-700">Materiał</p>
                      <p className="mt-0.5 text-sm font-bold text-ink sm:text-base">{formatMoney(matSum)}</p>
                    </div>
                    <div className="rounded-xl2 border border-moss/30 bg-moss/10 p-3">
                      <p className="text-[0.7rem] font-medium uppercase tracking-wide text-moss-dark">Razem netto</p>
                      <p className="mt-0.5 text-sm font-bold text-moss-dark sm:text-base">{formatMoney(laborSum + matSum)}</p>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {/* KROK 3 — dokumenty */}
          {selVariant && (
            <section className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">Krok 3 · Dokumenty</p>
              <h2 className="mt-0.5 text-base font-bold text-ink">Generuj dokumenty z tego wariantu</h2>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col rounded-xl2 border border-stone-200 bg-stone-50/60 p-4">
                  <p className="font-semibold text-ink">Oferta / kosztorys (PDF)</p>
                  <p className="mt-0.5 flex-1 text-xs text-steel">Estetyczny PDF z logo do wysłania klientowi.</p>
                  <button
                    type="button"
                    onClick={() => void openOfferPdf()}
                    className="mt-3 rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50"
                  >
                    Pobierz ofertę (PDF)
                  </button>
                </div>
                <div className="flex flex-col rounded-xl2 border border-moss/30 bg-moss/5 p-4">
                  <p className="font-semibold text-ink">{AS_BUILT_ESTIMATE_LABEL}</p>
                  <p className="mt-0.5 flex-1 text-xs text-steel">
                    {AS_BUILT_ESTIMATE_TITLE} — wartości netto, z potrąceniem wpłaconych zaliczek.
                  </p>
                  <button
                    type="button"
                    onClick={() => selectTab("as-built")}
                    className="mt-3 rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink"
                  >
                    Generuj kosztorys powykonawczy
                  </button>
                </div>
                <div className="flex flex-col rounded-xl2 border border-stone-200 bg-stone-50/60 p-4 sm:col-span-2 lg:col-span-1">
                  <p className="font-semibold text-ink">Umowa o roboty budowlane (PDF)</p>
                  <p className="mt-0.5 flex-1 text-xs text-steel">Umowa z kosztorysem, terminami i harmonogramem płatności z zaliczką.</p>
                  <div className="mt-3 flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-steel">
                      Zaliczka
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={contractAdvancePct}
                        onChange={(e) => setContractAdvancePct(Number(e.target.value))}
                        className="input w-16 py-1.5 text-sm"
                      />
                      %
                    </label>
                    <button
                      type="button"
                      onClick={() => void openContractPdf()}
                      className="flex-1 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss"
                    >
                      Generuj umowę (PDF)
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {tab === "schedule" && (
        <ScheduleSection caseId={caseId} organizationId={organizationId} items={schedule} onChange={load} />
      )}

      {tab === "invoices" && (
        <InvoicesSection
          caseId={caseId}
          organizationId={organizationId}
          userId={userId}
          caseRow={caseRow}
          variants={variants}
          onCaseDataChange={load}
        />
      )}

      {tab === "payments" && <PaymentsSection caseId={caseId} organizationId={organizationId} items={payments} onChange={load} />}

      {tab === "costs" && (
        <CaseCostsSection
          organizationId={organizationId}
          caseId={caseId}
          userId={userId}
          caseLabel={caseRow?.client_name || "Sprawa"}
          onChange={load}
        />
      )}

      {tab === "assistant" && (
        <AiAssistantPanel organizationId={organizationId} caseId={caseId} role={role} compact />
      )}

      {tab === "reminders" && <RemindersSection caseId={caseId} organizationId={organizationId} items={reminders} onChange={load} />}

      {tab === "extras" && <ExtrasSection caseId={caseId} organizationId={organizationId} items={extras} onChange={load} />}

      {tab === "tasks" && (
        <section className="grid min-w-0 gap-4 rounded-lg bg-white p-4 shadow-panel sm:p-5">
          <div>
            <h2 className="text-lg font-bold text-ink">Zadania w sprawie</h2>
            <p className="text-xs text-steel">
              Zadzwonić, wysłać ofertę, zamówić materiał, przygotować umowę, wystawić fakturę, zrobić protokół — z przypisaniem do osoby.
            </p>
          </div>
          <TasksPanel caseId={caseId} />
        </section>
      )}

      {tab === "subcontractors" && <CaseSubcontractorsPanel caseId={caseId} />}

      {tab === "protocols" && (
        <ProtocolsSection caseId={caseId} organizationId={organizationId} userId={userId} items={protocols} onChange={load} />
      )}

      {tab === "as-built" && (
        <AsBuiltEstimatesSection
          caseId={caseId}
          caseRow={caseRow}
          variants={variants}
          linesByVariant={linesByVariant}
          payments={payments}
          showFinances={showFinances}
          estimates={asBuiltEstimates}
          initialVariantId={selVariant}
          onChange={load}
        />
      )}

      {tab === "documents" && (
        <DocumentsSection
          caseId={caseId}
          organizationId={organizationId}
          userId={userId}
          caseRow={caseRow}
          payments={payments}
          onChange={load}
          onOpenAsBuilt={() => selectTab("as-built")}
        />
      )}

      {tab === "files" && (
        <AttachmentsSection caseId={caseId} organizationId={organizationId} userId={userId} items={attachments} onChange={load} />
      )}

      {tab === "emails" && caseRow && (
        <CaseEmailsSection caseId={caseId} clientEmail={caseRow.email} clientName={caseRow.client_name} />
      )}

      {tab === "notes" && (
        <NotesSection
          caseId={caseId}
          organizationId={organizationId}
          userId={userId}
          notes={notes}
          members={members}
          onChange={load}
          draft={noteDraft}
          setDraft={setNoteDraft}
        />
      )}

      <ConfirmDialog
        open={showDelete}
        title="Usunąć sprawę?"
        message="Usunięte zostaną także warianty ofert, harmonogram, płatności i załączniki powiązane ze sprawą."
        confirmLabel="Usuń"
        variant="danger"
        onCancel={() => setShowDelete(false)}
        onConfirm={() => void deleteCase()}
        loading={deleting}
      />
    </div>
  );
}

function VariantScopeEditor({ variant, onSaved }: { variant: OfferVariant; onSaved: () => Promise<void> }) {
  const [text, setText] = useState(variant.scope_notes || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(variant.scope_notes || "");
  }, [variant.id, variant.scope_notes]);

  const save = async () => {
    setSaving(true);
    await supabase.from("offer_variants").update({ scope_notes: text.trim() || null }).eq("id", variant.id);
    await onSaved();
    setSaving(false);
  };

  return (
    <div className="mt-3 min-w-0 rounded-md border border-stone-200 bg-stone-50/50 p-4">
      <label className="grid min-w-0 gap-2 text-sm font-semibold text-ink">
        Uwagi i zakres dla tego wariantu (widoczne w PDF)
        <textarea className="input min-h-20 min-w-0" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="mt-2 rounded-md bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-moss disabled:opacity-60"
      >
        {saving ? "Zapis…" : "Zapisz uwagi"}
      </button>
    </div>
  );
}

function ScheduleSection({
  caseId,
  organizationId,
  items,
  onChange
}: {
  caseId: string;
  organizationId: string;
  items: CaseScheduleItem[];
  onChange: () => Promise<void>;
}) {
  const update = async (id: string, patch: Partial<CaseScheduleItem>, silent = false) => {
    const { error } = await supabase.from("case_schedule_items").update(patch).eq("id", id);
    if (error) { showToast("Nie udało się zapisać", "error"); return; }
    if (!silent) showToast("Zapisano");
    await onChange();
  };
  const add = async () => {
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
    const { error } = await supabase.from("case_schedule_items").insert({
      organization_id: organizationId,
      case_id: caseId,
      title: "Nowy etap",
      sort_order: maxSort + 10
    });
    if (error) { showToast("Nie udało się dodać etapu", "error"); return; }
    showToast("Dodano etap");
    await onChange();
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from("case_schedule_items").delete().eq("id", id);
    if (error) { showToast("Nie udało się usunąć", "error"); return; }
    showToast("Usunięto etap");
    await onChange();
  };
  const move = async (index: number, dir: -1 | 1) => {
    const a = items[index];
    const b = items[index + dir];
    if (!a || !b) return;
    await supabase.from("case_schedule_items").update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from("case_schedule_items").update({ sort_order: a.sort_order }).eq("id", b.id);
    await onChange();
  };

  const doneCount = items.filter((i) => i.completed).length;
  const progressPct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
        <h2 className="min-w-0 text-base font-bold text-ink sm:text-lg">Harmonogram realizacji</h2>
        <button type="button" onClick={add} className={btnSectionAdd}>
          <span className="sm:hidden">+ Etap</span>
          <span className="hidden sm:inline">Dodaj etap</span>
        </button>
      </div>

      {items.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs font-medium text-steel">
            <span>Postęp realizacji</span>
            <span>
              <span className="font-bold text-ink">{doneCount}</span> z {items.length} etapów ({progressPct}%)
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-stone-100">
            <div className="h-full rounded-full bg-moss transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Karty etapów — wspólny widok mobile i desktop */}
      <div className="grid gap-3">
        {items.length === 0 && (
          <p className="rounded-xl2 border border-dashed border-stone-200 p-4 text-center text-sm text-steel">
            Brak etapów harmonogramu. Dodaj pierwszy etap, aby rozpisać realizację.
          </p>
        )}
        {items.map((row, idx) => {
          const overdue = !row.completed && isDue(row.due_date);
          const stripe = row.completed ? "bg-emerald-400" : overdue ? "bg-amber-400" : "bg-stone-200";
          const cardTone = row.completed
            ? "border-emerald-200 bg-emerald-50/40"
            : overdue
              ? "border-amber-200 bg-amber-50/40"
              : "border-stone-200 bg-white";
          return (
            <div key={row.id} className={`relative min-w-0 overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card ${cardTone}`}>
              <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden />

              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    row.completed ? "bg-emerald-500 text-white" : "bg-stone-100 text-steel"
                  }`}
                >
                  {row.completed ? "✓" : idx + 1}
                </span>
                <input
                  key={`m-${row.id}-title-${row.title}`}
                  className="input min-w-0 flex-1 py-1.5 text-sm font-semibold text-ink"
                  defaultValue={row.title}
                  onBlur={(e) => { if (e.target.value !== row.title) void update(row.id, { title: e.target.value }); }}
                />
                <div className="flex shrink-0 flex-col">
                  <button type="button" disabled={idx === 0} onClick={() => void move(idx, -1)} aria-label="Przesuń wyżej" className="rounded px-1 text-base leading-none text-steel hover:text-ink disabled:opacity-20">▲</button>
                  <button type="button" disabled={idx === items.length - 1} onClick={() => void move(idx, 1)} aria-label="Przesuń niżej" className="rounded px-1 text-base leading-none text-steel hover:text-ink disabled:opacity-20">▼</button>
                </div>
              </div>

              <div className="mt-3 pl-10">
                <label className="grid gap-1 text-xs font-medium text-steel">
                  Opis etapu
                  <textarea
                    key={`m-${row.id}-desc`}
                    className="input min-h-[56px] w-full py-1.5 text-sm font-normal"
                    placeholder="np. zakres prac, materiały, ustalenia z klientem…"
                    defaultValue={row.description || ""}
                    onBlur={(e) => {
                      const next = e.target.value.trim() || null;
                      if (next !== (row.description || null)) void update(row.id, { description: next }, true);
                    }}
                  />
                </label>
              </div>

              <div className="mt-3 grid gap-2.5 pl-10 sm:grid-cols-[minmax(0,240px)_1fr] sm:items-end">
                <label className="grid gap-1 text-xs font-medium text-steel">
                  <span className="flex items-center justify-between">
                    Termin
                    {overdue && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Po terminie</span>}
                  </span>
                  <DateInput
                    className="w-full min-w-0 py-1.5 text-sm"
                    value={row.due_date || ""}
                    onChange={(e) => void update(row.id, { due_date: e.target.value || null }, true)}
                  />
                </label>

                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => void update(row.id, { completed: !row.completed }, true)}
                    aria-pressed={row.completed}
                    className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors sm:px-3 sm:py-2 sm:text-sm ${
                      row.completed
                        ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                        : "border-stone-300 bg-white text-steel hover:bg-stone-50"
                    }`}
                  >
                    {row.completed ? "✓ Wykonane" : "Oznacz jako wykonane"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(row.id)}
                    aria-label="Usuń etap"
                    className="shrink-0 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50 sm:px-3 sm:py-2 sm:text-sm"
                  >
                    Usuń
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PaymentsSection({
  caseId,
  organizationId,
  items,
  onChange
}: {
  caseId: string;
  organizationId: string;
  items: Payment[];
  onChange: () => Promise<void>;
}) {
  const add = async () => {
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
    const { error } = await supabase.from("payments").insert({
      organization_id: organizationId,
      case_id: caseId,
      title: "Płatność",
      amount_due: 0,
      amount_paid: 0,
      sort_order: maxSort + 10
    });
    if (error) { showToast("Nie udało się dodać płatności", "error"); return; }
    showToast("Dodano pozycję");
    await onChange();
  };
  const update = async (id: string, patch: Partial<Payment>, silent = false) => {
    const { error } = await supabase.from("payments").update(patch).eq("id", id);
    if (error) { showToast("Nie udało się zapisać", "error"); return; }
    if (!silent) showToast("Zapisano");
    await onChange();
  };
  const totalDue = items.reduce((s, p) => s + Number(p.amount_due || 0), 0);
  const totalPaid = items.reduce((s, p) => s + Number(p.amount_paid || 0), 0);
  const totalBalance = totalDue - totalPaid;

  const payInfo = (p: Payment): { label: string; badge: string; stripe: string } => {
    const due = Number(p.amount_due || 0);
    const paid = Number(p.amount_paid || 0);
    const balance = due - paid;
    if (due > 0 && balance <= 0) return { label: "Opłacona", badge: "bg-emerald-100 text-emerald-700", stripe: "bg-emerald-400" };
    if (balance > 0 && isDue(p.due_date)) return { label: "Po terminie", badge: "bg-red-100 text-red-700", stripe: "bg-red-400" };
    if (paid > 0 && balance > 0) return { label: "Częściowo", badge: "bg-amber-100 text-amber-800", stripe: "bg-amber-400" };
    return { label: "Do zapłaty", badge: "bg-stone-100 text-stone-600", stripe: "bg-stone-300" };
  };

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-base font-bold text-ink sm:text-lg">Płatności i zaliczki</h2>
        <button type="button" onClick={add} className={btnSectionAdd}>
          <span className="sm:hidden">+ Pozycja</span>
          <span className="hidden sm:inline">Dodaj pozycję</span>
        </button>
      </div>

      {items.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl2 border border-stone-200/80 bg-stone-50 p-3">
            <p className="text-[0.7rem] font-medium uppercase tracking-wide text-steel">Należność</p>
            <p className="mt-0.5 text-sm font-bold text-ink sm:text-base">{formatMoney(totalDue)}</p>
          </div>
          <div className="rounded-xl2 border border-emerald-200/70 bg-emerald-50/60 p-3">
            <p className="text-[0.7rem] font-medium uppercase tracking-wide text-emerald-700">Wpłacono</p>
            <p className="mt-0.5 text-sm font-bold text-emerald-700 sm:text-base">{formatMoney(totalPaid)}</p>
          </div>
          <div className={`rounded-xl2 border p-3 ${totalBalance > 0 ? "border-amber-200/70 bg-amber-50/60" : "border-stone-200/80 bg-stone-50"}`}>
            <p className={`text-[0.7rem] font-medium uppercase tracking-wide ${totalBalance > 0 ? "text-amber-700" : "text-steel"}`}>Saldo</p>
            <p className={`mt-0.5 text-sm font-bold sm:text-base ${totalBalance > 0 ? "text-amber-700" : "text-ink"}`}>{formatMoney(totalBalance)}</p>
          </div>
        </div>
      )}

      {/* Mobile card view */}
      <div className="grid gap-3 sm:hidden">
        {items.length === 0 && (
          <p className="rounded-xl2 border border-dashed border-stone-200 p-4 text-center text-sm text-steel">
            Brak pozycji płatności. Kliknij „Dodaj pozycję” u góry, żeby wpisać zaliczkę, ratę albo rozliczenie końcowe — każdą pozycję uzupełnia się bezpośrednio na liście.
          </p>
        )}
        {items.map((p) => {
          const info = payInfo(p);
          const balance = Number(p.amount_due || 0) - Number(p.amount_paid || 0);
          return (
            <div key={p.id} className="relative grid gap-2.5 overflow-hidden rounded-xl2 border border-stone-200 bg-white p-3.5 pl-4 shadow-card">
              <span className={`absolute inset-y-0 left-0 w-1.5 ${info.stripe}`} aria-hidden />
              <div className="flex items-center justify-between gap-2">
                <input
                  key={`m-${p.id}-title-${p.title}`}
                  className="input min-w-0 flex-1 py-1.5 text-sm font-semibold text-ink"
                  defaultValue={p.title}
                  placeholder="Tytuł"
                  onBlur={(e) => { if (e.target.value !== p.title) void update(p.id, { title: e.target.value }); }}
                />
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide ${info.badge}`}>{info.label}</span>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="grid min-w-0 gap-0.5 text-xs font-medium text-steel">
                  Termin
                  <DateInput className="py-1.5 text-sm" value={p.due_date || ""} onChange={(e) => void update(p.id, { due_date: e.target.value || null }, true)} />
                </label>
                <label className="grid min-w-0 gap-0.5 text-xs font-medium text-steel">
                  Zapłacono dnia
                  <DateInput className="py-1.5 text-sm" value={p.paid_at ? p.paid_at.slice(0, 10) : ""} onChange={(e) => void update(p.id, { paid_at: e.target.value ? `${e.target.value}T00:00:00.000Z` : null }, true)} />
                </label>
                <label className="grid gap-0.5 text-xs font-medium text-steel">
                  Należność (PLN)
                  <input key={`m-${p.id}-due-${p.amount_due}`} type="number" min="0" className="input py-1.5 text-sm" defaultValue={p.amount_due} onBlur={(e) => { if (Number(e.target.value) !== p.amount_due) void update(p.id, { amount_due: Number(e.target.value) }); }} />
                </label>
                <label className="grid gap-0.5 text-xs font-medium text-steel">
                  Wpłacono (PLN)
                  <input key={`m-${p.id}-paid-${p.amount_paid}`} type="number" min="0" className="input py-1.5 text-sm" defaultValue={p.amount_paid} onBlur={(e) => { if (Number(e.target.value) !== p.amount_paid) void update(p.id, { amount_paid: Number(e.target.value) }); }} />
                </label>
              </div>
              {balance > 0 && (
                <p className="text-xs font-semibold text-steel">
                  Pozostało: <span className="text-amber-700">{formatMoney(balance)}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="text-xs uppercase text-steel">
            <tr>
              <th className="py-2 text-left">Tytuł</th>
              <th className="py-2 text-left">Status</th>
              <th className="py-2">Termin</th>
              <th className="py-2">Należność</th>
              <th className="py-2">Wpłacono</th>
              <th className="py-2">Zapłacono dnia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((p) => {
              const info = payInfo(p);
              return (
                <tr key={p.id}>
                  <td className="py-2">
                    <input key={`d-${p.id}-title-${p.title}`} className="input py-1 text-sm" defaultValue={p.title} onBlur={(e) => { if (e.target.value !== p.title) void update(p.id, { title: e.target.value }); }} />
                  </td>
                  <td className="py-2">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide ${info.badge}`}>{info.label}</span>
                  </td>
                  <td className="py-2">
                    <DateInput className="py-1 text-sm" value={p.due_date || ""} onChange={(e) => void update(p.id, { due_date: e.target.value || null }, true)} />
                  </td>
                  <td className="py-2">
                    <input key={`d-${p.id}-due-${p.amount_due}`} type="number" min="0" className="input w-28 py-1 text-sm" defaultValue={p.amount_due} onBlur={(e) => { if (Number(e.target.value) !== p.amount_due) void update(p.id, { amount_due: Number(e.target.value) }); }} />
                  </td>
                  <td className="py-2">
                    <input key={`d-${p.id}-paid-${p.amount_paid}`} type="number" min="0" className="input w-28 py-1 text-sm" defaultValue={p.amount_paid} onBlur={(e) => { if (Number(e.target.value) !== p.amount_paid) void update(p.id, { amount_paid: Number(e.target.value) }); }} />
                  </td>
                  <td className="py-2">
                    <DateInput className="py-1 text-sm" value={p.paid_at ? p.paid_at.slice(0, 10) : ""} onChange={(e) => void update(p.id, { paid_at: e.target.value ? `${e.target.value}T00:00:00.000Z` : null }, true)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-stone-200 font-bold text-ink">
                <td className="py-2" colSpan={3}>RAZEM</td>
                <td className="py-2 text-center">{formatMoney(totalDue)}</td>
                <td className="py-2 text-center">{formatMoney(totalPaid)}</td>
                <td className="py-2" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

function RemindersSection({
  caseId,
  organizationId,
  items,
  onChange
}: {
  caseId: string;
  organizationId: string;
  items: Reminder[];
  onChange: () => Promise<void>;
}) {
  const [title, setTitle] = useState("Kontakt z klientem");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const add = async () => {
    if (!date) return;
    await supabase.from("reminders").insert({
      organization_id: organizationId,
      case_id: caseId,
      remind_at: date,
      title: title.trim() || "Przypomnienie",
      note: note.trim() || null
    });
    setNote("");
    await onChange();
  };
  const complete = async (id: string) => {
    await supabase.from("reminders").update({ completed_at: new Date().toISOString() }).eq("id", id);
    await onChange();
  };
  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <h2 className="text-lg font-bold text-ink">Przypomnienia o kontakcie</h2>
      <div className="mt-4 grid gap-3 rounded-xl2 bg-stone-50 p-4 md:grid-cols-4">
        <input className="input" placeholder="Tytuł" value={title} onChange={(e) => setTitle(e.target.value)} />
        <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="input md:col-span-2" placeholder="Notatka (opcjonalnie)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" onClick={add} disabled={!date} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-moss disabled:opacity-50 sm:px-4 sm:py-2.5 sm:text-sm md:col-span-4">
          <span className="sm:hidden">+ Przypomnienie</span>
          <span className="hidden sm:inline">Dodaj przypomnienie</span>
        </button>
      </div>
      <ul className="mt-5 grid gap-2.5 text-sm">
        {items.map((r) => {
          const overdue = !r.completed_at && isDue(r.remind_at);
          const stripe = r.completed_at ? "bg-emerald-400" : overdue ? "bg-amber-400" : "bg-stone-200";
          return (
            <li
              key={r.id}
              className={`relative flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card ${
                r.completed_at ? "border-stone-200 bg-stone-50/60" : overdue ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-white"
              }`}
            >
              <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={`font-semibold text-ink ${r.completed_at ? "line-through opacity-70" : ""}`}>{r.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-steel">
                  <span className={overdue ? "font-semibold text-amber-800" : ""}>{formatDate(r.remind_at)}</span>
                  {r.note ? <span>— {r.note}</span> : null}
                </p>
              </div>
              {r.completed_at ? (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[0.7rem] font-semibold text-emerald-700">
                  ✓ {new Date(r.completed_at).toLocaleDateString("pl-PL")}
                </span>
              ) : (
                <button type="button" onClick={() => complete(r.id)} className="shrink-0 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-moss hover:bg-moss/10">
                  Oznacz jako wykonane
                </button>
              )}
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-steel">Brak przypomnień.</li>
        )}
      </ul>
    </section>
  );
}

function ExtrasSection({
  caseId,
  organizationId,
  items,
  onChange
}: {
  caseId: string;
  organizationId: string;
  items: ExtraWork[];
  onChange: () => Promise<void>;
}) {
  const add = async () => {
    const { error } = await supabase.from("extra_works").insert({
      organization_id: organizationId,
      case_id: caseId,
      description: "Opis pracy dodatkowej",
      quantity: 1,
      unit: "szt.",
      unit_rate: 0,
      accepted: false
    });
    if (error) { showToast("Nie udało się dodać pozycji", "error"); return; }
    showToast("Dodano pozycję");
    await onChange();
  };
  const update = async (id: string, patch: Partial<ExtraWork>, silent = false) => {
    const { error } = await supabase.from("extra_works").update(patch).eq("id", id);
    if (error) { showToast("Nie udało się zapisać", "error"); return; }
    if (!silent) showToast("Zapisano");
    await onChange();
  };
  const extrasTotal = items.reduce((s, x) => s + Number(x.line_total || 0), 0);
  const acceptedTotal = items.filter((x) => x.accepted).reduce((s, x) => s + Number(x.line_total || 0), 0);

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-base font-bold text-ink sm:text-lg">Prace dodatkowe</h2>
        <button type="button" onClick={add} className={btnSectionAdd}>
          <span className="sm:hidden">+ Pozycja</span>
          <span className="hidden sm:inline">Dodaj pozycję</span>
        </button>
      </div>

      {items.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl2 border border-stone-200/80 bg-stone-50 p-3">
            <p className="text-[0.7rem] font-medium uppercase tracking-wide text-steel">Wartość łączna</p>
            <p className="mt-0.5 text-sm font-bold text-ink sm:text-base">{formatMoney(extrasTotal)}</p>
          </div>
          <div className="rounded-xl2 border border-emerald-200/70 bg-emerald-50/60 p-3">
            <p className="text-[0.7rem] font-medium uppercase tracking-wide text-emerald-700">Zaakceptowane</p>
            <p className="mt-0.5 text-sm font-bold text-emerald-700 sm:text-base">{formatMoney(acceptedTotal)}</p>
          </div>
        </div>
      )}

      {/* Mobile card view */}
      <div className="grid gap-3 sm:hidden">
        {items.length === 0 && (
          <p className="rounded-xl2 border border-dashed border-stone-200 p-4 text-center text-sm text-steel">Brak prac dodatkowych.</p>
        )}
        {items.map((x) => (
          <div
            key={x.id}
            className={`relative grid gap-2.5 overflow-hidden rounded-xl2 border p-3.5 pl-4 shadow-card ${
              x.accepted ? "border-emerald-200 bg-emerald-50/40" : "border-stone-200 bg-white"
            }`}
          >
            <span className={`absolute inset-y-0 left-0 w-1.5 ${x.accepted ? "bg-emerald-400" : "bg-stone-200"}`} aria-hidden />
            <input key={`m-${x.id}-desc-${x.description}`} className="input py-1.5 text-sm font-semibold text-ink" defaultValue={x.description} placeholder="Opis pracy" onBlur={(e) => { if (e.target.value !== x.description) void update(x.id, { description: e.target.value }); }} />
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-0.5 text-xs font-medium text-steel">
                Data
                <DateInput className="py-1.5 text-sm" value={x.work_date} onChange={(e) => void update(x.id, { work_date: e.target.value }, true)} />
              </label>
              <label className="grid gap-0.5 text-xs font-medium text-steel">
                Ilość
                <input key={`m-${x.id}-qty-${x.quantity}`} type="number" min="0" step="0.01" className="input py-1.5 text-sm" defaultValue={x.quantity} onBlur={(e) => { if (Number(e.target.value) !== x.quantity) void update(x.id, { quantity: Number(e.target.value) }); }} />
              </label>
              <label className="grid gap-0.5 text-xs font-medium text-steel">
                Jedn.
                <select className="input py-1.5 text-sm" value={x.unit} onChange={(e) => void update(x.id, { unit: e.target.value as Unit }, true)}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label className="grid gap-0.5 text-xs font-medium text-steel">
                Stawka
                <input key={`m-${x.id}-rate-${x.unit_rate}`} type="number" min="0" className="input py-1.5 text-sm" defaultValue={x.unit_rate} onBlur={(e) => { if (Number(e.target.value) !== x.unit_rate) void update(x.id, { unit_rate: Number(e.target.value) }); }} />
              </label>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-stone-100 pt-2">
              <button
                type="button"
                onClick={() => void update(x.id, { accepted: !x.accepted }, true)}
                aria-pressed={x.accepted}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  x.accepted ? "border-emerald-300 bg-emerald-100 text-emerald-800" : "border-stone-300 bg-white text-steel hover:bg-stone-50"
                }`}
              >
                {x.accepted ? "✓ Zaakceptowana" : "Zaakceptuj"}
              </button>
              <span className="text-base font-bold text-ink">{formatMoney(x.line_total)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-xs uppercase text-steel">
            <tr>
              <th className="py-2">Data</th>
              <th className="py-2">Opis</th>
              <th className="py-2">Ilość</th>
              <th className="py-2">Jedn.</th>
              <th className="py-2">Stawka</th>
              <th className="py-2">Wartość</th>
              <th className="py-2">Akcept.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((x) => (
              <tr key={x.id}>
                <td className="py-2">
                  <DateInput className="py-1 text-xs" value={x.work_date} onChange={(e) => void update(x.id, { work_date: e.target.value }, true)} />
                </td>
                <td className="py-2">
                  <input key={`d-${x.id}-desc-${x.description}`} className="input py-1 text-xs" defaultValue={x.description} onBlur={(e) => { if (e.target.value !== x.description) void update(x.id, { description: e.target.value }); }} />
                </td>
                <td className="py-2">
                  <input key={`d-${x.id}-qty-${x.quantity}`} type="number" min="0" step="0.01" className="input w-20 py-1 text-xs" defaultValue={x.quantity} onBlur={(e) => { if (Number(e.target.value) !== x.quantity) void update(x.id, { quantity: Number(e.target.value) }); }} />
                </td>
                <td className="py-2">
                  <select className="input py-1 text-xs" value={x.unit} onChange={(e) => void update(x.id, { unit: e.target.value as Unit }, true)}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </td>
                <td className="py-2">
                  <input key={`d-${x.id}-rate-${x.unit_rate}`} type="number" min="0" className="input w-24 py-1 text-xs" defaultValue={x.unit_rate} onBlur={(e) => { if (Number(e.target.value) !== x.unit_rate) void update(x.id, { unit_rate: Number(e.target.value) }); }} />
                </td>
                <td className="py-2 font-medium">{formatMoney(x.line_total)}</td>
                <td className="py-2 text-center">
                  <input type="checkbox" checked={x.accepted} onChange={(e) => void update(x.id, { accepted: e.target.checked }, true)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProtocolsSection({
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

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function DocumentsSection({
  caseId,
  organizationId,
  userId,
  caseRow,
  payments,
  onChange,
  onOpenAsBuilt
}: {
  caseId: string;
  organizationId: string;
  userId: string;
  caseRow: CaseRow | null;
  payments: Payment[];
  onChange: () => Promise<void>;
  onOpenAsBuilt?: () => void;
}) {
  const [templateId, setTemplateId] = useState<string>(DOCUMENT_TEMPLATES[0]?.id ?? "");
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
    const fileName = `${fileBase()}.pdf`;
    const path = `${organizationId}/${caseId}/${crypto.randomUUID()}_${fileName}`;
    const { error: upErr } = await supabase.storage
      .from("case-attachments")
      .upload(path, res.blob, { contentType: "application/pdf", upsert: false });
    if (upErr) {
      setErr(upErr.message);
      setBusy(null);
      return;
    }
    const { error: dbErr } = await supabase.from("attachments").insert({
      organization_id: organizationId,
      case_id: caseId,
      storage_path: path,
      file_name: fileName,
      mime_type: "application/pdf",
      size_bytes: res.blob.size,
      category: template?.category ?? "umowa",
      uploaded_by: userId
    });
    if (dbErr) {
      setErr(
        dbErr.message.includes("attachments_category_check")
          ? "Baza nie ma aktualnych kategorii dokumentów. Uruchom w Supabase najnowszą migrację z supabase/migrations i spróbuj ponownie."
          : dbErr.message
      );
      setBusy(null);
      return;
    }
    setOk("Zapisano w zakładce „Pliki”.");
    setBusy(null);
    await onChange();
  };

  const grouped: Record<string, typeof DOCUMENT_TEMPLATES> = {
    umowa: DOCUMENT_TEMPLATES.filter((t) => t.category === "umowa"),
    aneks: DOCUMENT_TEMPLATES.filter((t) => t.category === "aneks"),
    protokół: DOCUMENT_TEMPLATES.filter((t) => t.category === "protokół"),
    "wezwanie do zapłaty": DOCUMENT_TEMPLATES.filter((t) => t.category === "wezwanie do zapłaty"),
    oświadczenie: DOCUMENT_TEMPLATES.filter((t) => t.category === "oświadczenie")
  };
  const groupLabels: Record<string, string> = {
    umowa: "Umowy",
    aneks: "Aneksy",
    protokół: "Protokoły",
    "wezwanie do zapłaty": "Wezwania do zapłaty",
    oświadczenie: "Oświadczenia / dokumenty"
  };

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      {onOpenAsBuilt && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl2 border border-moss/25 bg-gradient-to-r from-moss/10 to-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-ink">{AS_BUILT_ESTIMATE_LABEL}</p>
            <p className="mt-0.5 text-xs text-steel">
              Generuj {AS_BUILT_ESTIMATE_TITLE} (netto) z pozycji wyceny, zaliczkami i historią pobrania — pełny generator w zakładce „{AS_BUILT_ESTIMATE_LABEL}”.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenAsBuilt}
            className="shrink-0 rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink"
          >
            Otwórz generator
          </button>
        </div>
      )}

      <h2 className="text-lg font-bold text-ink">Dokumenty firmowe</h2>
      <p className="mt-1 text-xs text-steel">
        Wybierz wzór (umowa, aneks, protokół, wezwanie do zapłaty, oświadczenie), uzupełnij treść i wygeneruj PDF z danymi firmy i
        klienta. Gotowy dokument można pobrać lub zapisać w załącznikach sprawy.
      </p>

      {err && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
      {ok && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</p>}

      <div className="mt-4 grid gap-4">
        <label className="grid gap-1 text-xs font-semibold text-ink">
          Wzór dokumentu
          <select className="input font-normal" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {Object.keys(grouped).map((g) => (
              <optgroup key={g} label={groupLabels[g]}>
                {grouped[g].map((t) => (
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
            onClick={download}
            disabled={busy !== null}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-moss hover:bg-moss/10 disabled:opacity-60"
          >
            {busy === "download" ? "Generowanie…" : "Pobierz PDF"}
          </button>
          <button
            type="button"
            onClick={saveToAttachments}
            disabled={busy !== null}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-60"
          >
            {busy === "save" ? "Zapisywanie…" : "Generuj i zapisz w załącznikach"}
          </button>
        </div>
      </div>
    </section>
  );
}

function AttachmentsSection({
  caseId,
  organizationId,
  userId,
  items,
  onChange
}: {
  caseId: string;
  organizationId: string;
  userId: string;
  items: Attachment[];
  onChange: () => Promise<void>;
}) {
  const [cat, setCat] = useState<AttachmentCategory>("w trakcie");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"lista" | "galeria">("lista");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{ url: string; caption: string } | null>(null);

  const isImage = (a: Attachment) => !!a.mime_type && a.mime_type.startsWith("image/");
  const images = useMemo(() => items.filter(isImage), [items]);

  useEffect(() => {
    let active = true;
    const paths = images.map((a) => a.storage_path);
    if (paths.length === 0) {
      setUrls({});
      return;
    }
    void supabase.storage
      .from("case-attachments")
      .createSignedUrls(paths, 3600)
      .then(({ data }) => {
        if (!active || !data) return;
        const map: Record<string, string> = {};
        data.forEach((d, i) => {
          if (d.signedUrl) map[images[i].id] = d.signedUrl;
        });
        setUrls(map);
      });
    return () => {
      active = false;
    };
  }, [images]);

  const saveDescription = async (a: Attachment, value: string) => {
    const next = value.trim() || null;
    if (next === (a.description || null)) return;
    const { error } = await supabase.from("attachments").update({ description: next }).eq("id", a.id);
    if (error) {
      setErr(error.message);
      return;
    }
    await onChange();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    if (file.size > MAX_UPLOAD_BYTES) {
      setErr("Plik za duży (max 15 MB).");
      return;
    }
    if (!ALLOWED_MIME.has(file.type)) {
      setErr("Dozwolone: JPG, PNG, WebP, PDF.");
      return;
    }
    setUploading(true);
    const safe = file.name.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]+/g, "_").slice(0, 120);
    const path = `${organizationId}/${caseId}/${crypto.randomUUID()}_${safe}`;
    const { error: upErr } = await supabase.storage.from("case-attachments").upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setErr(upErr.message);
      setUploading(false);
      return;
    }
    const { error: dbErr } = await supabase.from("attachments").insert({
      organization_id: organizationId,
      case_id: caseId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      category: cat,
      uploaded_by: userId
    });
    if (dbErr) setErr(dbErr.message);
    setUploading(false);
    await onChange();
  };

  const download = async (a: Attachment) => {
    const { data, error } = await supabase.storage.from("case-attachments").createSignedUrl(a.storage_path, 3600);
    if (error || !data?.signedUrl) return;
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const remove = async (a: Attachment) => {
    await supabase.storage.from("case-attachments").remove([a.storage_path]);
    await supabase.from("attachments").delete().eq("id", a.id);
    await onChange();
  };

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Załączniki i zdjęcia</h2>
        <div className="inline-flex overflow-hidden rounded-lg border border-stone-300 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setView("lista")}
            className={`px-3 py-1.5 ${view === "lista" ? "bg-ink text-white" : "bg-white text-steel hover:bg-stone-50"}`}
          >
            Lista
          </button>
          <button
            type="button"
            onClick={() => setView("galeria")}
            className={`px-3 py-1.5 ${view === "galeria" ? "bg-ink text-white" : "bg-white text-steel hover:bg-stone-50"}`}
          >
            Galeria ({images.length})
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-steel">Kategorie zgodnie z procesem: przed / w trakcie / po, usterki, materiały, projekt, inspiracje. Max 15 MB, JPG/PNG/WebP/PDF.</p>
      {err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
      <div className="mt-4 flex flex-col gap-2 rounded-xl2 bg-stone-50 p-3 sm:flex-row sm:items-center">
        <select value={cat} onChange={(e) => setCat(e.target.value as AttachmentCategory)} className="input sm:w-auto">
          {ATTACHMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="cursor-pointer rounded-lg bg-moss px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-ink">
          {uploading ? "Wysyłanie…" : "Wybierz plik"}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={uploading} onChange={onFile} />
        </label>
      </div>

      {view === "galeria" ? (
        images.length === 0 ? (
          <p className="mt-5 rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-steel">Brak zdjęć do pokazania w galerii.</p>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((a) => (
              <figure key={a.id} className="overflow-hidden rounded-xl2 border border-stone-200 bg-white shadow-card">
                <button
                  type="button"
                  onClick={() => urls[a.id] && setLightbox({ url: urls[a.id], caption: a.description || a.file_name })}
                  className="block aspect-square w-full overflow-hidden bg-stone-100"
                >
                  {urls[a.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls[a.id]} alt={a.description || a.file_name} className="h-full w-full object-cover transition hover:scale-105" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-stone-300">…</span>
                  )}
                </button>
                <figcaption className="p-2">
                  <span className="inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[0.65rem] font-medium text-steel">{a.category}</span>
                  <textarea
                    key={`desc-${a.id}`}
                    className="input mt-1.5 min-h-[40px] w-full py-1 text-xs font-normal"
                    placeholder="Opis zdjęcia…"
                    defaultValue={a.description || ""}
                    onBlur={(e) => void saveDescription(a, e.target.value)}
                  />
                </figcaption>
              </figure>
            ))}
          </div>
        )
      ) : (
        <ul className="mt-5 grid gap-2.5 text-sm">
          {items.map((a) => {
            const isPdf = a.mime_type === "application/pdf";
            const img = isImage(a);
            return (
              <li key={a.id} className="rounded-xl2 border border-stone-200 bg-white p-3 shadow-card">
                <div className="flex items-center gap-3">
                  {img && urls[a.id] ? (
                    <button
                      type="button"
                      onClick={() => setLightbox({ url: urls[a.id], caption: a.description || a.file_name })}
                      className="size-10 shrink-0 overflow-hidden rounded-lg bg-stone-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={urls[a.id]} alt={a.description || a.file_name} className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-lg ${isPdf ? "bg-red-50 text-red-500" : "bg-sky-50 text-sky-500"}`}>
                      {isPdf ? "📄" : "🖼"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{a.file_name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-steel">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium">{a.category}</span>
                      <span>{a.size_bytes ? `${(a.size_bytes / 1024).toFixed(0)} KB` : "?"}</span>
                      <span className="text-stone-400">{new Date(a.created_at).toLocaleDateString("pl-PL")}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:gap-2">
                    <button type="button" onClick={() => download(a)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-moss hover:bg-moss/10">
                      Pobierz
                    </button>
                    <button type="button" onClick={() => remove(a)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50">
                      Usuń
                    </button>
                  </div>
                </div>
                <textarea
                  key={`ldesc-${a.id}`}
                  className="input mt-2 min-h-[38px] w-full py-1 text-xs font-normal"
                  placeholder="Opis (np. co przedstawia zdjęcie / czego dotyczy plik)…"
                  defaultValue={a.description || ""}
                  onBlur={(e) => void saveDescription(a, e.target.value)}
                />
              </li>
            );
          })}
          {items.length === 0 && (
            <li className="rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-steel">Brak załączników.</li>
          )}
        </ul>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.caption} className="max-h-[80vh] w-auto rounded-lg object-contain" />
            <p className="mt-2 text-center text-sm text-white">{lightbox.caption}</p>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="mt-3 block w-full rounded-lg bg-white/90 px-4 py-2 text-sm font-semibold text-ink hover:bg-white"
            >
              Zamknij
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function NotesSection({
  caseId,
  organizationId,
  userId,
  notes,
  members,
  onChange,
  draft,
  setDraft
}: {
  caseId: string;
  organizationId: string;
  userId: string;
  notes: CaseNote[];
  members: OrgMemberProfile[];
  onChange: () => Promise<void>;
  draft: string;
  setDraft: (v: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    await supabase.from("case_notes").insert({
      organization_id: organizationId,
      case_id: caseId,
      user_id: userId,
      content: draft.trim()
    });
    setDraft("");
    await onChange();
    setSaving(false);
  };

  const saveEdit = async (noteId: string) => {
    const content = editDraft.trim();
    if (!content) {
      showToast("Notatka nie może być pusta", "error");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("case_notes").update({ content }).eq("id", noteId);
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
    const { error } = await supabase.from("case_notes").delete().eq("id", deletingId);
    setBusy(false);
    setDeletingId(null);
    if (error) {
      showToast("Nie udało się usunąć notatki", "error");
      return;
    }
    await onChange();
  };

  return (
    <section className="grid min-w-0 gap-6 rounded-lg bg-white p-4 shadow-panel sm:p-5 lg:grid-cols-2">
      <div>
        <h2 className="text-lg font-bold text-ink">Dodaj notatkę</h2>
        <form onSubmit={add} className="mt-3 grid gap-3">
          <textarea className="input min-h-28" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ustalenia telefoniczne, mail, wizyta…" />
          <button disabled={saving} className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-60 sm:w-fit">
            {saving ? "Zapis…" : "Zapisz notatkę"}
          </button>
        </form>
      </div>
      <div>
        <h2 className="text-lg font-bold text-ink">Historia</h2>
        <ul className="mt-3 max-h-[480px] space-y-2.5 overflow-y-auto text-sm">
          {notes.map((n) => {
            const author = members.find((m) => m.user_id === n.user_id)?.email || "nieznany";
            // Edytować i kasować może wyłącznie autor — tak samo stanowi polityka bazy,
            // więc interfejs nie obiecuje niczego, czego serwer by nie przepuścił.
            const mine = n.user_id === userId;
            const editing = editingId === n.id;
            return (
            <li key={n.id} className="rounded-xl2 border border-stone-200/80 bg-stone-50/80 p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs font-medium text-stone-400">
                  {formatDateTime(n.created_at)} · <span className="font-semibold text-steel">{author}</span>
                </p>
                {mine && !editing && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(n.id);
                        setEditDraft(n.content);
                      }}
                      className="rounded-md px-2 py-1 text-xs font-semibold text-steel hover:bg-stone-200 hover:text-ink"
                    >
                      Edytuj
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(n.id)}
                      className="rounded-md px-2 py-1 text-xs font-semibold text-steel hover:bg-rose-100 hover:text-rose-700"
                    >
                      Usuń
                    </button>
                  </div>
                )}
              </div>

              {editing ? (
                <div className="mt-2 grid gap-2">
                  <textarea
                    className="input min-h-24 text-sm"
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveEdit(n.id)}
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
                <p className="mt-1 whitespace-pre-wrap text-ink">{n.content}</p>
              )}
            </li>
            );
          })}
          {notes.length === 0 && (
            <li className="rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-steel">Brak notatek.</li>
          )}
        </ul>
      </div>

      <ConfirmDialog
        open={deletingId !== null}
        title="Usunąć notatkę?"
        message="Notatki nie da się przywrócić."
        confirmLabel="Usuń"
        variant="danger"
        onCancel={() => setDeletingId(null)}
        onConfirm={() => void remove()}
        loading={busy}
      />
    </section>
  );
}

function CaseTeamChipList({
  title,
  hint,
  tone,
  userIds,
  members
}: {
  title: string;
  hint: string;
  tone: "sky" | "moss";
  userIds: string[];
  members: OrgMemberProfile[];
}) {
  const box =
    tone === "sky"
      ? "border-sky-200/80 bg-sky-50/40"
      : "border-moss/25 bg-moss/5";
  return (
    <div className={`rounded-xl2 border p-3.5 ${box}`}>
      <p className="text-sm font-bold text-ink">{title}</p>
      <p className="mt-0.5 text-xs text-steel">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {userIds.length === 0 && <p className="text-sm text-steel">Brak osób.</p>}
        {userIds.map((uid) => {
          const m = members.find((x) => x.user_id === uid);
          return (
            <span
              key={uid}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-stone-200/80"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-moss text-[10px] font-bold uppercase text-white">
                {memberDisplayName(m, uid)[0]}
              </span>
              <span className="max-w-[180px] truncate">{memberDisplayName(m, uid)}</span>
              {m && <span className="text-[10px] font-medium text-steel">({MEMBER_ROLE_LABELS[m.role]})</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
