import type { createSupabaseServiceClient } from "@/lib/supabase-service";
import type { MailboxCredentials } from "@/lib/mail/imap-client";

/**
 * Dostęp do skrzynek użytkowników. Wszystko tutaj działa kluczem service role,
 * więc każda funkcja zakłada, że uprawnienia użytkownika sprawdzono WCZEŚNIEJ,
 * w trasie API. Ta warstwa nie autoryzuje — tylko czyta i odszyfrowuje.
 */

type Service = ReturnType<typeof createSupabaseServiceClient>;

/** Kolumny bezpieczne do pokazania w interfejsie — bez `secret_id`. */
export const MAIL_ACCOUNT_COLUMNS =
  "id, organization_id, user_id, email_address, provider, imap_host, imap_port, smtp_host, smtp_port, status, last_error, last_checked_at, active";

export type MailAccount = {
  id: string;
  organization_id: string;
  user_id: string;
  email_address: string;
  provider: "gmail" | "imap";
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  status: "unverified" | "ok" | "error";
  last_error: string | null;
  last_checked_at: string | null;
  active: boolean;
};

export async function loadAccountForUser(
  service: Service,
  organizationId: string,
  userId: string
): Promise<MailAccount | null> {
  const { data } = await service
    .from("user_mail_accounts")
    .select(MAIL_ACCOUNT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  return (data as MailAccount | null) ?? null;
}

/**
 * Skrzynka, z której pokazujemy korespondencję zlecenia.
 *
 * **Zawsze skrzynka osoby zalogowanej — nigdy cudza.** Nikt, łącznie z właścicielem firmy,
 * nie ogląda tu poczty innego pracownika. Powody:
 *
 *  • podgląd cudzej skrzynki przez przełożonego to monitoring poczty w rozumieniu
 *    Kodeksu pracy (art. 22³) i wymaga wcześniejszych formalności po stronie pracodawcy,
 *  • hasło aplikacji użytkownik podaje po to, żeby *jemu* było wygodniej — użycie go
 *    do pokazania korespondencji komuś innemu wykracza poza tę zgodę,
 *  • model „widzisz to, co sam wymieniłeś z klientem" jest przewidywalny; wcześniejszy
 *    pokazywał inne wiadomości zależnie od tego, kto założył zlecenie.
 *
 * Wspólny wgląd realizuje się przez wspólną skrzynkę firmową podpiętą u kilku osób,
 * a nie przez zaglądanie do prywatnych skrzynek.
 */
export async function resolveMailboxForCase(
  service: Service,
  params: { organizationId: string; viewerUserId: string }
): Promise<MailAccount | null> {
  return loadAccountForUser(service, params.organizationId, params.viewerUserId);
}

/** Odszyfrowanie hasła z Vaulta. Funkcja bazodanowa jest dostępna wyłącznie dla service role. */
export async function loadCredentials(service: Service, account: MailAccount): Promise<MailboxCredentials> {
  const { data, error } = await service.rpc("get_user_mail_secret", { target_account: account.id });
  if (error) throw new Error(`Nie udało się odczytać danych skrzynki: ${error.message}`);
  const appPassword = typeof data === "string" ? data : "";
  if (!appPassword) throw new Error("Skrzynka nie ma zapisanego hasła aplikacji.");

  return {
    emailAddress: account.email_address,
    appPassword,
    imapHost: account.imap_host,
    imapPort: account.imap_port
  };
}

/** Ślad ostatniego sprawdzenia — użytkownik widzi w ustawieniach, czy skrzynka działa. */
export async function updateAccountStatus(
  service: Service,
  accountId: string,
  status: MailAccount["status"],
  errorMessage: string | null
): Promise<void> {
  await service
    .from("user_mail_accounts")
    .update({ status, last_error: errorMessage, last_checked_at: new Date().toISOString() })
    .eq("id", accountId);
}
