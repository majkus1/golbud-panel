import { renderToBuffer } from "@react-pdf/renderer";
import path from "node:path";
import { existsSync } from "node:fs";
import { createElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InvoicePdfDocument } from "@/components/pdf/invoice-pdf-document";
import { INVOICE_KIND_IS_VAT, INVOICE_KIND_LABELS } from "@/lib/domain";
import { buildInvoicePdfLines, summarizeInvoice, vatBreakdown } from "@/lib/invoice";
import { formatPlDate } from "@/lib/offer-pdf-helpers";
import { ORGANIZATION_OFFER_SELECT, sellerProfileFromOrganization } from "@/lib/organization-offer-profile";
import type { Invoice, InvoiceKind, InvoiceLine } from "@/lib/types";

function plDateFromIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isFinite(d.getTime()) ? formatPlDate(d) : null;
}

export type RenderedInvoice = {
  buffer: Buffer;
  invoice: Invoice;
  lines: InvoiceLine[];
};

/**
 * Renderuje fakturę do bufora PDF (ten sam dokument co endpoint /pdf).
 * Używane przez pobieranie PDF oraz wysyłkę mailem (załącznik).
 */
export async function renderInvoicePdf(
  supabase: SupabaseClient,
  caseId: string,
  invoiceId: string
): Promise<RenderedInvoice | null> {
  const { data: invoiceRaw, error: invErr } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (invErr || !invoiceRaw) return null;
  const invoice = invoiceRaw as Invoice;

  const { data: linesRaw } = await supabase
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("sort_order");
  const lines = (linesRaw || []) as InvoiceLine[];

  const { data: org } = await supabase
    .from("organizations")
    .select(ORGANIZATION_OFFER_SELECT)
    .eq("id", invoice.organization_id)
    .maybeSingle();

  const seller = sellerProfileFromOrganization(org);
  const totals = summarizeInvoice(lines);
  const pdfLines = buildInvoicePdfLines(lines);
  const buckets = vatBreakdown(lines);
  const kind = invoice.kind as InvoiceKind;

  const logoPath = path.join(process.cwd(), "public", "logo-golbud.png");
  const logo = existsSync(logoPath) ? logoPath : null;

  const buffer = await renderToBuffer(
    createElement(InvoicePdfDocument, {
      logoPath: logo,
      title: INVOICE_KIND_LABELS[kind],
      isVatInvoice: INVOICE_KIND_IS_VAT[kind],
      invoiceNumber: invoice.number,
      issueDate: plDateFromIso(invoice.issue_date) ?? invoice.issue_date,
      saleDate: plDateFromIso(invoice.sale_date),
      dueDate: plDateFromIso(invoice.due_date),
      paymentMethod: invoice.payment_method,
      seller,
      buyer: {
        name: invoice.buyer_name,
        nip: invoice.buyer_nip,
        address: invoice.buyer_address,
        city: invoice.buyer_city,
        email: invoice.buyer_email
      },
      lines: pdfLines,
      vatBuckets: buckets,
      netTotal: totals.net,
      vatTotal: totals.vat,
      grossTotal: totals.gross,
      notes: invoice.notes
    }) as Parameters<typeof renderToBuffer>[0]
  );

  return { buffer: Buffer.from(buffer), invoice, lines };
}
