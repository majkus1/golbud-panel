import { NextResponse } from "next/server";
import { AI_ESTIMATE_INSTRUCTION, normalizeAiEstimateRows } from "@/lib/estimate-import";
import { extractJsonFromFile, isPdfOrImage } from "@/lib/openai-file-extract";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024;
/** Role, które przygotowują wyceny — tylko one mogą zlecić (płatny) odczyt pliku przez AI. */
const OFFER_ROLES = new Set(["owner", "office", "manager", "sales"]);

/**
 * Odczyt kosztorysu z PDF albo zdjęcia (np. od kosztorysanta) przez AI.
 * Trasa niczego nie zapisuje — zwraca pozycje do podglądu; do oferty trafiają dopiero
 * zaznaczone przez użytkownika (ta sama tabela podglądu co przy CSV/XLSX).
 * Nie jest związana ze sprawą, bo działa też w formularzu nowego zapytania.
 */
export async function POST(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  const { supabase } = auth;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const form = await request.formData();
  const organizationId = String(form.get("organizationId") || "").trim();
  const file = form.get("file");
  if (!organizationId) return NextResponse.json({ error: "Brak firmy" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Brak pliku" }, { status: 400 });

  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member || !OFFER_ROLES.has(member.role as string)) {
    return NextResponse.json({ error: "Import kosztorysu jest dostępny dla osób przygotowujących wyceny." }, { status: 403 });
  }

  if (!isPdfOrImage(file.name, file.type)) {
    return NextResponse.json({ error: "Tutaj trafiają PDF i zdjęcia. CSV i Excel są odczytywane bez AI." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Plik jest za duży (maks. 15 MB)." }, { status: 400 });

  const result = await extractJsonFromFile({
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: file.type,
    instruction: AI_ESTIMATE_INSTRUCTION
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.reason === "not_configured" ? 503 : 502 });
  }

  const parsed = normalizeAiEstimateRows(result.data);
  if (parsed.lines.length === 0) {
    return NextResponse.json({ error: "Nie znaleziono pozycji kosztorysu w pliku." }, { status: 422 });
  }
  return NextResponse.json({
    lines: parsed.lines,
    sourceLabel: file.name,
    headerInfo: `${parsed.lines.length} pozycji odczytanych z pliku${parsed.skippedRows > 0 ? `, pominięto ${parsed.skippedRows} (sumy, puste)` : ""} — sprawdź ilości i ceny przed importem.`
  });
}
