import type { AttachmentCategory, CaseStatus } from "@/lib/types";

/**
 * Układ karty zlecenia — jedno miejsce, które mówi, jakie zakładki i sekcje widzi dana rola.
 *
 * Dawid pisał 11.09, że dokumenty są „porozrzucane”: umowy, protokoły, kosztorys
 * powykonawczy i pliki leżały w czterech zakładkach, trzy z nich schowane pod „Więcej”.
 * Teraz umowa ma własną zakładkę, a wszystko inne z budowy trafia do „Dokumentacji”.
 */

export type CaseTab =
  | "overview"
  | "offer"
  | "umowa"
  | "schedule"
  | "dokumentacja"
  | "invoices"
  | "payments"
  | "costs"
  | "tasks"
  | "emails"
  | "notes"
  | "reminders"
  | "subcontractors"
  | "extras"
  | "assistant";

export type DocSection = "umowy" | "protokoly" | "kosztorysy" | "pozostale" | "projekty" | "zdjecia";

export type CaseViewer = {
  /** Brygadzista, podwykonawca, pracownik — bez finansów i dokumentów handlowych. */
  fieldView: boolean;
  /** Właściciel, biuro, kierownik — faktury, płatności, koszty, przypomnienia. */
  showFinances: boolean;
  showAssistant: boolean;
};

type TabDef = { id: CaseTab; label: string; visible: (v: CaseViewer) => boolean };

const always = () => true;
const notField = (v: CaseViewer) => !v.fieldView;
const finances = (v: CaseViewer) => v.showFinances && !v.fieldView;

/** Kolejność zgodna z przebiegiem sprawy: wycena → umowa → realizacja → rozliczenie. */
const PRIMARY: TabDef[] = [
  { id: "overview", label: "Podsumowanie", visible: always },
  { id: "offer", label: "Wycena i oferta", visible: notField },
  { id: "umowa", label: "Umowa", visible: notField },
  { id: "schedule", label: "Harmonogram", visible: always },
  { id: "dokumentacja", label: "Dokumentacja", visible: always },
  { id: "invoices", label: "Faktury", visible: finances },
  { id: "payments", label: "Płatności", visible: finances },
  { id: "costs", label: "Koszty", visible: finances },
  { id: "tasks", label: "Zadania", visible: always },
  // Korespondencja z klientem to dana handlowa — role terenowe jej nie widzą.
  { id: "emails", label: "Korespondencja", visible: notField },
  { id: "notes", label: "Notatki", visible: always }
];

const MORE: TabDef[] = [
  { id: "reminders", label: "Przypomnienia", visible: finances },
  { id: "subcontractors", label: "Podwykonawcy", visible: notField },
  { id: "extras", label: "Roboty dodatkowe", visible: notField },
  { id: "assistant", label: "Asystent AI", visible: (v) => v.showAssistant }
];

export type TabItem = { id: CaseTab; label: string };

export function visibleTabs(viewer: CaseViewer): { primary: TabItem[]; more: TabItem[] } {
  const pick = (defs: TabDef[]) => defs.filter((d) => d.visible(viewer)).map(({ id, label }) => ({ id, label }));
  return { primary: pick(PRIMARY), more: pick(MORE) };
}

export const ALL_CASE_TABS: CaseTab[] = [...PRIMARY, ...MORE].map((d) => d.id);

/**
 * Stare adresy zakładek (linki w mailach, zakładki w przeglądarce) prowadzą do nowego miejsca.
 * `documents` był generatorem wzorów — dziś wzory są w Umowie i w sekcjach Dokumentacji.
 */
const LEGACY: Record<string, { tab: CaseTab; section?: DocSection }> = {
  documents: { tab: "dokumentacja", section: "pozostale" },
  files: { tab: "dokumentacja" },
  protocols: { tab: "dokumentacja", section: "protokoly" },
  "as-built": { tab: "dokumentacja", section: "kosztorysy" }
};

export function resolveTabParam(value: string | null | undefined): { tab: CaseTab; section?: DocSection } {
  if (!value) return { tab: "overview" };
  if ((ALL_CASE_TABS as string[]).includes(value)) return { tab: value as CaseTab };
  return LEGACY[value] ?? { tab: "overview" };
}

