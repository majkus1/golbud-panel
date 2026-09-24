import { describe, expect, it } from "vitest";
import { buildPaymentsExportRows, paymentInPeriod } from "@/lib/payments-export";
import type { Payment } from "@/lib/types";

const payment = (over: Partial<Payment>): Payment =>
  ({ id: Math.random().toString(36), case_id: "c1", title: "Zaliczka", amount_due: 1000, amount_paid: 0, due_date: null, paid_at: null, ...over }) as Payment;

describe("eksport płatności do Excela", () => {
  it("okres liczy po terminie płatności, a bez terminu — po dniu wpłaty", () => {
    expect(paymentInPeriod(payment({ due_date: "2026-09-10" }), "2026-09-01", "2026-09-30")).toBe(true);
    expect(paymentInPeriod(payment({ due_date: "2026-10-01" }), "2026-09-01", "2026-09-30")).toBe(false);
    expect(paymentInPeriod(payment({ paid_at: "2026-09-15T10:00:00Z" }), "2026-09-01", "2026-09-30")).toBe(true);
    expect(paymentInPeriod(payment({}), "2026-09-01", "2026-09-30")).toBe(false);
    expect(paymentInPeriod(payment({}), "", "")).toBe(true);
  });

  it("sortuje po terminie (bez terminu na końcu), dokłada miejscowość i etap", () => {
    const cases = [
      { id: "c1", client_name: "Nowak", location: "Ożarów", status: "realizacja" as const },
      { id: "c2", client_name: "Adamczyk", location: null, status: "odbiór" as const }
    ];
    const rows = buildPaymentsExportRows(
      [
        payment({ case_id: "c1", title: "II transza", due_date: "2026-09-20", amount_paid: 250 }),
        payment({ case_id: "c2", title: "Bez terminu", paid_at: "2026-09-05T08:00:00Z" }),
        payment({ case_id: "c1", title: "I transza", due_date: "2026-09-02" }),
        payment({ case_id: "c1", title: "Poza okresem", due_date: "2026-11-02" })
      ],
      cases,
      "2026-09-01",
      "2026-09-30"
    );
    expect(rows.map((r) => r.title)).toEqual(["I transza", "II transza", "Bez terminu"]);
    expect(rows[1]).toMatchObject({ client: "Nowak", location: "Ożarów", stage: "realizacja", dueDate: "2026-09-20", balance: 750, paidAt: null });
    expect(rows[2]).toMatchObject({ client: "Adamczyk", location: "", dueDate: null, paidAt: "2026-09-05" });
  });
});
