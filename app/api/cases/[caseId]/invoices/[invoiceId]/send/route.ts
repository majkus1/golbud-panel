import { NextResponse } from "next/server";
import { renderInvoicePdf } from "@/lib/render-invoice-pdf";
import { formatSmtpError, sendInvoiceEmail } from "@/lib/send-notification";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";

function safeFilename(name: string) {
  return name.replace(/[^\w\s\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.]+/g, "_").slice(0, 80) || "faktura";
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request, context: { params: Promise<{ caseId: string; invoiceId: string }> }) {
  const { caseId, invoiceId } = await context.params;
  const auth = await getSupabaseUserClient(request);
  if (!auth) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }

  let body: { recipients?: unknown; subject?: unknown; message?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane" }, { status: 400 });
  }

  const recipients = Array.isArray(body.recipients)
    ? Array.from(new Set(body.recipients.map((r) => String(r).trim()).filter((r) => r && isEmail(r))))
    : [];
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.message === "string" ? body.message : "";

  if (recipients.length === 0) {
    return NextResponse.json({ error: "Podaj przynajmniej jeden poprawny adres e-mail" }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: "Brak tematu wiadomości" }, { status: 400 });
  }

  const rendered = await renderInvoicePdf(auth.supabase, caseId, invoiceId);
  if (!rendered) {
    return NextResponse.json({ error: "Nie znaleziono faktury" }, { status: 404 });
  }

  const filename = `${safeFilename(`Faktura_${rendered.invoice.number.replace(/\//g, "_")}`)}.pdf`;

  try {
    await sendInvoiceEmail({
      to: recipients,
      subject,
      message,
      attachments: [{ filename, content: rendered.buffer, contentType: "application/pdf" }]
    });
  } catch (err) {
    return NextResponse.json({ error: `Wysyłka nieudana: ${formatSmtpError(err)}` }, { status: 502 });
  }

  await auth.supabase
    .from("invoices")
    .update({ sent_at: new Date().toISOString(), sent_to: recipients.join(", ") })
    .eq("id", invoiceId)
    .eq("case_id", caseId);

  return NextResponse.json({ ok: true, sentTo: recipients });
}
