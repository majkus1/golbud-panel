import { renderToBuffer } from "@react-pdf/renderer";
import path from "node:path";
import { existsSync } from "node:fs";
import { createElement } from "react";
import { NextResponse } from "next/server";
import { ContractPdfDocument } from "@/components/pdf/contract-pdf-document";
import { buildPdfLines, formatPlDate, roundMoney, sumPdfLines } from "@/lib/offer-pdf-helpers";
import { ORGANIZATION_OFFER_SELECT, sellerProfileFromOrganization } from "@/lib/organization-offer-profile";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { OfferLine } from "@/lib/types";

export const runtime = "nodejs";

function safeFilename(name: string) {
  return name.replace(/[^\w\s\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.]+/g, "_").slice(0, 80) || "umowa";
}

function plDateFromIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isFinite(d.getTime()) ? formatPlDate(d) : null;
}

function buildContractNumber(caseId: string, year: number): string {
  const digits = caseId.replace(/\D/g, "");
  const seq = String((parseInt(digits.slice(-4) || "1", 10) % 9999) + 1).padStart(4, "0");
  return `UM/${year}/${seq}`;
}

export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  const url = new URL(request.url);
  const variantId = url.searchParams.get("variantId");
  const advancePctRaw = Number(url.searchParams.get("advancePct"));
  const advancePct = Number.isFinite(advancePctRaw) ? Math.min(100, Math.max(0, advancePctRaw)) : 30;

  if (!variantId) {
    return NextResponse.json({ error: "Brak wariantu oferty" }, { status: 400 });
  }

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
  const seller = sellerProfileFromOrganization(org);
  const pdfLines = buildPdfLines(
    lines.filter((l) => l.section === "labor"),
    lines.filter((l) => l.section === "material"),
    seller.defaultVatRate
  );
  const { net, vat, gross } = sumPdfLines(pdfLines);
  const advanceAmount = roundMoney((gross * advancePct) / 100);
  const remainderAmount = roundMoney(gross - advanceAmount);

  const year = new Date().getFullYear();
  const contractNumber = buildContractNumber(caseId, year);

  const logoPath = path.join(process.cwd(), "public", "logo-golbud.png");
  const logo = existsSync(logoPath) ? logoPath : null;

  const buffer = await renderToBuffer(
    createElement(ContractPdfDocument, {
      logoPath: logo,
      contractNumber,
      contractDate: formatPlDate(new Date()),
      seller,
      buyer: {
        name: caseRow.client_name,
        nip: null,
        address: caseRow.location,
        city: null,
        phone: caseRow.phone,
        email: caseRow.email
      },
      subject: caseRow.work_description,
      scopeNotes: variant.scope_notes,
      variantName: variant.name,
      pdfLines,
      netTotal: net,
      vatTotal: vat,
      grossTotal: gross,
      vatRate: seller.defaultVatRate,
      advancePct,
      advanceAmount,
      remainderAmount,
      startDate: null,
      endDate: plDateFromIso(caseRow.realization_end_date)
    }) as Parameters<typeof renderToBuffer>[0]
  );

  const fname = safeFilename(`Umowa_${contractNumber.replace(/\//g, "_")}`);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fname}.pdf"`,
      "Cache-Control": "private, no-store"
    }
  });
}
