import { renderToBuffer } from "@react-pdf/renderer";
import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { NextResponse } from "next/server";
import { AiReportPdfDocument } from "@/components/pdf/ai-report-pdf-document";
import {
  buildAssistantContext,
  buildAssistantQueryContext,
  canAccessAssistantCase,
  deriveConversationTitle,
  generateAssistantAnswer,
  getOrCreateConversation,
  loadAssistantAttachmentContext,
  OpenAiAssistantError,
  reportPrompt,
  resolveAssistantAccess,
  type AssistantReportFormat,
  type AssistantReportType
} from "@/lib/ai-assistant";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";

function safeFilePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (m) => ({ ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" }[m] || m))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function reportTypeLabel(type: AssistantReportType): string {
  const labels: Record<AssistantReportType, string> = {
    case_summary: "Raport sprawy",
    financial_control: "Raport należności i kontroli finansów",
    profitability: "Raport rentowności",
    hr: "Raport HR i terminów",
    monthly_owner: "Raport właścicielski"
  };
  return labels[type] || "Raport AI";
}

async function xlsxBuffer(title: string, subtitle: string, content: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GolBud Asystent AI";
  wb.created = new Date();
  const ws = wb.addWorksheet("Raport AI", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 30 }, { width: 90 }];
  ws.mergeCells("A1:B1");
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF17201B" } };
  ws.getCell("A2").value = "Zakres";
  ws.getCell("B2").value = subtitle;
  ws.getRow(2).font = { color: { argb: "FF5D6B66" } };
  ws.addRow([]);
  ws.addRow(["Sekcja", "Treść"]);
  ws.getRow(4).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3F5239" } };
  });
  const chunks = content.split(/\n(?=#{1,3}\s|\d+\.\s)/g).map((part) => part.trim()).filter(Boolean);
  for (const chunk of chunks.length ? chunks : [content]) {
    const [first, ...rest] = chunk.split("\n");
    ws.addRow([first.replace(/^#{1,3}\s*/, "").replace(/^\d+\.\s*/, ""), rest.join("\n") || first]);
  }
  ws.eachRow((row) => row.eachCell((cell) => {
    cell.alignment = { vertical: "top", wrapText: true };
    cell.border = { bottom: { style: "hair", color: { argb: "FFE2E0DA" } } };
  }));
  return wb.xlsx.writeBuffer();
}

export async function POST(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  const { supabase } = auth;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const body = (await request.json()) as {
    organizationId?: string;
    caseId?: string | null;
    conversationId?: string | null;
    reportType?: AssistantReportType;
    format?: AssistantReportFormat;
    prompt?: string;
    attachmentIds?: string[];
  };
  const format = body.format === "xlsx" ? "xlsx" : "pdf";
  const reportType = body.reportType || (body.caseId ? "case_summary" : "monthly_owner");
  const REPORT_TYPE_LABELS: Record<AssistantReportType, string> = {
    case_summary: "Raport sprawy",
    financial_control: "Raport kontroli finansowej",
    profitability: "Raport rentowności",
    hr: "Raport kadrowy",
    monthly_owner: "Raport miesięczny właścicielski"
  };

  const access = await resolveAssistantAccess(supabase, user.id, body.organizationId);
  if (!access) return NextResponse.json({ error: "Brak dostępu do organizacji." }, { status: 403 });
  if (!access.canUseAssistant) return NextResponse.json({ error: "Asystent AI nie jest dostępny dla Twojej roli." }, { status: 403 });
  if (body.caseId && !(await canAccessAssistantCase(supabase, access, user.id, body.caseId))) {
    return NextResponse.json({ error: "Brak dostępu do tej sprawy." }, { status: 403 });
  }

  try {
    const conversation = await getOrCreateConversation(supabase, access, user.id, {
      conversationId: body.conversationId,
      caseId: body.caseId || null,
      title: deriveConversationTitle(body.prompt, REPORT_TYPE_LABELS[reportType])
    });
    const ctx = await buildAssistantContext(supabase, access, { scope: body.caseId ? "case" : "global", caseId: body.caseId || null });
    const finalPrompt = reportPrompt(reportType, body.prompt);
    const retrieved = await buildAssistantQueryContext(supabase, access, finalPrompt, body.caseId || null);
    ctx.contextText = `${retrieved.text}\n\n${ctx.contextText}`;
    const attachmentIds = Array.from(new Set((body.attachmentIds || []).map((id) => id.trim()).filter(Boolean))).slice(0, 8);
    const attachmentContext = await loadAssistantAttachmentContext(supabase, access, attachmentIds);
    const { content } = await generateAssistantAnswer(
      ctx,
      finalPrompt,
      [],
      attachmentContext.text || undefined
    );
    const { data: org } = await supabase.from("organizations").select("name").eq("id", access.organizationId).maybeSingle();
    const generatedAt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short" }).format(new Date());
    const title = reportTypeLabel(reportType);
    const subtitle = `${ctx.contextTitle} · dokument zarządczy GolBud AI`;
    const fileName = `golbud-ai-${safeFilePart(reportType)}-${new Date().toISOString().slice(0, 10)}.${format}`;

    await supabase.from("ai_generated_artifacts").insert({
      organization_id: access.organizationId,
      conversation_id: conversation.id,
      case_id: body.caseId || null,
      artifact_type: format,
      report_type: reportType,
      title,
      file_name: fileName,
      created_by: user.id
    });

    // Rozmowy i raporty Asystenta AI są w pełni prywatne (patrz migracja 0050) — nie
    // logujemy ich w ogólnofirmowym Dzienniku zmian. Ślad zostaje w `ai_generated_artifacts`
    // (created_by), widocznym tylko dla autora.

    if (format === "xlsx") {
      const buffer = await xlsxBuffer(title, subtitle, content);
      return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "private, no-store"
        }
      });
    }

    const logoPath = path.join(process.cwd(), "public", "logo-golbud.png");
    const buffer = await renderToBuffer(
      createElement(AiReportPdfDocument, {
        organizationName: (org?.name as string | undefined) || "GOLBUD",
        logoPath: existsSync(logoPath) ? logoPath : null,
        title,
        subtitle,
        generatedAt,
        generatedBy: user.email || "użytkownik",
        content
      }) as Parameters<typeof renderToBuffer>[0]
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    if (error instanceof OpenAiAssistantError) {
      return NextResponse.json({ error: error.message }, { status: error.status && error.status >= 500 ? 502 : 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się wygenerować raportu." }, { status: 400 });
  }
}
