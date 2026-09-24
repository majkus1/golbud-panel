import type { CaseRow, Payment } from "@/lib/types";

export type PaymentExportRow = {
  client: string;
  location: string;
  stage: string;
  title: string;
  /** ISO `rrrr-mm-dd` albo null — w Excelu jako prawdziwa data lub puste pole. */
  dueDate: string | null;
  amountDue: number;
  amountPaid: number;
  balance: number;
  paidAt: string | null;
};

/**
 * Data, po której płatność trafia do okresu: termin płatności, a gdy go nie ma —
 * dzień wpłaty. Pozycja bez żadnej daty nie należy do żadnego okresu.
 */
export function paymentPeriodDate(p: Pick<Payment, "due_date" | "paid_at">): string | null {
  return p.due_date || (p.paid_at ? p.paid_at.slice(0, 10) : null);
}

export function paymentInPeriod(p: Pick<Payment, "due_date" | "paid_at">, from: string, to: string): boolean {
  if (!from && !to) return true;
  const date = paymentPeriodDate(p);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/**
 * Wiersze eksportu „Płatności klienta” do Excela: tylko z wybranego okresu (dotąd eksport
 * brał wszystko, choć nazwa pliku sugerowała okres), posortowane po terminie, z miejscowością
 * i etapem obsługi sprawy, daty jako ISO (arkusz zamienia je na daty Excela).
 */
export function buildPaymentsExportRows(
  payments: Payment[],
  cases: Pick<CaseRow, "id" | "client_name" | "location" | "status">[],
  from: string,
  to: string
): PaymentExportRow[] {
  const caseById = new Map(cases.map((c) => [c.id, c]));
  return payments
    .filter((p) => paymentInPeriod(p, from, to))
    .map((p) => {
      const c = caseById.get(p.case_id);
      const amountDue = Number(p.amount_due || 0);
      const amountPaid = Number(p.amount_paid || 0);
      return {
        client: c?.client_name || "",
        location: c?.location || "",
        stage: c?.status || "",
        title: p.title,
        dueDate: p.due_date || null,
        amountDue,
        amountPaid,
        balance: Math.round((amountDue - amountPaid) * 100) / 100,
        paidAt: p.paid_at ? p.paid_at.slice(0, 10) : null
      };
    })
    .sort((a, b) => {
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
      return a.client.localeCompare(b.client, "pl");
    });
}
