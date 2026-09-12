import { renderToBuffer } from "@react-pdf/renderer";
import path from "node:path";
import { existsSync } from "node:fs";
import { createElement } from "react";
import { NextResponse } from "next/server";
import { OfferPdfDocument } from "@/components/pdf/offer-pdf-document";
import {
  addDays,
  buildOfferNumber,
  buildPdfLines,
  formatPlDate,
  sumPdfLines
} from "@/lib/offer-pdf-helpers";
import { ORGANIZATION_OFFER_SELECT, sellerProfileFromOrganization } from "@/lib/organization-offer-profile";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { OfferLine } from "@/lib/types";

export const runtime = "nodejs";

function safeFilename(name: string) {
  return name.replace(/[^\w\s\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.]+/g, "_").slice(0, 80) || "oferta";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string; variantId: string }> }
) {
  const { caseId, variantId } = await context.params;
  const auth = await getSupabaseUserClient(request);
  if (!auth) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }
  const { supabase } = auth;

  const { data: variant, error: vErr } = await supabase
    .from("offer_variants")
    .select("id, name, scope_notes, case_id, organization_id")
    .eq("id", variantId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (vErr || !variant) {
    return NextResponse.json({ error: "Nie znaleziono wariantu" }, { status: 404 });
  }

  const { data: caseRow, error: cErr } = await supabase.from("case_records").select("*").eq("id", caseId).maybeSingle();
  if (cErr || !caseRow) {
    return NextResponse.json({ error: "Nie znaleziono sprawy" }, { status: 404 });
  }

  const { data: org } = await supabase
    .from("organizations")
    .select(ORGANIZATION_OFFER_SELECT)
    .eq("id", caseRow.organization_id)
    .maybeSingle();

  const { data: linesRaw } = await supabase.from("offer_lines").select("*").eq("variant_id", variantId).order("sort_order");

  const lines = (linesRaw || []) as OfferLine[];
  const laborLines = lines.filter((l) => l.section === "labor");
  const materialLines = lines.filter((l) => l.section === "material");

  const seller = sellerProfileFromOrganization(org);
  const issue = new Date();
  const validUntil = addDays(issue, seller.validityDays);
  const offerNumber = buildOfferNumber(caseId, variant.name, caseRow.created_at);
  const pdfLines = buildPdfLines(laborLines, materialLines, seller.defaultVatRate);
  const { net: netTotal, vat: vatTotal, gross: grossTotal } = sumPdfLines(pdfLines);

  const logoPath = path.join(process.cwd(), "public", "logo-golbud.png");
  const logo = existsSync(logoPath) ? logoPath : null;

  const buffer = await renderToBuffer(
    createElement(OfferPdfDocument, {
      logoPath: logo,
      offerNumber,
      issueDate: formatPlDate(issue),
      validUntil: formatPlDate(validUntil),
      seller,
      buyer: {
        name: caseRow.client_name,
        phone: caseRow.phone,
        email: caseRow.email,
        location: caseRow.location
      },
      variantName: variant.name,
      workDescription: caseRow.work_description,
      scopeNotes: variant.scope_notes,
      pdfLines,
      netTotal,
      vatTotal,
      grossTotal,
      vatRate: seller.defaultVatRate
    }) as Parameters<typeof renderToBuffer>[0]
  );

  const fname = safeFilename(`Oferta_GolBud_${offerNumber}`);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fname}.pdf"`,
      "Cache-Control": "private, no-store"
    }
  });
}
