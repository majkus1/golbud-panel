import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describePurgeCounts, purgeBlockers, type PurgeCounts } from "@/lib/case-purge";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export const runtime = "nodejs";

/**
 * Trwałe usunięcie sprawy z kosza — tylko właściciel.
 * GET  — co zniknie i czy coś blokuje (do okna potwierdzenia),
 * POST — usuwa pliki ze Storage i samą sprawę (reszta kasuje się w bazie kaskadowo).
 */

type Authorized = { user: SupabaseClient; service: SupabaseClient; caseRow: { id: string; organization_id: string; client_name: string } };

async function authorize(request: Request, caseId: string): Promise<Authorized | NextResponse> {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  const {
    data: { user }
  } = await auth.supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const service = createSupabaseServiceClient();
  const { data: caseRow } = await service
    .from("cases")
    .select("id, organization_id, client_name, deleted_at")
    .eq("id", caseId)
    .maybeSingle();
  if (!caseRow) return NextResponse.json({ error: "Nie znaleziono sprawy" }, { status: 404 });

  const { data: member } = await service
    .from("organization_members")
    .select("role")
    .eq("organization_id", caseRow.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (member?.role !== "owner") {
    return NextResponse.json({ error: "Sprawę trwale usuwa tylko właściciel firmy" }, { status: 403 });
  }
  if (!caseRow.deleted_at) {
    return NextResponse.json({ error: "Najpierw przenieś sprawę do kosza" }, { status: 409 });
  }
  return { user: auth.supabase, service, caseRow };
}

async function countRows(service: SupabaseClient, table: string, caseId: string): Promise<number> {
  const { count } = await service.from(table).select("id", { count: "exact", head: true }).eq("case_id", caseId);
  return count ?? 0;
}

async function inspect(service: SupabaseClient, caseId: string) {
  const [{ data: salesInvoices }, { data: supplierInvoices }, payments, attachments, tasks, variants, protocols, notes] = await Promise.all([
    service.from("invoices").select("number, status").eq("case_id", caseId),
    service.from("supplier_invoices").select("invoice_number, supplier_name").eq("case_id", caseId),
    countRows(service, "payments", caseId),
    countRows(service, "attachments", caseId),
    countRows(service, "case_tasks", caseId),
    countRows(service, "offer_variants", caseId),
    countRows(service, "case_protocols", caseId),
    countRows(service, "case_notes", caseId)
  ]);
  const counts: PurgeCounts = { payments, attachments, tasks, variants, protocols, notes };
  const blockers = purgeBlockers({
    salesInvoices: (salesInvoices || []) as { number: string | null; status: string }[],
    supplierInvoices: (supplierInvoices || []) as { invoice_number: string | null; supplier_name: string | null }[]
  });
  return { counts, blockers, summary: describePurgeCounts(counts) };
}

/** Wszystkie pliki pod ścieżką (z podfolderami, np. as-built-estimates/). */
async function listAllFiles(service: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [prefix];
  while (queue.length) {
    const folder = queue.shift() as string;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await service.storage.from(bucket).list(folder, { limit: 1000, offset });
      if (error || !data || data.length === 0) break;
      for (const item of data) {
        const full = `${folder}/${item.name}`;
        // Folder w Storage nie ma identyfikatora.
        if (item.id === null) queue.push(full);
        else out.push(full);
      }
      if (data.length < 1000) break;
    }
  }
  return out;
}

async function removeFiles(service: SupabaseClient, bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    await service.storage.from(bucket).remove(paths.slice(i, i + 100));
  }
}

export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  const authorized = await authorize(request, caseId);
  if (authorized instanceof NextResponse) return authorized;
  const result = await inspect(authorized.service, caseId);
  return NextResponse.json({ clientName: authorized.caseRow.client_name, ...result });
}

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  const authorized = await authorize(request, caseId);
  if (authorized instanceof NextResponse) return authorized;
  const { service, user, caseRow } = authorized;

  const { blockers } = await inspect(service, caseId);
  if (blockers.length > 0) return NextResponse.json({ error: "Nie można usunąć trwale", blockers }, { status: 409 });

  // Ścieżki plików zbieramy przed usunięciem sprawy — potem kaskada skasuje wpisy z bazy.
  const { data: taskRows } = await service.from("case_tasks").select("id").eq("case_id", caseId);
  const taskIds = (taskRows || []).map((t) => t.id as string);
  const [caseFiles, taskFiles, aiFiles] = await Promise.all([
    listAllFiles(service, "case-attachments", `${caseRow.organization_id}/${caseId}`),
    taskIds.length
      ? service.from("case_task_comment_attachments").select("storage_path").in("task_id", taskIds).then(({ data }) => (data || []).map((r) => r.storage_path as string))
      : Promise.resolve([] as string[]),
    service.from("ai_message_attachments").select("storage_path").eq("case_id", caseId).then(({ data }) => (data || []).map((r) => r.storage_path as string))
  ]);

  // Usunięcie klientem użytkownika — dziennik zmian zapisze, kto usunął sprawę.
  const { error } = await user.from("cases").delete().eq("id", caseId);
  if (error) return NextResponse.json({ error: `Nie udało się usunąć sprawy: ${error.message}` }, { status: 500 });

  await removeFiles(service, "case-attachments", [...caseFiles, ...taskFiles.filter(Boolean)]);
  await removeFiles(service, "ai-attachments", aiFiles.filter(Boolean));

  return NextResponse.json({ ok: true, removedFiles: caseFiles.length + taskFiles.length + aiFiles.length });
}
