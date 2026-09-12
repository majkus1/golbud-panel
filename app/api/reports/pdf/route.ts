import { renderToBuffer } from "@react-pdf/renderer";
import path from "node:path";
import { existsSync } from "node:fs";
import { createElement } from "react";
import { NextResponse } from "next/server";
import { ReportsPdfDocument } from "@/components/pdf/reports-pdf-document";
import { computeReportMetrics } from "@/lib/reports-metrics";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { CaseRow, Payment } from "@/lib/types";

export const runtime = "nodejs";

function safeDateParam(value: string | null): string {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export async function GET(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = safeDateParam(url.searchParams.get("from"));
  const to = safeDateParam(url.searchParams.get("to"));
  const organizationId = url.searchParams.get("organizationId")?.trim();

  const { supabase } = auth;

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }

  let orgId = organizationId || "";
  if (orgId) {
    const { data: mem } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("organization_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!mem) orgId = "";
  }
  if (!orgId) {
    const { data: mem } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    orgId = (mem?.organization_id as string | undefined) ?? "";
  }
  if (!orgId) {
    return NextResponse.json({ error: "Brak organizacji" }, { status: 403 });
  }

  const [{ data: cases }, { data: payments }, { data: org }] = await Promise.all([
    supabase.from("case_records").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("payments").select("*").eq("organization_id", orgId),
    supabase.from("organizations").select("name").eq("id", orgId).maybeSingle()
  ]);

  const metrics = computeReportMetrics((cases || []) as CaseRow[], (payments || []) as Payment[], from, to);

  const generatedAt = new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "long",
    timeStyle: "short"
  }).format(new Date());

  const logoPath = path.join(process.cwd(), "public", "logo-golbud.png");
  const logo = existsSync(logoPath) ? logoPath : null;

  const buffer = await renderToBuffer(
    createElement(ReportsPdfDocument, {
      organizationName: (org?.name as string | undefined) || "GolBud",
      logoPath: logo,
      generatedAt,
      metrics
    }) as Parameters<typeof renderToBuffer>[0]
  );

  const fname = `golbud-raport-${from || "od-poczatku"}-${to || "do-dzis"}`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fname}.pdf"`,
      "Cache-Control": "private, no-store"
    }
  });
}
