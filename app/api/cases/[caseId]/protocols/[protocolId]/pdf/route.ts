import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { NextResponse } from "next/server";
import { ProtocolPdfDocument } from "@/components/pdf/protocol-pdf-document";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { CaseProtocol } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string; protocolId: string }> }
) {
  const { caseId, protocolId } = await context.params;
  const auth = await getSupabaseUserClient(request);
  if (!auth) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }
  const { supabase } = auth;

  const { data: protocol, error: pErr } = await supabase
    .from("case_protocols")
    .select("*")
    .eq("id", protocolId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (pErr || !protocol) {
    return NextResponse.json({ error: "Nie znaleziono protokołu" }, { status: 404 });
  }

  const row = protocol as CaseProtocol;

  const { data: caseRow } = await supabase.from("case_records").select("*").eq("id", caseId).maybeSingle();
  if (!caseRow) {
    return NextResponse.json({ error: "Nie znaleziono sprawy" }, { status: 404 });
  }

  const { data: org } = await supabase.from("organizations").select("name").eq("id", caseRow.organization_id).maybeSingle();

  const created = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long" }).format(new Date(row.created_at));

  const buffer = await renderToBuffer(
    createElement(ProtocolPdfDocument, {
      organizationName: org?.name || "GolBud",
      clientName: caseRow.client_name,
      location: caseRow.location,
      protocolType: row.protocol_type,
      notes: row.notes,
      createdAt: created
    }) as Parameters<typeof renderToBuffer>[0]
  );

  const fname = `protokol-${row.protocol_type.replace(/\s+/g, "-")}`.slice(0, 80);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fname}.pdf"`,
      "Cache-Control": "private, no-store"
    }
  });
}
