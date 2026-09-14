import { getSmtpFrom, getSmtpTransporter } from "@/lib/smtp-transport";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Połączenie SMTP jest wspólne dla powiadomień, faktur i digestu — lib/smtp-transport.ts.
// `formatSmtpError` zostaje wyeksportowany stąd, bo importują go trasy wysyłki faktur.
export { formatSmtpError } from "@/lib/smtp-transport";
const getFrom = getSmtpFrom;

function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return "http://localhost:3000";
}

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <h1 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${escapeHtml(title)}</h1>
        ${bodyHtml}
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#888;text-align:center;">
        Panel BuildFlow / GolBud
      </p>
    </div>
  </body></html>`;
}

// ── New case → email do ownerów ──────────────────────────────────────────────

export type NewCaseEmailParams = {
  to: string[];
  clientName: string;
  location: string | null;
  source: string;
  workDescription: string;
  caseId: string;
  createdByEmail: string | null;
};

export async function sendNewCaseEmail(p: NewCaseEmailParams): Promise<{ messageId?: string } | null> {
  if (p.to.length === 0) return null;
  const transporter = getSmtpTransporter();
  const url = `${appBaseUrl()}/cases/${p.caseId}`;

  const subject = `Nowe zapytanie: ${p.clientName}`;
  const body = `
    <p style="margin:0 0 12px;color:#444;">
      W panelu pojawiło się nowe zapytanie od klienta.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;">
      <tr><td style="padding:6px 0;color:#666;width:120px;">Klient:</td><td style="padding:6px 0;color:#111;font-weight:600;">${escapeHtml(p.clientName)}</td></tr>
      ${p.location ? `<tr><td style="padding:6px 0;color:#666;">Lokalizacja:</td><td style="padding:6px 0;color:#111;">${escapeHtml(p.location)}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#666;">Źródło:</td><td style="padding:6px 0;color:#111;">${escapeHtml(p.source)}</td></tr>
      ${p.createdByEmail ? `<tr><td style="padding:6px 0;color:#666;">Dodał(a):</td><td style="padding:6px 0;color:#111;">${escapeHtml(p.createdByEmail)}</td></tr>` : ""}
    </table>
    ${p.workDescription ? `<div style="background:#f7f7f4;border-radius:8px;padding:12px;margin:12px 0;color:#444;font-size:13px;white-space:pre-wrap;">${escapeHtml(p.workDescription)}</div>` : ""}
    <p style="margin:20px 0 0;">
      <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Otwórz sprawę</a>
    </p>
  `;

  const info = await transporter.sendMail({
    from: getFrom(),
    to: p.to.join(", "),
    subject,
    html: shell(subject, body),
    text: `Nowe zapytanie: ${p.clientName}\nLokalizacja: ${p.location || "—"}\nŹródło: ${p.source}\n\n${p.workDescription}\n\nOtwórz: ${url}`
  });

  return { messageId: info.messageId };
}

// ── Przypisano osobę do sprawy ───────────────────────────────────────────────

export type CaseAssignedEmailParams = {
  to: string;
  clientName: string;
  location: string | null;
  caseId: string;
  assignedByEmail: string | null;
};

export async function sendCaseAssignedEmail(p: CaseAssignedEmailParams): Promise<{ messageId?: string } | null> {
  const transporter = getSmtpTransporter();
  const url = `${appBaseUrl()}/cases/${p.caseId}`;

  const subject = `Zostałeś przypisany do sprawy: ${p.clientName}`;
  const body = `
    <p style="margin:0 0 12px;color:#444;">
      ${p.assignedByEmail ? `${escapeHtml(p.assignedByEmail)} przypisał(a) Cię do sprawy.` : "Zostałeś przypisany do sprawy."}
    </p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;">
      <tr><td style="padding:6px 0;color:#666;width:120px;">Klient:</td><td style="padding:6px 0;color:#111;font-weight:600;">${escapeHtml(p.clientName)}</td></tr>
      ${p.location ? `<tr><td style="padding:6px 0;color:#666;">Lokalizacja:</td><td style="padding:6px 0;color:#111;">${escapeHtml(p.location)}</td></tr>` : ""}
    </table>
    <p style="margin:20px 0 0;">
      <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Otwórz sprawę</a>
    </p>
  `;

  const info = await transporter.sendMail({
    from: getFrom(),
    to: p.to,
    subject,
    html: shell(subject, body),
    text: `Zostałeś przypisany do sprawy: ${p.clientName}\nLokalizacja: ${p.location || "—"}\n\nOtwórz: ${url}`
  });

  return { messageId: info.messageId };
}

// ── Nowe zadanie → mail do przypisanych ──────────────────────────────────────

export type NewTaskEmailParams = {
  to: string[];
  taskTitle: string;
  taskDescription: string | null;
  dueDate: string | null;
  priority: string;
  caseClientName: string | null;
  caseId: string | null;
  createdByEmail: string | null;
};

