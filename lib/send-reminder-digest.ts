import nodemailer from "nodemailer";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") + "\u00a0zł";
}

// ── Row types ──────────────────────────────────────────────────────────────────

export type ReminderDigestRow = {
  id: string;
  remind_at: string;
  title: string;
  note: string | null;
  case_id: string;
  organization_id: string;
  client_name: string;
  status: string;
};

export type OverdueContactRow = {
  id: string;
  organization_id: string;
  client_name: string;
  status: string;
  next_contact_date: string;
};

export type ScheduleDigestRow = {
  id: string;
  case_id: string;
  organization_id: string;
  title: string;
  due_date: string;
  client_name: string;
  status: string;
};

export type PaymentDigestRow = {
  id: string;
  case_id: string;
  organization_id: string;
  title: string;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  client_name: string;
  status: string;
};

export type TaskDigestRow = {
  id: string;
  case_id: string;
  organization_id: string;
  title: string;
  due_date: string;
  client_name: string;
  case_status: string;
  assignee_emails: string[];
};

export type FleetDigestRow = {
  id: string;
  organization_id: string;
  name: string;
  registration_number: string | null;
  doc_label: string;
  expires: string;
  days_left: number;
};

export type WarehouseDigestRow = {
  id: string;
  organization_id: string;
  label: string;
  unit: string;
  quantity: number;
  min_quantity: number;
  location: string;
};

export type SupplierInvoiceDigestRow = {
  id: string;
  organization_id: string;
  case_id: string | null;
  supplier_name: string;
  invoice_number: string | null;
  due_date: string;
  category: string;
  gross_total: number;
  paid_amount: number;
  client_name: string | null;
};

export type EmployeeComplianceDigestRow = {
  id: string;
  organization_id: string;
  full_name: string;
  role_title: string;
  doc_label: string;
  expires: string | null;
  days_left: number | null;
};

export type ProfitabilityDigestRow = {
  id: string;
  organization_id: string;
  case_id: string | null;
  severity: "critical" | "warning" | "info" | "success";
  title: string;
  description: string;
  amount: number | null;
};

export type SettlementDigestRow = {
  id: string;
  organization_id: string;
  case_id: string | null;
  person_label: string;
  entry_type: string;
  amount: number;
  entry_date: string;
  title: string;
  client_name: string | null;
  data_scope: "operational" | "payroll";
};

export type StaleCaseDigestRow = {
  id: string;
  organization_id: string;
  client_name: string;
  status: string;
  location: string | null;
  last_activity_at: string;
  days_without_update: number;
};

// ── Send params ────────────────────────────────────────────────────────────────

export type DigestSendParams = {
  todayLabel: string;
  baseUrl: string;
  reminders: ReminderDigestRow[];
  overdueContacts: OverdueContactRow[];
  overdueSchedule: ScheduleDigestRow[];
  overduePayments: PaymentDigestRow[];
  overdueTasks: TaskDigestRow[];
  fleetAlerts: FleetDigestRow[];
  lowStockItems: WarehouseDigestRow[];
  upcomingPayments: PaymentDigestRow[];
  overdueCostInvoices: SupplierInvoiceDigestRow[];
  upcomingCostInvoices: SupplierInvoiceDigestRow[];
  employeeCompliance: EmployeeComplianceDigestRow[];
  profitabilityAlerts: ProfitabilityDigestRow[];
  settlements: SettlementDigestRow[];
  staleCases: StaleCaseDigestRow[];
  includeReminders: boolean;
  includeOverdueContact: boolean;
  includeSchedule: boolean;
  includePayments: boolean;
  includeTasks: boolean;
  includeFleet: boolean;
  includeWarehouse: boolean;
  includeProfitabilityAlerts: boolean;
  includeCostInvoices: boolean;
  includeEmployeeCompliance: boolean;
  includeSettlements: boolean;
  includeStaleCases: boolean;
  sendEmpty: boolean;
};

// ── SMTP ───────────────────────────────────────────────────────────────────────

