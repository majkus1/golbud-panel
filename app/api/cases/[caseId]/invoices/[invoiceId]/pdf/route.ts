import { NextResponse } from "next/server";
import { renderInvoicePdf } from "@/lib/render-invoice-pdf";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";

function safeFilename(name: string) {
  return name.replace(/[^\w\s\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.]+/g, "_").slice(0, 80) || "faktura";
}

export async function GET(request: Request, context: { params: Promise<{ caseId: string; invoiceId: string }> }) {
  const { caseId, invoiceId } = await context.params;
  const auth = await getSupabaseUserClient(request);
  if (!auth) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }

  const rendered = await renderInvoicePdf(auth.supabase, caseId, invoiceId);
  if (!rendered) {
    return NextResponse.json({ error: "Nie znaleziono faktury" }, { status: 404 });
  }

  const fname = safeFilename(`Faktura_${rendered.invoice.number.replace(/\//g, "_")}`);
  return new NextResponse(new Uint8Array(rendered.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fname}.pdf"`,
      "Cache-Control": "private, no-store"
    }
  });
}
