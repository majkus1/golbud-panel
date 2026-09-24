"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { AttachmentList } from "@/components/case/attachment-list";
import { AsBuiltEstimatesSection } from "@/components/case/as-built-estimates-section";
import { DocumentsSection } from "@/components/case/documents-section";
import { ProtocolsSection } from "@/components/case/protocols-section";
import { DOC_SECTIONS, attachmentSection, sectionCategories, visibleDocSections, type DocSection } from "@/lib/case-tabs";
import type { Attachment, CaseAsBuiltEstimate, CaseProtocol, CaseRow, ExtraWork, OfferLine, OfferVariant, Payment } from "@/lib/types";

/**
 * Zakładka Dokumentacja — jedno miejsce na dokumenty budowy. Zastępuje cztery osobne
 * zakładki (Dokumenty, Pliki, Protokoły, Kosztorys powykonawczy). Każdy plik sprawy trafia
 * do sekcji według swojej kategorii, więc nic nie ginie przy przejściu na nowy układ.
 */
export function DocumentationTab({
  caseId,
  organizationId,
  userId,
  caseRow,
  payments,
  attachments,
  protocols,
  asBuiltEstimates,
  variants,
  linesByVariant,
  selectedVariantId,
  extras,
  fieldView,
  showFinances,
  focusSection,
  onOpenContract,
  onChange
}: {
  caseId: string;
  organizationId: string;
  userId: string;
  caseRow: CaseRow;
  payments: Payment[];
  attachments: Attachment[];
  protocols: CaseProtocol[];
  asBuiltEstimates: CaseAsBuiltEstimate[];
  variants: OfferVariant[];
  linesByVariant: Record<string, OfferLine[]>;
  selectedVariantId: string | null;
  extras: ExtraWork[];
  fieldView: boolean;
  showFinances: boolean;
  focusSection?: DocSection;
  onOpenContract: () => void;
  onChange: () => Promise<void>;
}) {
  const sections = useMemo(() => visibleDocSections({ fieldView }), [fieldView]);
  const bySection = useMemo(() => {
    const map = new Map<DocSection, Attachment[]>();
    for (const a of attachments) {
      const key = attachmentSection(a.category);
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return map;
  }, [attachments]);

  const counts: Partial<Record<DocSection, number>> = {
    umowy: bySection.get("umowy")?.length ?? 0,
    protokoly: (bySection.get("protokoly")?.length ?? 0) + protocols.length,
    kosztorysy: (bySection.get("kosztorysy")?.length ?? 0) + asBuiltEstimates.length,
    pozostale: bySection.get("pozostale")?.length ?? 0,
    projekty: bySection.get("projekty")?.length ?? 0,
    zdjecia: bySection.get("zdjecia")?.length ?? 0
  };

  const jumpTo = (section: DocSection, behavior: ScrollBehavior = "smooth") => {
    document.getElementById(`dokumentacja-${section}`)?.scrollIntoView({ behavior, block: "start" });
  };

  // Wejście ze starego linku (np. ?tab=protocols) albo z paska procesu — przewiń do sekcji.
  // Drugie przewinięcie po chwili: listy plików i generator doładowują się i przesuwają układ.
  useEffect(() => {
    if (!focusSection) return;
    const timers = [100, 600].map((ms) => window.setTimeout(() => jumpTo(focusSection, "auto"), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [focusSection]);

  const files = (section: DocSection) => bySection.get(section) ?? [];
  const listProps = { caseId, organizationId, userId, onChange };

  return (
    <div className="grid min-w-0 gap-5">
      <nav aria-label="Sekcje dokumentacji" className="flex flex-wrap gap-1.5">
        {DOC_SECTIONS.filter((s) => sections.includes(s.id)).map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jumpTo(s.id)}
            className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-steel ring-1 ring-stone-200 hover:bg-stone-50 hover:text-ink"
          >
            {s.label}
            <span className="ml-1.5 rounded-full bg-stone-100 px-1.5 py-0.5 text-[0.65rem] text-steel">{counts[s.id] ?? 0}</span>
          </button>
        ))}
      </nav>

      {sections.includes("umowy") && (
        <DocGroup id="umowy">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-steel">Umowę przygotujesz z wzoru w zakładce Umowa. Tutaj widać te same pliki.</p>
              <button
                type="button"
                onClick={onOpenContract}
                className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone-50"
              >
                Przejdź do zakładki Umowa
              </button>
            </div>
            <AttachmentList {...listProps} items={files("umowy")} uploadCategories={sectionCategories("umowy")} emptyText="Brak umów i aneksów." />
          </Card>
        </DocGroup>
      )}

      {sections.includes("protokoly") && (
        <DocGroup id="protokoly">
          <ProtocolsSection caseId={caseId} organizationId={organizationId} userId={userId} items={protocols} onChange={onChange} />
          <Card>
            <h3 className="mb-2 text-sm font-bold text-ink">Protokoły w plikach</h3>
            <AttachmentList
              {...listProps}
              items={files("protokoly")}
              uploadCategories={sectionCategories("protokoly")}
              uploadLabel="Dodaj podpisany protokół — przeciągnij skan albo kliknij"
              emptyText="Brak zapisanych protokołów w plikach."
            />
          </Card>
          {!fieldView && (
            <Card>
              <DocumentsSection
                caseId={caseId}
                organizationId={organizationId}
                userId={userId}
                caseRow={caseRow}
                payments={payments}
                onChange={onChange}
                variants={variants}
                linesByVariant={linesByVariant}
                defaultVariantId={selectedVariantId}
                categories={["protokół"]}
                heading="Protokół z wzoru"
                intro="Protokół odbioru końcowego, częściowego (z pozycjami wariantu) albo przekazania terenu. Zapisany PDF pojawi się na liście powyżej."
              />
            </Card>
          )}
        </DocGroup>
      )}

      {sections.includes("kosztorysy") && (
        <DocGroup id="kosztorysy">
          <AsBuiltEstimatesSection
            caseId={caseId}
            caseRow={caseRow}
            variants={variants}
            linesByVariant={linesByVariant}
            payments={payments}
            showFinances={showFinances}
            estimates={asBuiltEstimates}
            initialVariantId={selectedVariantId}
            onChange={onChange}
          />
          <Card>
            <h3 className="mb-2 text-sm font-bold text-ink">Kosztorysy zewnętrzne</h3>
            <AttachmentList
              {...listProps}
              items={files("kosztorysy")}
              uploadCategories={sectionCategories("kosztorysy")}
              uploadLabel="Dodaj kosztorys od kosztorysanta lub klienta"
              emptyText="Brak kosztorysów zewnętrznych."
            />
          </Card>
        </DocGroup>
      )}

      {sections.includes("pozostale") && (
        <DocGroup id="pozostale">
          <Card>
            <AttachmentList
              {...listProps}
              items={files("pozostale")}
              uploadCategories={sectionCategories("pozostale")}
              emptyText="Brak dokumentów w tej sekcji."
            />
          </Card>
          <Card>
            <DocumentsSection
              caseId={caseId}
              organizationId={organizationId}
              userId={userId}
              caseRow={caseRow}
              payments={payments}
              onChange={onChange}
              extras={extras}
              categories={["oświadczenie", "wezwanie do zapłaty"]}
              heading="Dokument z wzoru"
              intro="Klauzula RODO, potwierdzenie odbioru gotówki, oświadczenie VAT 8 %, wezwanie do zapłaty."
            />
          </Card>
        </DocGroup>
      )}

      {sections.includes("projekty") && (
        <DocGroup id="projekty">
          <Card>
            <AttachmentList
              {...listProps}
              items={files("projekty")}
              uploadCategories={sectionCategories("projekty")}
              uploadLabel="Dodaj projekt lub rysunek"
              emptyText="Brak projektów i rysunków."
            />
          </Card>
        </DocGroup>
      )}

      {sections.includes("zdjecia") && (
        <DocGroup id="zdjecia">
          <Card>
            <AttachmentList
              {...listProps}
              items={files("zdjecia")}
              uploadCategories={sectionCategories("zdjecia")}
              uploadLabel="Dodaj zdjęcie z budowy — przeciągnij albo kliknij"
              emptyText="Brak zdjęć i plików z budowy."
              gallery
            />
          </Card>
        </DocGroup>
      )}
    </div>
  );
}

function DocGroup({ id, children }: { id: DocSection; children: ReactNode }) {
  const meta = DOC_SECTIONS.find((s) => s.id === id);
  return (
    <section id={`dokumentacja-${id}`} className="grid min-w-0 scroll-mt-4 gap-3">
      <div>
        <h2 className="text-lg font-bold text-ink">{meta?.label}</h2>
        {meta?.hint ? <p className="text-xs text-steel">{meta.hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="min-w-0 rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">{children}</div>;
}
