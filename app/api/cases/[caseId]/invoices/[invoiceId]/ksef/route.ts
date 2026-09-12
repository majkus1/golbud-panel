import { NextResponse } from "next/server";
import { buildKsefFa2Xml } from "@/lib/ksef-fa2";
import { ORGANIZATION_OFFER_SELECT, sellerProfileFromOrganization } from "@/lib/organization-offer-profile";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { Invoice, InvoiceLine } from "@/lib/types";

export const runtime = "nodejs";

function safeFilename(name: string) {
  return name.replace(/[^\w\-.]+/g, "_").slice(0, 80) || "ksef";
}

/** Eksport faktury do uproszczonego XML w strukturze KSeF FA(2) — fundament integracji. */
export async function GET(request: Request, context: { params: Promise<{ caseId: string; invoiceId: string }> }) {
  const { caseId, invoiceId } = await context.params;
  const auth = await getSupabaseUserClient(request);
  if (!auth) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }
  const { supabase } = auth;

  const { data: invoiceRaw, error: invErr } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (invErr || !invoiceRaw) {
    return NextResponse.json({ error: "Nie znaleziono faktury" }, { status: 404 });
  }
  const invoice = invoiceRaw as Invoice;

  const { data: linesRaw } = await supabase
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("sort_order");
  const lines = (linesRaw || []) as InvoiceLine[];

  const { data: org } = await supabase
    .from("organizations")
    .select(ORGANIZATION_OFFER_SELECT)
    .eq("id", invoice.organization_id)
    .maybeSingle();

  const seller = sellerProfileFromOrganization(org);
  const xml = buildKsefFa2Xml({ invoice, lines, seller });

  const fname = safeFilename(`KSeF_${invoice.number.replace(/\//g, "_")}`);
  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}.xml"`,
      "Cache-Control": "private, no-store"
    }
  });
}
