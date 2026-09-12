import { NextResponse } from "next/server";
import {
  buildAsBuiltDisplayFileName,
  buildDefaultFooterNote,
  DEFAULT_SETTLEMENT_BASIS,
  AS_BUILT_ESTIMATE_TITLE,
  sumPaymentsPaid
} from "@/lib/as-built-estimate";
import { renderAsBuiltEstimatePdf } from "@/lib/render-as-built-estimate-pdf";
import { ORGANIZATION_OFFER_SELECT } from "@/lib/organization-offer-profile";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { CaseRow, OfferLine, Payment } from "@/lib/types";

export const runtime = "nodejs";

type GenerateBody = {
  variantId?: string;
  contractNumber?: string | null;
  contractDate?: string | null;
  pdfWorkDescription?: string | null;
  settlementBasis?: string | null;
  footerNote?: string | null;
  advancesPaid?: number | null;
  saveContractToCase?: boolean;
};

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await context.params;
    const auth = await getSupabaseUserClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
    }
    const { supabase } = auth;

    let body: GenerateBody;
    try {
      body = (await request.json()) as GenerateBody;
    } catch {
      return NextResponse.json({ error: "Nieprawidłowe dane wejściowe" }, { status: 400 });
    }

    const variantId = body.variantId?.trim();
    if (!variantId) {
      return NextResponse.json({ error: "Wybierz wariant kosztorysu" }, { status: 400 });
    }

    const { data: caseRow, error: cErr } = await supabase.from("case_records").select("*").eq("id", caseId).maybeSingle();
    if (cErr || !caseRow) {
      return NextResponse.json({ error: "Nie znaleziono sprawy" }, { status: 404 });
    }

    const { data: variant, error: vErr } = await supabase
      .from("offer_variants")
      .select("id, name, case_id, organization_id")
      .eq("id", variantId)
      .eq("case_id", caseId)
      .maybeSingle();
    if (vErr || !variant) {
      return NextResponse.json({ error: "Nie znaleziono wariantu oferty" }, { status: 404 });
    }

    const [{ data: org }, { data: linesRaw }, { data: paymentsRaw }] = await Promise.all([
      supabase.from("organizations").select(ORGANIZATION_OFFER_SELECT).eq("id", caseRow.organization_id).maybeSingle(),
      supabase.from("offer_lines").select("*").eq("variant_id", variantId).order("sort_order"),
      supabase.from("payments").select("*").eq("case_id", caseId).order("sort_order")
    ]);

    const lines = (linesRaw || []) as OfferLine[];
    if (lines.length === 0) {
      return NextResponse.json({ error: "Kosztorys nie ma pozycji — dodaj pozycje w zakładce Wycena / oferta" }, { status: 400 });
    }

    const row = caseRow as CaseRow;
    const contractNumber = body.contractNumber?.trim() || row.contract_number?.trim() || null;
    const contractDate = body.contractDate?.trim() || row.contract_date || null;
    const pdfWorkDescription = body.pdfWorkDescription?.trim() || row.work_description;
    const settlementBasis = body.settlementBasis?.trim() || DEFAULT_SETTLEMENT_BASIS;

    const payments = (paymentsRaw || []) as Payment[];
    const computedAdvances = sumPaymentsPaid(payments);
    const advancesPaid =
      body.advancesPaid != null && Number.isFinite(Number(body.advancesPaid))
        ? Number(body.advancesPaid)
        : computedAdvances;

    const footerNote =
      body.footerNote?.trim() ||
      buildDefaultFooterNote({ location: row.location, advancesPaid });

    const { buffer, snapshots, netTotal, balanceDue, gross } = await renderAsBuiltEstimatePdf({
      caseRow: { ...row, work_description: pdfWorkDescription },
      org,
      lines,
      contractNumber,
      contractDate,
      settlementBasis,
      footerNote,
      advancesPaid
    });

    const createdAt = new Date();
    const fileName = buildAsBuiltDisplayFileName(row.client_name, createdAt);
    const recordId = crypto.randomUUID();
    const storagePath = `${row.organization_id}/${caseId}/as-built-estimates/${recordId}.pdf`;

    const {
      data: { user: authUser }
    } = await supabase.auth.getUser();

    const { data: inserted, error: insErr } = await supabase
      .from("case_as_built_estimates")
      .insert({
        organization_id: row.organization_id,
        case_id: caseId,
        variant_id: variantId,
        variant_name: variant.name,
        title: AS_BUILT_ESTIMATE_TITLE,
        contract_number: contractNumber,
        contract_date: contractDate || null,
        pdf_work_description: pdfWorkDescription,
        settlement_basis: settlementBasis,
        footer_note: footerNote,
        net_total: netTotal,
        advances_paid: advancesPaid,
        balance_due: balanceDue,
        // Migawka stawki i kwot brutto — historia kosztorysów ma być odtwarzalna
        // niezależnie od późniejszej zmiany VAT w ustawieniach firmy.
        vat_rate: gross.vatRate,
        vat_total: gross.vatTotal,
        gross_total: gross.grossTotal,
        balance_due_gross: gross.balanceDueGross,
        line_count: snapshots.length,
        lines_snapshot: snapshots,
        storage_path: storagePath,
        file_name: fileName,
        size_bytes: buffer.byteLength,
        created_by: authUser?.id ?? null
      })
      .select("id, file_name, created_at, net_total, advances_paid, balance_due, vat_rate, vat_total, gross_total, balance_due_gross, line_count")
      .single();

    if (insErr || !inserted) {
      const msg = insErr?.message?.includes("case_as_built_estimates")
        ? "Baza nie ma tabeli kosztorysów powykonawczych. Uruchom migrację supabase/migrations/0031_case_as_built_estimates.sql."
        : insErr?.message || "Nie udało się zapisać rekordu";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Opcjonalna kopia w Storage — nie blokuje zapisu (PDF zawsze generowany z bazy).
    await supabase.storage.from("case-attachments").upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: true
    });

    if (body.saveContractToCase && (contractNumber || contractDate)) {
      await supabase
        .from("cases")
        .update({
          contract_number: contractNumber,
          contract_date: contractDate || null
        })
        .eq("id", caseId);
    }

    return NextResponse.json({
      id: inserted.id,
      fileName: inserted.file_name,
      createdAt: inserted.created_at,
      netTotal: inserted.net_total,
      advancesPaid: inserted.advances_paid,
      balanceDue: inserted.balance_due,
      lineCount: inserted.line_count
    });
  } catch (e) {
    console.error("as-built estimate POST", e);
    return NextResponse.json({ error: "Nie udało się wygenerować kosztorysu powykonawczego" }, { status: 500 });
  }
}