function getSmtpTransporter() {
  const user = process.env.SMTP_GMAIL_USER;
  const pass = process.env.SMTP_GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("Brak SMTP_GMAIL_USER lub SMTP_GMAIL_APP_PASSWORD");
  return nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
}

function parseRecipients(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
}

// ── HTML builder ───────────────────────────────────────────────────────────────

function htmlRow(href: string, lines: string[]): string {
  return `<div style="margin-bottom:6px;padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;line-height:1.6;">
  ${lines.map((l) => `<div style="color:#1f2937;">${l}</div>`).join("\n  ")}
  <div style="margin-top:6px;"><a href="${href}" style="color:#166534;font-weight:600;font-size:12px;text-decoration:none;">&#8594; Otwórz sprawę</a></div>
</div>`;
}

function htmlSection(bg: string, border: string, emoji: string, title: string, rows: string[]): string {
  return `<div style="margin-bottom:28px;">
  <h2 style="margin:0 0 10px;padding:9px 14px;background:${bg};border-left:4px solid ${border};border-radius:0 4px 4px 0;font-size:13px;font-weight:700;color:#1f2937;">${emoji}&nbsp; ${escapeHtml(title)}</h2>
  ${rows.join("\n  ")}
</div>`;
}

function countItems(params: DigestSendParams): number {
  return (params.includeReminders ? params.reminders.length : 0)
    + (params.includeOverdueContact ? params.overdueContacts.length : 0)
    + (params.includeSchedule ? params.overdueSchedule.length : 0)
    + (params.includePayments ? params.overduePayments.length : 0)
    + (params.includeTasks ? params.overdueTasks.length : 0)
    + (params.includeFleet ? params.fleetAlerts.length : 0)
    + (params.includeWarehouse ? params.lowStockItems.length : 0)
    + (params.includePayments ? params.upcomingPayments.length : 0)
    + (params.includeProfitabilityAlerts ? params.profitabilityAlerts.length : 0)
    + (params.includeCostInvoices ? params.overdueCostInvoices.length + params.upcomingCostInvoices.length : 0)
    + (params.includeEmployeeCompliance ? params.employeeCompliance.length : 0)
    + (params.includeSettlements ? params.settlements.length : 0)
    + (params.includeStaleCases ? params.staleCases.length : 0);
}