export const DOC_SECTIONS: { id: DocSection; label: string; hint: string; fieldVisible: boolean }[] = [
  { id: "umowy", label: "Umowy i aneksy", hint: "Te same pliki co w zakładce Umowa.", fieldVisible: false },
  { id: "protokoly", label: "Protokoły", hint: "Protokoły odbioru etapów i końcowe, przekazanie terenu.", fieldVisible: true },
  { id: "kosztorysy", label: "Kosztorysy i rozliczenia", hint: "Kosztorys powykonawczy i kosztorysy zewnętrzne.", fieldVisible: false },
  { id: "pozostale", label: "Pozostałe dokumenty", hint: "RODO, potwierdzenia gotówki, oświadczenia, wezwania do zapłaty.", fieldVisible: false },
  { id: "projekty", label: "Projekty i rysunki", hint: "Projekty elewacji, rzuty, rysunki od klienta.", fieldVisible: true },
  { id: "zdjecia", label: "Zdjęcia i pliki z budowy", hint: "Przed pracami, w trakcie, po zakończeniu, usterki, materiały.", fieldVisible: true }
];

export function visibleDocSections(viewer: Pick<CaseViewer, "fieldView">): DocSection[] {
  return DOC_SECTIONS.filter((s) => !viewer.fieldView || s.fieldVisible).map((s) => s.id);
}

const SECTION_BY_CATEGORY: Record<AttachmentCategory, DocSection> = {
  umowa: "umowy",
  aneks: "umowy",
  protokół: "protokoly",
  "kosztorys zewnętrzny": "kosztorysy",
  "wezwanie do zapłaty": "pozostale",
  oświadczenie: "pozostale",
  projekt: "projekty",
  "przed pracami": "zdjecia",
  "w trakcie": "zdjecia",
  "po zakończeniu": "zdjecia",
  usterki: "zdjecia",
  materiały: "zdjecia",
  inspiracje: "zdjecia"
};

/** Sekcja Dokumentacji, w której pokazujemy plik danej kategorii. */
export function attachmentSection(category: AttachmentCategory): DocSection {
  return SECTION_BY_CATEGORY[category] ?? "zdjecia";
}

/** Kategorie plików, które można wybrać przy dodawaniu w danej sekcji. */
export function sectionCategories(section: DocSection): AttachmentCategory[] {
  return (Object.keys(SECTION_BY_CATEGORY) as AttachmentCategory[]).filter((c) => SECTION_BY_CATEGORY[c] === section);
}

/**
 * Pasek procesu. „Zaliczka” przestała być osobnym etapem — nie każda umowa ją ma.
 * Status „zaliczka do wpłaty” należy do etapu Umowa.
 */
export const PROCESS_STEPS = [
  "Zapytanie",
  "Oferta",
  "Umowa",
  "Przygotowanie realizacji",
  "Realizacja",
  "Odbiór i rozliczenie"
] as const;

const STATUS_TO_STEP: Record<CaseStatus, number> = {
  "nowe zapytanie": 0,
  "do kontaktu": 0,
  "wysłano pytania": 0,
  "oczekujemy na zdjęcia/projekt": 0,
  "do wyceny": 1,
  "wycena wysłana": 1,
  "do decyzji klienta": 1,
  "umowa do podpisu": 2,
  "zaliczka do wpłaty": 2,
  "termin zarezerwowany": 3,
  realizacja: 4,
  odbiór: 5,
  rozliczone: 5,
  utracone: -1
};

/** Indeks etapu dla statusu; -1 dla sprawy utraconej. */
export function processStepForStatus(status: CaseStatus): number {
  return STATUS_TO_STEP[status] ?? 0;
}

const STEP_TARGET: { tab: CaseTab; section?: DocSection }[] = [
  { tab: "overview" },
  { tab: "offer" },
  { tab: "umowa" },
  { tab: "tasks" },
  { tab: "schedule" },
  { tab: "dokumentacja", section: "protokoly" }
];

/** Zakładka otwierana kliknięciem etapu; null, gdy rola jej nie widzi. */
export function stepToTab(step: number, viewer: CaseViewer): { tab: CaseTab; section?: DocSection } | null {
  const target = STEP_TARGET[step];
  if (!target) return null;
  const { primary, more } = visibleTabs(viewer);
  return [...primary, ...more].some((t) => t.id === target.tab) ? target : null;
}
