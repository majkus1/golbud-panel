import { NextResponse } from "next/server";
import { formatSmtpError, sendInvoiceEmail, type InvoiceEmailAttachment } from "@/lib/send-notification";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function money(value: number): string {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(value);
}

function safeFilename(name: string): string {
  return name.replace(/[^\w\s\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.]+/g, "_").slice(0, 90) || "faktura-kosztowa";
}

export async function POST(request: Request, context: { params: Promise<{ caseId: string; invoiceId: string }> }) {
  const { caseId, invoiceId } = await context.params;
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const { data: invoice } = await auth.supabase
    .from("supplier_invoices")
    .select("*, cases!inner(client_name, location, organization_id), attachments(file_name, storage_path, mime_type)")
    .eq("id", invoiceId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (!invoice) return NextResponse.json({ error: "Nie znaleziono faktury kosztowej" }, { status: 404 });

  const caseRow = Array.isArray(invoice.cases) ? invoice.cases[0] : invoice.cases;
  const attachment = Array.isArray(invoice.attachments) ? invoice.attachments[0] : invoice.attachments;
  const orgId = String(invoice.organization_id || caseRow?.organization_id || "");

  const { data: org } = await auth.supabase
    .from("organizations")
    .select("name, accountant_email")
    .eq("id", orgId)
    .maybeSingle();

  let body: { recipients?: unknown; subject?: unknown; message?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const defaultRecipient = typeof org?.accountant_email === "string" ? org.accountant_email.trim() : "";
  const recipients = Array.isArray(body.recipients)
    ? Array.from(new Set(body.recipients.map((r) => String(r).trim()).filter((r) => r && isEmail(r))))
    : defaultRecipient && isEmail(defaultRecipient)
      ? [defaultRecipient]
      : [];

  if (recipients.length === 0) {
    return NextResponse.json({ error: "Brak poprawnego adresu księgowej. Ustaw go w Ustawienia → Firma albo podaj odbiorcę." }, { status: 400 });
  }

  const supplier = String(invoice.supplier_name || "Dostawca");
  const number = invoice.invoice_number ? String(invoice.invoice_number) : "bez numeru";
  const gross = Number(invoice.gross_total || 0);
  const paid = Number(invoice.paid_amount || 0);
  const left = Math.max(0, gross - paid);
  const client = String(caseRow?.client_name || "sprawa");
  const location = caseRow?.location ? `, ${caseRow.location}` : "";

  const subject =
    typeof body.subject === "string" && body.subject.trim()
      ? body.subject.trim()
      : `Faktura kosztowa ${number} - ${supplier} - ${client}`;

  const message =
    typeof body.message === "string" && body.message.trim()
      ? body.message
      : [
          "Dzień dobry,",
          "",
          "przesyłam fakturę kosztową do zaksięgowania.",
          "",
          `Sprawa: ${client}${location}`,
          `Dostawca: ${supplier}`,
          `Numer faktury: ${number}`,
          `Kategoria: ${invoice.category}`,
          `Data faktury: ${invoice.invoice_date}`,
          `Termin płatności: ${invoice.due_date || "brak"}`,
          `Kwota brutto: ${money(gross)}`,
          `Zapłacono: ${money(paid)}`,
          `Pozostało do zapłaty: ${money(left)}`,
          invoice.notes ? `Uwagi: ${invoice.notes}` : "",
          "",
          "Pozdrawiam"
        ]
          .filter(Boolean)
          .join("\n");

  const attachments: InvoiceEmailAttachment[] = [];
  if (attachment?.storage_path) {
    const { data: blob, error } = await auth.supabase.storage.from("case-attachments").download(String(attachment.storage_path));
    if (error) return NextResponse.json({ error: `Nie udało się pobrać załącznika: ${error.message}` }, { status: 500 });
    const buffer = Buffer.from(await blob.arrayBuffer());
    attachments.push({
      filename: safeFilename(String(attachment.file_name || `Faktura_kosztowa_${number}`)),
      content: buffer,
      contentType: String(attachment.mime_type || "application/pdf")
    });
  }

  try {
    await sendInvoiceEmail({
      to: recipients,
      subject,
      message,
      attachments
    });
  } catch (err) {
    return NextResponse.json({ error: `Wysyłka nieudana: ${formatSmtpError(err)}` }, { status: 502 });
  }

  await auth.supabase
    .from("supplier_invoices")
    .update({ sent_at: new Date().toISOString(), sent_to: recipients.join(", ") })
    .eq("id", invoiceId)
    .eq("case_id", caseId);

  return NextResponse.json({ ok: true, sentTo: recipients, attached: attachments.length });
}