export function buildReminderDigestHtml(params: DigestSendParams): string {
  const { todayLabel, baseUrl } = params;
  const b = baseUrl.replace(/\/$/, "");
  const sections: string[] = [];

  if (params.includeReminders && params.reminders.length > 0) {
    sections.push(htmlSection("#fef9c3", "#ca8a04", "&#9200;", `Przypomnienia (${params.reminders.length})`,
      params.reminders.map((r) => htmlRow(`${b}/cases/${r.case_id}`, [
        `<strong>${escapeHtml(r.title)}</strong> &mdash; ${escapeHtml(r.client_name)} <span style="color:#9ca3af;">(${escapeHtml(r.status)})</span>`,
        `Termin: ${escapeHtml(r.remind_at)}${r.note ? ` &mdash; ${escapeHtml(r.note)}` : ""}`
      ]))
    ));
  }

  if (params.includeOverdueContact && params.overdueContacts.length > 0) {
    sections.push(htmlSection("#fef9c3", "#ca8a04", "&#128222;", `Przeterminowany termin kontaktu (${params.overdueContacts.length})`,
      params.overdueContacts.map((c) => htmlRow(`${b}/cases/${c.id}`, [
        `<strong>${escapeHtml(c.client_name)}</strong> <span style="color:#9ca3af;">(${escapeHtml(c.status)})</span>`,
        `Termin kontaktu: ${escapeHtml(c.next_contact_date)}`
      ]))
    ));
  }

  if (params.includeSchedule && params.overdueSchedule.length > 0) {
    sections.push(htmlSection("#f0fdf4", "#16a34a", "&#128197;", `Etapy realizacji po terminie (${params.overdueSchedule.length})`,
      params.overdueSchedule.map((s) => htmlRow(`${b}/cases/${s.case_id}`, [
        `<strong>${escapeHtml(s.title)}</strong> &mdash; ${escapeHtml(s.client_name)} <span style="color:#9ca3af;">(${escapeHtml(s.status)})</span>`,
        `Termin etapu: ${escapeHtml(s.due_date)}`
      ]))
    ));
  }

  if (params.includePayments && params.overduePayments.length > 0) {
    sections.push(htmlSection("#fef2f2", "#dc2626", "&#128179;", `Płatności po terminie (${params.overduePayments.length})`,
      params.overduePayments.map((p) => {
        const rem = p.amount_due - p.amount_paid;
        const details = p.amount_paid > 0
          ? `Należność: ${money(p.amount_due)}, wpłacono: ${money(p.amount_paid)}, pozostało: ${money(rem)}`
          : `Należność: ${money(p.amount_due)}`;
        return htmlRow(`${b}/cases/${p.case_id}`, [
          `<strong>${escapeHtml(p.title)}</strong> &mdash; ${escapeHtml(p.client_name)} <span style="color:#9ca3af;">(${escapeHtml(p.status)})</span>`,
          `Termin płatności: ${escapeHtml(p.due_date)}`,
          escapeHtml(details)
        ]);
      })
    ));
  }

  if (params.includePayments && params.upcomingPayments.length > 0) {
    sections.push(htmlSection("#ecfdf5", "#16a34a", "&#128179;", `Płatności klientów w najbliższych 7 dniach (${params.upcomingPayments.length})`,
      params.upcomingPayments.map((p) => {
        const rem = p.amount_due - p.amount_paid;
        return htmlRow(`${b}/cases/${p.case_id}`, [
          `<strong>${escapeHtml(p.title)}</strong> &mdash; ${escapeHtml(p.client_name)} <span style="color:#9ca3af;">(${escapeHtml(p.status)})</span>`,
          `Termin: ${escapeHtml(p.due_date)} &mdash; do zebrania: ${escapeHtml(money(rem))}`
        ]);
      })
    ));
  }

  if (params.includeProfitabilityAlerts && params.profitabilityAlerts.length > 0) {
    sections.push(htmlSection("#fef2f2", "#991b1b", "&#9888;", `Rentowność i ucieczka marży (${params.profitabilityAlerts.length})`,
      params.profitabilityAlerts.map((a) => htmlRow(a.case_id ? `${b}/cases/${a.case_id}` : `${b}/reports/profitability`, [
        `<strong>${escapeHtml(a.title)}</strong>`,
        escapeHtml(a.description),
        a.amount === null ? "" : `Kwota: ${escapeHtml(money(a.amount))}`
      ].filter(Boolean)))
    ));
  }

  if (params.includeCostInvoices && params.overdueCostInvoices.length > 0) {
    sections.push(htmlSection("#fff1f2", "#e11d48", "&#128179;", `Faktury kosztowe po terminie (${params.overdueCostInvoices.length})`,
      params.overdueCostInvoices.map((i) => {
        const left = i.gross_total - i.paid_amount;
        return htmlRow(i.case_id ? `${b}/cases/${i.case_id}` : `${b}/reports/profitability`, [
          `<strong>${escapeHtml(i.supplier_name)}</strong>${i.invoice_number ? ` &mdash; ${escapeHtml(i.invoice_number)}` : ""}`,
          `Termin: ${escapeHtml(i.due_date)} &mdash; pozostało do zapłaty: ${escapeHtml(money(left))}`,
          `${escapeHtml(i.category)}${i.client_name ? ` &mdash; ${escapeHtml(i.client_name)}` : ""}`
        ]);
      })
    ));
  }

  if (params.includeCostInvoices && params.upcomingCostInvoices.length > 0) {
    sections.push(htmlSection("#fffbeb", "#d97706", "&#128197;", `Faktury kosztowe do zapłaty w 7 dni (${params.upcomingCostInvoices.length})`,
      params.upcomingCostInvoices.map((i) => {
        const left = i.gross_total - i.paid_amount;
        return htmlRow(i.case_id ? `${b}/cases/${i.case_id}` : `${b}/reports/profitability`, [
          `<strong>${escapeHtml(i.supplier_name)}</strong>${i.invoice_number ? ` &mdash; ${escapeHtml(i.invoice_number)}` : ""}`,
          `Termin: ${escapeHtml(i.due_date)} &mdash; do zapłaty: ${escapeHtml(money(left))}`,
          `${escapeHtml(i.category)}${i.client_name ? ` &mdash; ${escapeHtml(i.client_name)}` : ""}`
        ]);
      })
    ));
  }

  if (params.includeTasks && params.overdueTasks.length > 0) {
    sections.push(htmlSection("#f5f3ff", "#7c3aed", "&#10003;", `Zadania po terminie (${params.overdueTasks.length})`,
      params.overdueTasks.map((t) => {
        const lines = [
          `<strong>${escapeHtml(t.title)}</strong> &mdash; ${escapeHtml(t.client_name)} <span style="color:#9ca3af;">(${escapeHtml(t.case_status)})</span>`,
          `Termin: ${escapeHtml(t.due_date)}`
        ];
        if (t.assignee_emails.length > 0) {
          lines.push(`Przypisane do: ${t.assignee_emails.map(escapeHtml).join(", ")}`);
        }
        return htmlRow(`${b}/cases/${t.case_id}`, lines);
      })
    ));
  }

  if (params.includeFleet && params.fleetAlerts.length > 0) {
    sections.push(htmlSection("#eff6ff", "#2563eb", "&#128663;", `Flota i polisy — dokumenty (${params.fleetAlerts.length})`,
      params.fleetAlerts.map((v) => {
        const reg = v.registration_number ? ` (${escapeHtml(v.registration_number)})` : "";
        const when = v.days_left < 0 ? `po terminie (${Math.abs(v.days_left)} dni)` : `za ${v.days_left} dni`;
        const isPolicy = v.name.startsWith("Polisa:");
        const link = isPolicy ? `${b}/policies` : `${b}/vehicles/${v.id}`;
        const linkLabel = isPolicy ? "&#8594; Polisy firmowe" : "&#8594; Karta pojazdu";
        return `<div style="margin-bottom:6px;padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;line-height:1.6;">
  <div><strong>${escapeHtml(v.name)}</strong>${reg}</div>
  <div>${escapeHtml(v.doc_label)}: ${escapeHtml(v.expires)} — ${escapeHtml(when)}</div>
  <div style="margin-top:6px;"><a href="${link}" style="color:#166534;font-weight:600;font-size:12px;text-decoration:none;">${linkLabel}</a></div>
</div>`;
      })
    ));
  }

  if (params.includeEmployeeCompliance && params.employeeCompliance.length > 0) {
    sections.push(htmlSection("#fef9c3", "#ca8a04", "&#128188;", `Kadry: dokumenty i terminy (${params.employeeCompliance.length})`,
      params.employeeCompliance.map((e) => {
        const when = e.days_left === null
          ? "brak daty w systemie"
          : e.days_left < 0
            ? `po terminie (${Math.abs(e.days_left)} dni)`
            : `za ${e.days_left} dni`;
        return `<div style="margin-bottom:6px;padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;line-height:1.6;">
  <div><strong>${escapeHtml(e.full_name)}</strong> <span style="color:#6b7280;">${escapeHtml(e.role_title)}</span></div>
  <div>${escapeHtml(e.doc_label)}: ${e.expires ? escapeHtml(e.expires) : "brak daty"} — ${escapeHtml(when)}</div>
  <div style="margin-top:6px;"><a href="${b}/settings/organization" style="color:#166534;font-weight:600;font-size:12px;text-decoration:none;">&#8594; Organizacja</a></div>
</div>`;
      })
    ));
  }

  if (params.includeSettlements && params.settlements.length > 0) {
    const settlementLabel = params.settlements.some((row) => row.data_scope === "payroll") ? "Duże rozliczenia ekip i pracowników" : "Duże rozliczenia ekip i podwykonawców";
    sections.push(htmlSection("#f5f3ff", "#7c3aed", "&#128176;", `${settlementLabel} (${params.settlements.length})`,
      params.settlements.map((s) => htmlRow(s.case_id ? `${b}/cases/${s.case_id}` : `${b}/reports/profitability`, [
        `<strong>${escapeHtml(s.person_label)}</strong> &mdash; ${escapeHtml(s.title)}`,
        `${escapeHtml(s.entry_type)} · ${escapeHtml(s.entry_date)} · ${escapeHtml(money(s.amount))}`,
        s.client_name ? `Sprawa: ${escapeHtml(s.client_name)}` : "Bez przypisania do sprawy"
      ]))
    ));
  }

  if (params.includeStaleCases && params.staleCases.length > 0) {
    sections.push(htmlSection("#eff6ff", "#2563eb", "&#128221;", `Budowy bez aktualizacji (${params.staleCases.length})`,
      params.staleCases.map((c) => htmlRow(`${b}/cases/${c.id}`, [
        `<strong>${escapeHtml(c.client_name)}</strong>${c.location ? ` &mdash; ${escapeHtml(c.location)}` : ""} <span style="color:#9ca3af;">(${escapeHtml(c.status)})</span>`,
        `Brak świeżej aktualizacji od ${c.days_without_update} dni. Ostatnia aktywność: ${escapeHtml(c.last_activity_at.slice(0, 10))}`
      ]))
    ));
  }

  if (params.includeWarehouse && params.lowStockItems.length > 0) {
    sections.push(htmlSection("#fff7ed", "#ea580c", "&#128230;", `Magazyn — niski stan (${params.lowStockItems.length})`,
      params.lowStockItems.map((w) => `<div style="margin-bottom:6px;padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;line-height:1.6;">
  <div><strong>${escapeHtml(w.label)}</strong> — ${escapeHtml(String(w.quantity))} ${escapeHtml(w.unit)} (min. ${escapeHtml(String(w.min_quantity))})</div>
  <div style="color:#6b7280;">${escapeHtml(w.location)}</div>
  <div style="margin-top:6px;"><a href="${b}/warehouse" style="color:#166534;font-weight:600;font-size:12px;text-decoration:none;">&#8594; Magazyn</a></div>
</div>`)
    ));
  }

  const body = sections.length === 0
    ? `<p style="text-align:center;color:#9ca3af;padding:32px 0;font-size:13px;">Brak pozycji wymagających uwagi na dziś.</p>`
    : sections.join("\n");

  return `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#f3f4f6;">
<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
  <div style="background:#111827;padding:20px 24px;">
    <p style="margin:0;color:#ffffff;font-size:17px;font-weight:700;">GolBud Panel</p>
    <p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">Zestawienie na ${escapeHtml(todayLabel)}</p>
  </div>
  <div style="padding:24px 24px 16px;">
    <p style="margin:0 0 24px;font-size:13px;color:#6b7280;">Dzień dobry,<br>poniżej pozycje wymagające uwagi.</p>
    ${body}
    <p style="margin-top:24px;padding-top:14px;border-top:1px solid #f3f4f6;color:#d1d5db;font-size:11px;text-align:center;">
      Wiadomość wygenerowana automatycznie z panelu GolBud.
    </p>
  </div>
</div>
</body>
</html>`;
}

