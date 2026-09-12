import { renderToBuffer } from "@react-pdf/renderer";
import { existsSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProfitabilityPdfDocument } from "@/components/pdf/profitability-pdf-document";
import { buildProfitabilitySummary } from "@/lib/profitability-report";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type {
  CaseDirectCost,
  CaseProfitabilityPlan,
  CaseRow,
  CaseSubcontractor,
  AggregatedLaborCost,
  Invoice,
  Payment,
  SubcontractorSettlementEntry,
  SupplierInvoice,
} from "@/lib/types";

export const runtime = "nodejs";

async function resolveOrganizationId(supabase: SupabaseClient, userId: string, requestedOrgId: string | null) {
  let orgId = requestedOrgId?.trim() || "";

  if (orgId) {
    const { data: mem } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    const role = mem?.role as string | undefined;
    if (!mem || !["owner", "office", "manager"].includes(role ?? "")) orgId = "";
  }

  if (!orgId) {
    const { data: mem } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", userId)
      .in("role", ["owner", "office", "manager"])
      .limit(1)
      .maybeSingle();
    orgId = (mem?.organization_id as string | undefined) ?? "";
  }

  return orgId;
}

export async function GET(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }

  const { supabase } = auth;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }

  const url = new URL(request.url);
  const orgId = await resolveOrganizationId(supabase, user.id, url.searchParams.get("organizationId"));
  if (!orgId) {
    return NextResponse.json({ error: "Brak dostępu do raportu rentowności" }, { status: 403 });
  }

  const [
    { data: cases },
    { data: payments },
    { data: salesInvoices },
    { data: aggregatedLaborCosts },
    { data: supplierInvoices },
    { data: profitabilityPlans },
    { data: caseSubcontractors },
    { data: subcontractorEntries },
    { data: directCosts },
    { data: org }
  ] = await Promise.all([
    supabase.from("case_records").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("payments").select("*").eq("organization_id", orgId),
    supabase.from("invoices").select("*").eq("organization_id", orgId),
    supabase.rpc("payroll_labor_costs_aggregated", { target_org: orgId }),
    supabase.from("supplier_invoices").select("*").eq("organization_id", orgId).order("invoice_date", { ascending: false }),
    supabase.from("case_profitability_plans").select("*").eq("organization_id", orgId),
    supabase.from("case_subcontractors").select("*").eq("organization_id", orgId),
    supabase.from("subcontractor_settlement_entries").select("*").eq("organization_id", orgId).order("entry_date", { ascending: false }),
    supabase.from("case_direct_costs").select("*").eq("organization_id", orgId).order("cost_date", { ascending: false }),
    supabase.from("organizations").select("name").eq("id", orgId).maybeSingle()
  ]);

  const summary = buildProfitabilitySummary({
    cases: (cases || []) as CaseRow[],
    payments: (payments || []) as Payment[],
    salesInvoices: (salesInvoices || []) as Invoice[],
    workHours: [],
    employees: [],
    employeeEntries: [],
    pieceworkEntries: [],
    employeeMonthlySettlements: [],
    supplierInvoices: (supplierInvoices || []) as SupplierInvoice[],
    profitabilityPlans: (profitabilityPlans || []) as CaseProfitabilityPlan[],
    caseSubcontractors: (caseSubcontractors || []) as CaseSubcontractor[],
    subcontractorEntries: (subcontractorEntries || []) as SubcontractorSettlementEntry[],
    directCosts: (directCosts || []) as CaseDirectCost[],
    aggregatedLaborCosts: (aggregatedLaborCosts || []) as AggregatedLaborCost[]
  });

  const generatedAt = new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "long",
    timeStyle: "short"
  }).format(new Date());

  const logoPath = path.join(process.cwd(), "public", "logo-golbud.png");
  const logo = existsSync(logoPath) ? logoPath : null;
  const organizationName = (org?.name as string | undefined) || "GOLBUD";

  const buffer = await renderToBuffer(
    createElement(ProfitabilityPdfDocument, {
      organizationName,
      logoPath: logo,
      generatedAt,
      summary
    }) as Parameters<typeof renderToBuffer>[0]
  );

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="golbud-raport-zarzadczy-rentownosc-${date}.pdf"`,
      "Cache-Control": "private, no-store"
    }
  });
}