export async function sendNewTaskEmail(p: NewTaskEmailParams): Promise<{ messageId?: string } | null> {
  if (p.to.length === 0) return null;
  const transporter = getSmtpTransporter();
  const url = p.caseId ? `${appBaseUrl()}/cases/${p.caseId}` : `${appBaseUrl()}/tasks`;

  const subject = `Nowe zadanie: ${p.taskTitle}`;
  const body = `
    <p style="margin:0 0 12px;color:#444;">
      ${p.createdByEmail ? `${escapeHtml(p.createdByEmail)} dodał(a) Ci zadanie.` : "Dodano Ci nowe zadanie."}
    </p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;">
      <tr><td style="padding:6px 0;color:#666;width:120px;">Tytuł:</td><td style="padding:6px 0;color:#111;font-weight:600;">${escapeHtml(p.taskTitle)}</td></tr>
      ${p.caseClientName ? `<tr><td style="padding:6px 0;color:#666;">Sprawa:</td><td style="padding:6px 0;color:#111;">${escapeHtml(p.caseClientName)}</td></tr>` : ""}
      ${p.dueDate ? `<tr><td style="padding:6px 0;color:#666;">Termin:</td><td style="padding:6px 0;color:#111;">${escapeHtml(p.dueDate)}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#666;">Priorytet:</td><td style="padding:6px 0;color:#111;">${escapeHtml(p.priority)}</td></tr>
    </table>
    ${p.taskDescription ? `<div style="background:#f7f7f4;border-radius:8px;padding:12px;margin:12px 0;color:#444;font-size:13px;white-space:pre-wrap;">${escapeHtml(p.taskDescription)}</div>` : ""}
    <p style="margin:20px 0 0;">
      <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">${p.caseId ? "Otwórz sprawę" : "Otwórz zadania"}</a>
    </p>
  `;

  const info = await transporter.sendMail({
    from: getFrom(),
    to: p.to.join(", "),
    subject,
    html: shell(subject, body),
    text: `Nowe zadanie: ${p.taskTitle}\nSprawa: ${p.caseClientName || "—"}\nTermin: ${p.dueDate || "—"}\nPriorytet: ${p.priority}\n\n${p.taskDescription || ""}\n\nOtwórz: ${url}`
  });

  return { messageId: info.messageId };
}

// ── Nowy komentarz w dyskusji zadania ────────────────────────────────────────

export type TaskCommentEmailParams = {
  to: string[];
  taskTitle: string;
  commentBody: string;
  attachmentCount: number;
  authorEmail: string | null;
  caseClientName: string | null;
  taskId: string;
  caseId: string | null;
};

export async function sendTaskCommentEmail(p: TaskCommentEmailParams): Promise<{ messageId?: string } | null> {
  if (p.to.length === 0) return null;
  const transporter = getSmtpTransporter();
  const url = `${appBaseUrl()}/tasks`;

  const preview = p.commentBody.trim() || (p.attachmentCount > 0 ? "(załącznik bez tekstu)" : "");
  const attachNote =
    p.attachmentCount > 0
      ? `<p style="margin:8px 0 0;font-size:13px;color:#666;">📎 ${p.attachmentCount} ${p.attachmentCount === 1 ? "załącznik" : "załączniki"}</p>`
      : "";

  const subject = `Nowa wiadomość: ${p.taskTitle}`;
  const body = `
    <p style="margin:0 0 12px;color:#444;">
      ${p.authorEmail ? `<strong>${escapeHtml(p.authorEmail)}</strong> napisał(a) w dyskusji zadania.` : "Nowa wiadomość w dyskusji zadania."}
    </p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;">
      <tr><td style="padding:6px 0;color:#666;width:120px;">Zadanie:</td><td style="padding:6px 0;color:#111;font-weight:600;">${escapeHtml(p.taskTitle)}</td></tr>
      ${p.caseClientName ? `<tr><td style="padding:6px 0;color:#666;">Sprawa:</td><td style="padding:6px 0;color:#111;">${escapeHtml(p.caseClientName)}</td></tr>` : ""}
    </table>
    ${preview ? `<div style="background:#f7f7f4;border-radius:8px;padding:12px;margin:12px 0;color:#444;font-size:13px;white-space:pre-wrap;">${escapeHtml(preview)}</div>` : ""}
    ${attachNote}
    <p style="margin:20px 0 0;">
      <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Otwórz zadania</a>
    </p>
  `;

  const info = await transporter.sendMail({
    from: getFrom(),
    to: p.to.join(", "),
    subject,
    html: shell(subject, body),
    text: `${subject}\n${p.authorEmail || "Ktoś"}: ${preview}\n${p.attachmentCount ? `Załączników: ${p.attachmentCount}\n` : ""}\nOtwórz: ${url}`
  });

  return { messageId: info.messageId };
}

// ── Faktura → mail do klienta / księgowej (z załącznikiem PDF) ───────────────

export type InvoiceEmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type InvoiceEmailParams = {
  to: string[];
  subject: string;
  /** Treść wpisana przez użytkownika (zwykły tekst, zachowujemy znaki nowej linii). */
  message: string;
  attachments: InvoiceEmailAttachment[];
};

export async function sendInvoiceEmail(p: InvoiceEmailParams): Promise<{ messageId?: string } | null> {
  if (p.to.length === 0) return null;
  const transporter = getSmtpTransporter();

  const bodyHtml = `<div style="color:#444;font-size:14px;white-space:pre-wrap;line-height:1.6;">${escapeHtml(p.message)}</div>`;

  const info = await transporter.sendMail({
    from: getFrom(),
    to: p.to.join(", "),
    subject: p.subject,
    html: shell(p.subject, bodyHtml),
    text: p.message,
    attachments: p.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType || "application/pdf"
    }))
  });

  return { messageId: info.messageId };
}
