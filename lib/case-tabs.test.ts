import { describe, expect, it } from "vitest";
import { ATTACHMENT_CATEGORIES } from "./domain";
import {
  PROCESS_STEPS,
  attachmentSection,
  processStepForStatus,
  resolveTabParam,
  sectionCategories,
  stepToTab,
  visibleDocSections,
  visibleTabs,
  type CaseViewer
} from "./case-tabs";

const owner: CaseViewer = { fieldView: false, showFinances: true, showAssistant: true };
const sales: CaseViewer = { fieldView: false, showFinances: false, showAssistant: true };
const foreman: CaseViewer = { fieldView: true, showFinances: false, showAssistant: true };
const worker: CaseViewer = { fieldView: true, showFinances: false, showAssistant: false };

const ids = (items: { id: string }[]) => items.map((t) => t.id);

describe("visibleTabs", () => {
  it("właściciel widzi zakładki w kolejności pracy nad sprawą", () => {
    const { primary, more } = visibleTabs(owner);
    expect(ids(primary)).toEqual([
      "overview", "offer", "umowa", "schedule", "dokumentacja",
      "invoices", "payments", "costs", "tasks", "emails", "notes"
    ]);
    expect(ids(more)).toEqual(["reminders", "subcontractors", "extras", "assistant"]);
  });

  it("handlowiec nie widzi finansów", () => {
    const { primary, more } = visibleTabs(sales);
    expect(ids(primary)).not.toContain("invoices");
    expect(ids(primary)).not.toContain("payments");
    expect(ids(primary)).not.toContain("costs");
    expect(ids(more)).not.toContain("reminders");
    expect(ids(primary)).toContain("umowa");
  });

  it("brygadzista widzi budowę, bez oferty, umowy i korespondencji", () => {
    const { primary, more } = visibleTabs(foreman);
    expect(ids(primary)).toEqual(["overview", "schedule", "dokumentacja", "tasks", "notes"]);
    expect(ids(more)).toEqual(["assistant"]);
    expect(ids(visibleTabs(worker).more)).toEqual([]);
  });
});

describe("resolveTabParam", () => {
  it("przyjmuje obecne zakładki", () => {
    expect(resolveTabParam("offer")).toEqual({ tab: "offer" });
    expect(resolveTabParam("umowa")).toEqual({ tab: "umowa" });
  });

  it("stare adresy prowadzą do Dokumentacji we właściwej sekcji", () => {
    expect(resolveTabParam("protocols")).toEqual({ tab: "dokumentacja", section: "protokoly" });
    expect(resolveTabParam("as-built")).toEqual({ tab: "dokumentacja", section: "kosztorysy" });
    expect(resolveTabParam("files")).toEqual({ tab: "dokumentacja" });
    expect(resolveTabParam("documents")).toEqual({ tab: "dokumentacja", section: "pozostale" });
  });

  it("nieznany albo pusty parametr otwiera Podsumowanie", () => {
    expect(resolveTabParam(null)).toEqual({ tab: "overview" });
    expect(resolveTabParam("cokolwiek")).toEqual({ tab: "overview" });
  });
});

describe("sekcje Dokumentacji", () => {
  it("każda kategoria pliku ma swoją sekcję i da się ją wybrać przy dodawaniu", () => {
    for (const category of ATTACHMENT_CATEGORIES) {
      expect(sectionCategories(attachmentSection(category))).toContain(category);
    }
  });

  it("umowy i aneksy lądują w jednej sekcji, zdjęcia w innej", () => {
    expect(attachmentSection("umowa")).toBe("umowy");
    expect(attachmentSection("aneks")).toBe("umowy");
    expect(attachmentSection("usterki")).toBe("zdjecia");
    expect(attachmentSection("kosztorys zewnętrzny")).toBe("kosztorysy");
  });

  it("role terenowe widzą protokoły, projekty i zdjęcia", () => {
    expect(visibleDocSections({ fieldView: true })).toEqual(["protokoly", "projekty", "zdjecia"]);
    expect(visibleDocSections({ fieldView: false })).toHaveLength(6);
  });
});

describe("pasek procesu", () => {
  it("zaliczka nie jest osobnym etapem", () => {
    expect(PROCESS_STEPS).not.toContain("Zaliczka");
    expect(processStepForStatus("zaliczka do wpłaty")).toBe(processStepForStatus("umowa do podpisu"));
  });

  it("termin zarezerwowany to przygotowanie realizacji", () => {
    expect(PROCESS_STEPS[processStepForStatus("termin zarezerwowany")]).toBe("Przygotowanie realizacji");
    expect(PROCESS_STEPS[processStepForStatus("odbiór")]).toBe("Odbiór i rozliczenie");
    expect(processStepForStatus("utracone")).toBe(-1);
  });

  it("kliknięcie etapu otwiera zakładkę, jeśli rola ją widzi", () => {
    expect(stepToTab(1, owner)).toEqual({ tab: "offer" });
    expect(stepToTab(2, owner)).toEqual({ tab: "umowa" });
    expect(stepToTab(5, foreman)).toEqual({ tab: "dokumentacja", section: "protokoly" });
    expect(stepToTab(1, foreman)).toBeNull();
    expect(stepToTab(9, owner)).toBeNull();
  });
});