// ── Text builder ───────────────────────────────────────────────────────────────

export function buildReminderDigestText(params: DigestSendParams): string {
  const { todayLabel, baseUrl } = params;
  const b = baseUrl.replace(/\/$/, "");
  const parts: string[] = [`GolBud Panel — zestawienie na ${todayLabel}`, ""];

  if (params.includeReminders && params.reminders.length > 0) {
    parts.push(`PRZYPOMNIENIA (${params.reminders.length})`);
    for (const r of params.reminders) {
      parts.push(`• ${r.title} · ${r.client_name} (${r.status}) · termin: ${r.remind_at}${r.note ? ` — ${r.note}` : ""}`);
      parts.push(`  ${b}/cases/${r.case_id}`);
    }
    parts.push("");
  }

  if (params.includeOverdueContact && params.overdueContacts.length > 0) {
    parts.push(`PRZETERMINOWANY TERMIN KONTAKTU (${params.overdueContacts.length})`);
    for (const c of params.overdueContacts) {
      parts.push(`• ${c.client_name} (${c.status}) — termin kontaktu: ${c.next_contact_date}`);
      parts.push(`  ${b}/cases/${c.id}`);
    }
    parts.push("");
  }

  if (params.includeSchedule && params.overdueSchedule.length > 0) {
    parts.push(`ETAPY REALIZACJI PO TERMINIE (${params.overdueSchedule.length})`);
    for (const s of params.overdueSchedule) {
      parts.push(`• ${s.title} · ${s.client_name} (${s.status}) · termin etapu: ${s.due_date}`);
      parts.push(`  ${b}/cases/${s.case_id}`);
    }
    parts.push("");
  }

  if (params.includePayments && params.overduePayments.length > 0) {
    parts.push(`PLATNOSCI PO TERMINIE (${params.overduePayments.length})`);
    for (const p of params.overduePayments) {
      const rem = p.amount_due - p.amount_paid;
      const details = p.amount_paid > 0
        ? `naleznosc: ${money(p.amount_due)}, wplacono: ${money(p.amount_paid)}, pozostalo: ${money(rem)}`
        : `naleznosc: ${money(p.amount_due)}`;
      parts.push(`• ${p.title} · ${p.client_name} (${p.status}) · termin: ${p.due_date} · ${details}`);
      parts.push(`  ${b}/cases/${p.case_id}`);
    }
    parts.push("");
  }

  if (params.includePayments && params.upcomingPayments.length > 0) {
    parts.push(`PLATNOSCI KLIENTOW W 7 DNI (${params.upcomingPayments.length})`);
    for (const p of params.upcomingPayments) {
      parts.push(`• ${p.title} · ${p.client_name} (${p.status}) · termin: ${p.due_date} · do zebrania: ${money(p.amount_due - p.amount_paid)}`);
      parts.push(`  ${b}/cases/${p.case_id}`);
    }
    parts.push("");
  }

  if (params.includeProfitabilityAlerts && params.profitabilityAlerts.length > 0) {
    parts.push(`RENTOWNOSC I MARZA (${params.profitabilityAlerts.length})`);
    for (const a of params.profitabilityAlerts) {
      parts.push(`• ${a.title} — ${a.description}${a.amount === null ? "" : ` · ${money(a.amount)}`}`);
      parts.push(`  ${a.case_id ? `${b}/cases/${a.case_id}` : `${b}/reports/profitability`}`);
    }
    parts.push("");
  }

  if (params.includeCostInvoices && params.overdueCostInvoices.length > 0) {
    parts.push(`FAKTURY KOSZTOWE PO TERMINIE (${params.overdueCostInvoices.length})`);
    for (const i of params.overdueCostInvoices) {
      parts.push(`• ${i.supplier_name}${i.invoice_number ? ` / ${i.invoice_number}` : ""} — termin: ${i.due_date}, do zaplaty: ${money(i.gross_total - i.paid_amount)}${i.client_name ? ` · ${i.client_name}` : ""}`);
      parts.push(`  ${i.case_id ? `${b}/cases/${i.case_id}` : `${b}/reports/profitability`}`);
    }
    parts.push("");
  }

  if (params.includeCostInvoices && params.upcomingCostInvoices.length > 0) {
    parts.push(`FAKTURY KOSZTOWE W 7 DNI (${params.upcomingCostInvoices.length})`);
    for (const i of params.upcomingCostInvoices) {
      parts.push(`• ${i.supplier_name}${i.invoice_number ? ` / ${i.invoice_number}` : ""} — termin: ${i.due_date}, do zaplaty: ${money(i.gross_total - i.paid_amount)}${i.client_name ? ` · ${i.client_name}` : ""}`);
      parts.push(`  ${i.case_id ? `${b}/cases/${i.case_id}` : `${b}/reports/profitability`}`);
    }
    parts.push("");
  }

  if (params.includeTasks && params.overdueTasks.length > 0) {
    parts.push(`ZADANIA PO TERMINIE (${params.overdueTasks.length})`);
    for (const t of params.overdueTasks) {
      parts.push(`• ${t.title} · ${t.client_name} (${t.case_status}) · termin: ${t.due_date}`);
      if (t.assignee_emails.length > 0) parts.push(`  Przypisane: ${t.assignee_emails.join(", ")}`);
      parts.push(`  ${b}/cases/${t.case_id}`);
    }
    parts.push("");
  }

  if (params.includeFleet && params.fleetAlerts.length > 0) {
    parts.push(`FLOTA — DOKUMENTY (${params.fleetAlerts.length})`);
    for (const v of params.fleetAlerts) {
      const when = v.days_left < 0 ? `po terminie ${Math.abs(v.days_left)} dni` : `za ${v.days_left} dni`;
      parts.push(`• ${v.name}${v.registration_number ? ` (${v.registration_number})` : ""} — ${v.doc_label}: ${v.expires} (${when})`);
      parts.push(`  ${b}/vehicles/${v.id}`);
    }
    parts.push("");
  }

  if (params.includeEmployeeCompliance && params.employeeCompliance.length > 0) {
    parts.push(`KADRY: DOKUMENTY I TERMINY (${params.employeeCompliance.length})`);
    for (const e of params.employeeCompliance) {
      const when = e.days_left === null ? "brak daty" : e.days_left < 0 ? `po terminie ${Math.abs(e.days_left)} dni` : `za ${e.days_left} dni`;
      parts.push(`• ${e.full_name} (${e.role_title}) — ${e.doc_label}: ${e.expires || "brak daty"} (${when})`);
      parts.push(`  ${b}/settings/organization`);
    }
    parts.push("");
  }

  if (params.includeSettlements && params.settlements.length > 0) {
    const settlementLabel = params.settlements.some((row) => row.data_scope === "payroll") ? "DUZE ROZLICZENIA EKIP I PRACOWNIKOW" : "DUZE ROZLICZENIA EKIP I PODWYKONAWCOW";
    parts.push(`${settlementLabel} (${params.settlements.length})`);
    for (const s of params.settlements) {
      parts.push(`• ${s.person_label} — ${s.title} · ${s.entry_type} · ${money(s.amount)} · ${s.entry_date}${s.client_name ? ` · ${s.client_name}` : ""}`);
      parts.push(`  ${s.case_id ? `${b}/cases/${s.case_id}` : `${b}/reports/profitability`}`);
    }
    parts.push("");
  }

  if (params.includeStaleCases && params.staleCases.length > 0) {
    parts.push(`BUDOWY BEZ AKTUALIZACJI (${params.staleCases.length})`);
    for (const c of params.staleCases) {
      parts.push(`• ${c.client_name}${c.location ? ` · ${c.location}` : ""} (${c.status}) — brak aktualizacji od ${c.days_without_update} dni`);
      parts.push(`  ${b}/cases/${c.id}`);
    }
    parts.push("");
  }

  if (params.includeWarehouse && params.lowStockItems.length > 0) {
    parts.push(`MAGAZYN — NISKI STAN (${params.lowStockItems.length})`);
    for (const w of params.lowStockItems) {
      parts.push(`• ${w.label} — ${w.quantity} ${w.unit} (min. ${w.min_quantity}) · ${w.location}`);
      parts.push(`  ${b}/warehouse`);
    }
    parts.push("");
  }

  if (parts.length === 2) {
    parts.push("Brak pozycji wymagajacych uwagi na dzis.");
    parts.push("");
  }

  parts.push("— Panel GolBud");
  return parts.join("\n");
}

