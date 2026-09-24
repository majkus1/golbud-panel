import { renderToBuffer } from "@react-pdf/renderer";
import path from "node:path";
import { existsSync } from "node:fs";
import { createElement } from "react";
import { NextResponse } from "next/server";
import { DocumentPdfDocument } from "@/components/pdf/document-pdf-document";
import { getDocumentTemplate } from "@/lib/document-templates";
import { formatPlDate } from "@/lib/offer-pdf-helpers";
import { ORGANIZATION_OFFER_SELECT, sellerProfileFromOrganization } from "@/lib/organization-offer-profile";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";

type Body = {
  title?: string;
  body?: string;
  docNumber?: string | null;
  /** Wzór, z którego powstał dokument — z niego biorą się domyślne podpisy, strony i stopka. */
  templateId?: string | null;
  /** Podpisy poprawione w generatorze; pusta lista = bez podpisów na końcu. */
  signatures?: string[];
  /** Starsze pola (sprzed wzorów z oznaczeniami) — nadal obsługiwane. */
  showParties?: boolean;
  showSignatures?: boolean;
  signLeft?: string;
  signRight?: string;
};

/** Podpisy: z żądania, potem ze starszych pól, na końcu z konfiguracji wzoru. */
function resolveSignatures(payload: Body, templateSignatures: string[] | undefined): string[] {
  if (Array.isArray(payload.signatures)) return payload.signatures.map((s) => String(s).trim()).filter(Boolean);
  if (payload.showSignatures === false) return [];
  if (typeof payload.signLeft === "string" || typeof payload.signRight === "string") {
    return [payload.signLeft ?? "", payload.signRight ?? ""].map((s) => s.trim()).filter(Boolean);
  }
  return templateSignatures ?? ["Zamawiający", "Wykonawca"];
}

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;

  const auth = await getSupabaseUserClient(request);
  if (!auth) {
    return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  }
  const { supabase } = auth;

  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane" }, { status: 400 });
  }

  const title = (payload.title || "DOKUMENT").trim();
  const body = (payload.body || "").trim();
  if (!body) {
    return NextResponse.json({ error: "Treść dokumentu jest pusta" }, { status: 400 });
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
  const seller = sellerProfileFromOrganization(org);

  const logoPath = path.join(process.cwd(), "public", "logo-golbud.png");
  const logo = existsSync(logoPath) ? logoPath : null;

  const template = payload.templateId ? getDocumentTemplate(payload.templateId) : undefined;
  const parties = typeof payload.showParties === "boolean" ? (payload.showParties ? "boxes" : "none") : template?.parties ?? "boxes";

  const buffer = await renderToBuffer(
    createElement(DocumentPdfDocument, {
      logoPath: logo,
      title,
      docNumber: payload.docNumber || null,
      docDate: formatPlDate(new Date()),
      seller,
      parties,
      buyer: {
        name: caseRow.client_name,
        nip: caseRow.client_tax_id ?? null,
        address: caseRow.client_address || caseRow.location,
        city: null,
        phone: caseRow.phone,
        email: caseRow.email
      },
      body,
      signatures: resolveSignatures(payload, template?.signatures),
      footer: template?.footer ?? null
    }) as Parameters<typeof renderToBuffer>[0]
  );

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store"
    }
  });
}
