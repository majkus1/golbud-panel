import { describe, expect, it } from "vitest";
import { buildGrid, compareDayEntries, formatTime, isoOf, priorityTone, shiftMonth } from "@/lib/calendar";

describe("siatka miesiąca", () => {
  it("zaczyna się w poniedziałek i ma 42 dni", () => {
    const grid = buildGrid(2026, 8); // wrzesień 2026, 1.09 to wtorek
    expect(grid).toHaveLength(42);
    expect(isoOf(grid[0])).toBe("2026-08-31");
    expect(grid[0].getDay()).toBe(1);
    expect(isoOf(grid[1])).toBe("2026-09-01");
  });

  it("przewija miesiące przez granicę roku", () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
  });
});

describe("kolory priorytetów", () => {
  it("pilne czerwone, ważne żółte, zwykłe i niskie zielone", () => {
    expect(priorityTone("pilne")).toBe("red");
    expect(priorityTone("wysoki")).toBe("yellow");
    expect(priorityTone("normalny")).toBe("green");
    expect(priorityTone("niski")).toBe("green");
  });
});

describe("godzina wpisu", () => {
  it("skraca format z bazy i odrzuca bzdury", () => {
    expect(formatTime("08:30:00")).toBe("08:30");
    expect(formatTime("8:05")).toBe("08:05");
    expect(formatTime("")).toBeNull();
    expect(formatTime(null)).toBeNull();
    expect(formatTime("25:00")).toBeNull();
  });

  it("w dniu najpierw wpisy z godziną, potem pilniejsze", () => {
    const items = [
      { title: "B", priority: "normalny" as const, due_time: null },
      { title: "A", priority: "pilne" as const, due_time: null },
      { title: "C", priority: "normalny" as const, due_time: "14:00:00" },
      { title: "D", priority: "niski" as const, due_time: "09:15:00" }
    ];
    expect(items.sort(compareDayEntries).map((i) => i.title)).toEqual(["D", "C", "A", "B"]);
  });
});
