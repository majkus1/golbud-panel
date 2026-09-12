import { NextResponse } from "next/server";
import { renderAsBuiltEstimatePdfFromSnapshot } from "@/lib/render-as-built-estimate-pdf";
import { ORGANIZATION_OFFER_SELECT } from "@/lib/organization-offer-profile";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { AsBuiltLineSnapshot, CaseAsBuiltEstimate } from "@/lib/types";

export const runtime = "nodejs";

function asciiFilename(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ł/g, "l")
      .replace(/Ł/g, "L")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || "kosztorys_powykonawczy.pdf"
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string; estimateId: string }> }
) {
  const { caseId, estimateId } = await context.params;
  const auth = await getSupabaseUserClient(request);
  if (!auth) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }
  const { supabase } = auth;

  const { data: estimate, error } = await supabase
    .from("case_as_built_estimates")
    .select("*")
    .eq("id", estimateId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (error || !estimate) {
    return NextResponse.json({ error: "Nie znaleziono dokumentu" }, { status: 404 });
  }

  const row = estimate as CaseAsBuiltEstimate;

  const { data: caseRow, error: caseErr } = await supabase
    .from("cases")
    .select("client_name, location, work_description, organization_id")
    .eq("id", caseId)
    .maybeSingle();

  if (caseErr || !caseRow) {
    return NextResponse.json({ error: "Nie znaleziono sprawy" }, { status: 404 });
  }

  const { data: org } = await supabase
    .from("organizations")
    .select(ORGANIZATION_OFFER_SELECT)
    .eq("id", caseRow.organization_id)
    .maybeSingle();

  try {
    const buffer = await renderAsBuiltEstimatePdfFromSnapshot({
      caseRow: {
        ...caseRow,
        work_description: row.pdf_work_description?.trim() || caseRow.work_description
      },
      org,
      lines: (row.lines_snapshot || []) as AsBuiltLineSnapshot[],
      contractNumber: row.contract_number,
      contractDate: row.contract_date,
      settlementBasis: row.settlement_basis || "",
      footerNote: row.footer_note,
      netTotal: Number(row.net_total) || 0,
      advancesPaid: Number(row.advances_paid) || 0,
      balanceDue: Number(row.balance_due) || 0,
      // Starsze rekordy nie mają tych pól — renderer odtworzy wtedy dawny układ netto.
      vatRate: row.vat_rate ?? null,
      vatTotal: row.vat_total ?? null,
      grossTotal: row.gross_total ?? null,
      balanceDueGross: row.balance_due_gross ?? null,
      issueDate: new Date(row.created_at)
    });

    const fname = row.file_name.endsWith(".pdf") ? row.file_name : `${row.file_name}.pdf`;
    const safeHeaderName = asciiFilename(fname);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeHeaderName}"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (e) {
    console.error("as-built pdf render", e);
    return NextResponse.json({ error: "Nie udało się wygenerować PDF" }, { status: 500 });
  }
}
