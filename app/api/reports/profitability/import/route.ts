import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { buildSupplierInvoiceImportPreview, parseDelimitedInvoiceRows, type ImportSource, type RawInvoiceImportRow, type SupplierInvoiceImportPreviewRow } from "@/lib/supplier-invoice-import";
import { extractJsonFromFile } from "@/lib/openai-file-extract";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import type { CaseRow, SupplierInvoice, SupplierInvoiceCategoryRule } from "@/lib/types";

export const runtime = "nodejs";

async function resolveOrganizationId(supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseUserClient>>>["supabase"], userId: string, requestedOrgId: string | null) {
  const orgId = requestedOrgId?.trim();
  if (!orgId) return "";
  const { data } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  const role = data?.role as string | undefined;
  return data && ["owner", "office", "manager"].includes(role ?? "") ? orgId : "";
}

function sourceFromFile(file: File): ImportSource {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  if (name.endsWith(".pdf") || file.type.startsWith("image/")) return "ocr";
  return "csv";
}

function rowsFromWorkbook(buffer: ArrayBuffer): RawInvoiceImportRow[] {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<RawInvoiceImportRow>(sheet, { defval: "" });
}

const INVOICE_OCR_INSTRUCTION =
  "Odczytaj faktury kosztowe z pliku. Zwróć wyłącznie JSON array obiektów z polami: dostawca, numer faktury, data faktury, termin płatności, sprawa, kategoria, netto, brutto, zapłacono, uwagi. Jeśli pole nie istnieje, zostaw pusty string.";

async function rowsFromOcr(file: File): Promise<RawInvoiceImportRow[]> {
  const result = await extractJsonFromFile({
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: file.type,
    instruction: INVOICE_OCR_INSTRUCTION
  });
  if (!result.ok) throw new Error(result.error);
  return Array.isArray(result.data) ? (result.data as RawInvoiceImportRow[]) : [];
}

async function loadPreviewContext(supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseUserClient>>>["supabase"], organizationId: string) {
  const [{ data: cases }, { data: invoices }, { data: rules }] = await Promise.all([
    supabase.from("case_records").select("*").eq("organization_id", organizationId),
    supabase.from("supplier_invoices").select("*").eq("organization_id", organizationId),
    supabase.from("supplier_invoice_category_rules").select("*").eq("organization_id", organizationId).eq("active", true).order("priority")
  ]);
  return {
    cases: (cases || []) as CaseRow[],
    invoices: (invoices || []) as SupplierInvoice[],
    rules: (rules || []) as SupplierInvoiceCategoryRule[]
  };
}

export async function POST(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  const { supabase } = auth;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      organizationId?: string;
      source?: ImportSource;
      fileName?: string;
      rows?: SupplierInvoiceImportPreviewRow[];
    };
    const organizationId = await resolveOrganizationId(supabase, user.id, body.organizationId || null);
    if (!organizationId) return NextResponse.json({ error: "Brak dostępu do importu rentowności" }, { status: 403 });

    const rows = (body.rows || []).filter((row) => !row.duplicate && row.gross_total > 0);
    const duplicateCount = (body.rows || []).filter((row) => row.duplicate).length;
    const { data: batch, error: batchError } = await supabase
      .from("supplier_invoice_import_batches")
      .insert({
        organization_id: organizationId,
        source: body.source || "csv",
        file_name: body.fileName || null,
        row_count: rows.length,
        duplicate_count: duplicateCount,
        created_by: user.id
      })
      .select("id")
      .single();
    if (batchError) return NextResponse.json({ error: batchError.message }, { status: 400 });

    const payload = rows.map((row) => ({
      organization_id: organizationId,
      case_id: row.case_id,
      supplier_name: row.supplier_name,
      invoice_number: row.invoice_number,
      invoice_date: row.invoice_date,
      due_date: row.due_date,
      category: row.category,
      net_total: row.net_total,
      gross_total: row.gross_total,
      paid_amount: row.paid_amount,
      status: row.status,
      notes: row.notes,
      import_batch_id: batch.id,
      source: body.source || "csv",
      category_confidence: row.category_confidence,
      category_reason: row.category_reason,
      raw_import_data: row.raw,
      created_by: user.id
    }));
    const { error } = await supabase.from("supplier_invoices").insert(payload);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, inserted: payload.length, duplicateCount });
  }

  const form = await request.formData();
  const organizationId = await resolveOrganizationId(supabase, user.id, String(form.get("organizationId") || ""));
  if (!organizationId) return NextResponse.json({ error: "Brak dostępu do importu rentowności" }, { status: 403 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Brak pliku importu" }, { status: 400 });

  try {
    const source = sourceFromFile(file);
    const buffer = await file.arrayBuffer();
    const rows =
      source === "xlsx"
        ? rowsFromWorkbook(buffer)
        : source === "ocr"
          ? await rowsFromOcr(file)
          : parseDelimitedInvoiceRows(Buffer.from(buffer).toString("utf8"));
    const context = await loadPreviewContext(supabase, organizationId);
    const preview = buildSupplierInvoiceImportPreview({
      rows,
      cases: context.cases,
      existingInvoices: context.invoices,
      rules: context.rules
    });
    return NextResponse.json({ source, fileName: file.name, rows: preview });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się odczytać pliku." }, { status: 400 });
  }
}