// ── Public send functions ──────────────────────────────────────────────────────

/** Jedna wiadomość na jeden adres. Zwraca null gdy brak treści i sendEmpty=false. */
export async function sendDigestToRecipient(
  to: string,
  params: DigestSendParams
): Promise<{ to: string; messageId: string | undefined } | null> {
  const n = countItems(params);
  if (n === 0 && !params.sendEmpty) return null;

  const from = process.env.SMTP_GMAIL_FROM || process.env.SMTP_GMAIL_USER;
  if (!from) throw new Error("Brak SMTP_GMAIL_USER / SMTP_GMAIL_FROM");

  const plural = n === 1 ? "pozycja" : n < 5 ? "pozycje" : "pozycji";
  const subject = n === 0
    ? `[GolBud] Brak pozycji do obsłużenia — ${params.todayLabel}`
    : `[GolBud] ${n} ${plural} do obsłużenia — ${params.todayLabel}`;

  const transporter = getSmtpTransporter();
  const info = await transporter.sendMail({
    from: `"GolBud Panel" <${from}>`,
    to,
    subject,
    text: buildReminderDigestText(params),
    html: buildReminderDigestHtml(params)
  });
  return { to, messageId: info.messageId };
}

/** Legacy: jedna wysyłka na listę z REMINDER_DIGEST_TO. */
export async function sendReminderDigestEmailLegacy(params: {
  todayLabel: string;
  baseUrl: string;
  reminders: ReminderDigestRow[];
  overdueContacts: OverdueContactRow[];
  overdueSchedule: ScheduleDigestRow[];
  overduePayments: PaymentDigestRow[];
  overdueTasks: TaskDigestRow[];
  fleetAlerts?: FleetDigestRow[];
  lowStockItems?: WarehouseDigestRow[];
  upcomingPayments?: PaymentDigestRow[];
  overdueCostInvoices?: SupplierInvoiceDigestRow[];
  upcomingCostInvoices?: SupplierInvoiceDigestRow[];
  employeeCompliance?: EmployeeComplianceDigestRow[];
  profitabilityAlerts?: ProfitabilityDigestRow[];
  settlements?: SettlementDigestRow[];
  staleCases?: StaleCaseDigestRow[];
}): Promise<{ to: string[]; messageId: string | undefined }> {
  const to = parseRecipients(process.env.REMINDER_DIGEST_TO);
  if (to.length === 0) throw new Error("Brak REMINDER_DIGEST_TO (adresy odbiorców, rozdzielone przecinkiem)");

  const sendEmpty = process.env.REMINDER_DIGEST_SEND_EMPTY === "1" || process.env.REMINDER_DIGEST_SEND_EMPTY === "true";
  const from = process.env.SMTP_GMAIL_FROM || process.env.SMTP_GMAIL_USER;
  if (!from) throw new Error("Brak SMTP_GMAIL_USER / SMTP_GMAIL_FROM");

  const fullParams: DigestSendParams = {
    ...params,
    fleetAlerts: params.fleetAlerts ?? [],
    lowStockItems: params.lowStockItems ?? [],
    upcomingPayments: params.upcomingPayments ?? [],
    overdueCostInvoices: params.overdueCostInvoices ?? [],
    upcomingCostInvoices: params.upcomingCostInvoices ?? [],
    employeeCompliance: params.employeeCompliance ?? [],
    profitabilityAlerts: params.profitabilityAlerts ?? [],
    settlements: params.settlements ?? [],
    staleCases: params.staleCases ?? [],
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
    sendEmpty
  };

  const n = countItems(fullParams);
  if (n === 0 && !sendEmpty) throw new Error("nothing_due");

  const plural = n === 1 ? "pozycja" : n < 5 ? "pozycje" : "pozycji";
  const subject = n === 0
    ? `[GolBud] Brak pozycji do obsłużenia — ${params.todayLabel}`
    : `[GolBud] ${n} ${plural} do obsłużenia — ${params.todayLabel}`;

  const transporter = getSmtpTransporter();
  const info = await transporter.sendMail({
    from: `"GolBud Panel" <${from}>`,
    to,
    subject,
    text: buildReminderDigestText(fullParams),
    html: buildReminderDigestHtml(fullParams)
  });
  return { to, messageId: info.messageId };
}
