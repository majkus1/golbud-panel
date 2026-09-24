import { describe, expect, it } from "vitest";
import { scopeCalendarEntries } from "@/lib/digest-scope";
import { buildReminderDigestHtml, buildReminderDigestText, type CalendarEntryDigestRow, type DigestSendParams } from "@/lib/send-reminder-digest";

function entry(over: Partial<CalendarEntryDigestRow>): CalendarEntryDigestRow {
  return {
    id: "e1",
    organization_id: "org",
    case_id: null,
    title: "Pomiar u klienta",
    due_date: "2026-09-24",
    due_time: "09:30",
    priority: "pilne",
    note: null,
    client_name: null,
    created_by: "u-author",
    assignee_ids: [],
    ...over
  };
}

function params(entries: CalendarEntryDigestRow[]): DigestSendParams {
  return {
    todayLabel: "24 września 2026",
    baseUrl: "https://app.test/",
    reminders: [],
    overdueContacts: [],
    overdueSchedule: [],
    overduePayments: [],
    overdueTasks: [],
    calendarEntries: entries,
    fleetAlerts: [],
    lowStockItems: [],
    upcomingPayments: [],
    overdueCostInvoices: [],
    upcomingCostInvoices: [],
    employeeCompliance: [],
    profitabilityAlerts: [],
    settlements: [],
    staleCases: [],
    includeReminders: true,
    includeOverdueContact: true,
    includeSchedule: true,
    includePayments: true,
    includeTasks: true,
    includeFleet: true,
    includeWarehouse: true,
    includeProfitabilityAlerts: true,
    includeCostInvoices: true,
    includeEmployeeCompliance: true,
    includeSettlements: true,
    includeStaleCases: true,
    sendEmpty: false
  };
}

describe("wpisy z kalendarza w porannym podsumowaniu", () => {
  const rows = [entry({ id: "a" }), entry({ id: "b", created_by: "u-other", assignee_ids: ["u-worker"] }), entry({ id: "c", created_by: "u-other" })];

  it("zarząd widzi wszystkie, pozostali swoje i przypisane", () => {
    expect(scopeCalendarEntries(rows, "u-owner", null).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(scopeCalendarEntries(rows, "u-author", new Set()).map((r) => r.id)).toEqual(["a"]);
    expect(scopeCalendarEntries(rows, "u-worker", new Set()).map((r) => r.id)).toEqual(["b"]);
  });

  it("sekcja „Dziś w kalendarzu” z godziną, oznaczeniem pilności i linkiem", () => {
    const html = buildReminderDigestHtml(params([entry({}), entry({ id: "x", case_id: "case-1", client_name: "Kowalski — Ożarów", priority: "normalny", due_time: null })]));
    expect(html).toContain("Dziś w kalendarzu (2)");
    expect(html).toContain("<strong>09:30</strong>");
    expect(html).toContain("(pilne)");
    expect(html).toContain("https://app.test/calendar");
    expect(html).toContain("https://app.test/cases/case-1");
    expect(html).toContain("Otwórz kalendarz");

    const text = buildReminderDigestText(params([entry({})]));
    expect(text).toContain("DZIS W KALENDARZU (1)");
    expect(text).toContain("09:30 Pomiar u klienta (pilne)");
  });

  it("wyłączone zadania w preferencjach ukrywają też wpisy", () => {
    const html = buildReminderDigestHtml({ ...params([entry({})]), includeTasks: false });
    expect(html).not.toContain("Dziś w kalendarzu");
  });
});
