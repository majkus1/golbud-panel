import { NextResponse } from "next/server";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { loadCredentials, resolveMailboxForCase, type MailAccount } from "@/lib/mail/account";
import type { MailboxCredentials } from "@/lib/mail/imap-client";

/**
 * Wspólna autoryzacja tras korespondencji. Kolejność kroków jest istotna i celowo
 * ta sama co w `/api/notify`: najpierw sesja, potem dostęp do sprawy egzekwowany przez RLS,
 * potem rola, a klucz service role wchodzi dopiero na końcu — wyłącznie po to,
 * żeby odszyfrować hasło skrzynki.
 */

/** Korespondencja z klientem to dana handlowa — role terenowe jej nie widzą (jak `can_see_case_commercial`). */
const COMMERCIAL_ROLES = new Set(["owner", "office", "manager", "sales"]);

export type CaseMailContext = {
  userId: string;
  organizationId: string;
  caseRow: { id: string; client_name: string; email: string | null; organization_id: string; created_by: string | null };
  /** Zawsze skrzynka osoby zalogowanej — patrz `resolveMailboxForCase`. */
  account: MailAccount;
  credentials: MailboxCredentials;
  /** Klient z sesją użytkownika — do odczytów, które mają przejść przez RLS. */
  supabaseUser: CaseAccess["supabase"];
  service: ReturnType<typeof createSupabaseServiceClient>;
};

export type CaseMailFailure = { response: NextResponse };

function fail(message: string, status: number, extra?: Record<string, unknown>): CaseMailFailure {
  return { response: NextResponse.json({ error: message, ...extra }, { status }) };
}

export function isCaseMailFailure<T extends object>(value: T | CaseMailFailure): value is CaseMailFailure {
  return "response" in value;
}

/** Sam dostęp: sesja, zlecenie i rola. Nie wymaga skonfigurowanej skrzynki. */
export type CaseAccess = {
  userId: string;
  supabase: Awaited<ReturnType<typeof getSupabaseUserClient>> extends { supabase: infer C } | null ? C : never;
  caseRow: CaseMailContext["caseRow"];
};

export async function resolveCaseAccess(
  request: Request,
  caseId: string
): Promise<CaseAccess | CaseMailFailure> {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return fail("Brak sesji", 401);

  const {
    data: { user }
  } = await auth.supabase.auth.getUser();
  if (!user) return fail("Brak sesji", 401);

  // Zapytanie klientem użytkownika — RLS sam odetnie sprawy, do których nie ma dostępu.
  const { data: caseRow } = await auth.supabase
    .from("cases")
    .select("id, client_name, email, organization_id, created_by")
    .eq("id", caseId)
    .maybeSingle();
  if (!caseRow) return fail("Nie znaleziono zlecenia", 404);

  const { data: member } = await auth.supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", caseRow.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member?.role || !COMMERCIAL_ROLES.has(member.role as string)) {
    return fail("Brak uprawnień do korespondencji z klientem", 403);
  }

  return {
    userId: user.id,
    supabase: auth.supabase as CaseAccess["supabase"],
    caseRow: caseRow as CaseMailContext["caseRow"]
  };
}

/** Dostęp + skonfigurowana skrzynka i odszyfrowane dane logowania. Do operacji na poczcie. */
export async function resolveCaseMailContext(
  request: Request,
  caseId: string
): Promise<CaseMailContext | CaseMailFailure> {
  const access = await resolveCaseAccess(request, caseId);
  if (isCaseMailFailure(access)) return access;
  const { userId, caseRow, supabase } = access;

  const service = createSupabaseServiceClient();
  const account = await resolveMailboxForCase(service, {
    organizationId: caseRow.organization_id,
    viewerUserId: userId
  });
  if (!account) {
    return fail("Skrzynka pocztowa nie jest skonfigurowana", 409, { reason: "no_mailbox" });
  }

  let credentials: MailboxCredentials;
  try {
    credentials = await loadCredentials(service, account);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Nie udało się odczytać danych skrzynki", 500);
  }

  return {
    userId,
    organizationId: caseRow.organization_id,
    caseRow,
    account,
    credentials,
    supabaseUser: supabase,
    service
  };
}
