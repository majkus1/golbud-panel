import { renderToBuffer } from "@react-pdf/renderer";
import path from "node:path";
import { existsSync } from "node:fs";
import { createElement } from "react";
import { NextResponse } from "next/server";
import { FinancialControlPdfDocument } from "@/components/pdf/financial-control-pdf-document";
import { buildFinancialControlReport } from "@/lib/financial-control-report";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { CaseRow, Crew, FinancialControlItem, Payment } from "@/lib/types";

export const runtime = "nodejs";

function safeDateParam(value: string | null): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }

  const url = new URL(request.url);
  const asOfDate = safeDateParam(url.searchParams.get("asOfDate"));
  const organizationId = url.searchParams.get("organizationId")?.trim();
  const { supabase } = auth;

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }

  let orgId = organizationId || "";
  let memberRole = "";
  if (orgId) {
    const { data: mem } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("organization_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle();
    const role = mem?.role as string | undefined;
    memberRole = role || "";
    if (!mem || !["owner", "office", "manager"].includes(role ?? "")) orgId = "";
  }

  if (!orgId) {
    const { data: mem } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .in("role", ["owner", "office", "manager"])
      .limit(1)
      .maybeSingle();
    orgId = (mem?.organization_id as string | undefined) ?? "";
    memberRole = (mem?.role as string | undefined) ?? "";
  }

  if (!orgId) {
    return NextResponse.json({ error: "Brak dostępu do raportu finansowego" }, { status: 403 });
  }

  const [{ data: cases }, { data: payments }, { data: items }, { data: crews }, { data: org }] = await Promise.all([
    supabase.from("case_records").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("payments").select("*").eq("organization_id", orgId),
    supabase
      .from("financial_control_items")
      .select("*")
      .eq("organization_id", orgId)
      .eq("active", true)
      .order("section")
      .order("sort_order"),
    supabase.from("crews").select("*").eq("organization_id", orgId).order("name"),
    supabase.from("organizations").select("name").eq("id", orgId).maybeSingle()
  ]);

  const report = buildFinancialControlReport({
    asOfDate,
    cases: (cases || []) as CaseRow[],
    payments: (payments || []) as Payment[],
    items: (items || []) as FinancialControlItem[],
    crews: (crews || []) as Crew[],
    includeEmployeeSettlements: memberRole === "owner" || memberRole === "manager"
  });

  const generatedAt = new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "long",
    timeStyle: "short"
  }).format(new Date());

  const logoPath = path.join(process.cwd(), "public", "logo-golbud.png");
  const logo = existsSync(logoPath) ? logoPath : null;
  const organizationName = (org?.name as string | undefined) || "GOLBUD";

  const buffer = await renderToBuffer(
    createElement(FinancialControlPdfDocument, {
      organizationName,
      logoPath: logo,
      generatedAt,
      report
    }) as Parameters<typeof renderToBuffer>[0]
  );

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="golbud-rejestr-naleznosci-i-budow-${asOfDate}.pdf"`,
      "Cache-Control": "private, no-store"
    }
  });
}
