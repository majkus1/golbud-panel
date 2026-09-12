import nodemailer from "nodemailer";
import type { MailAccount } from "@/lib/mail/account";

/**
 * Wysyłka ze skrzynki użytkownika (inaczej niż `lib/send-notification.ts`, które używa
 * jednego konta firmowego z zmiennych środowiskowych i służy do powiadomień systemowych).
 *
 * Gmail sam zapisuje wiadomości wysłane przez SMTP w folderze „Wysłane", więc nie ma tu
 * dopisywania przez IMAP — po synchronizacji wiadomość pojawi się w wątku sama.
 */

export type OutgoingAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export type OutgoingMail = {
  to: string[];
  subject: string;
  /** Wersja tekstowa — wysyłana zawsze, także obok HTML. */
  text: string;
  /** Wersja sformatowana; musi być **wcześniej oczyszczona** (`sanitizeOutgoingHtml`). */
  html?: string;
  attachments?: OutgoingAttachment[];
  inReplyTo?: string;
  references?: string[];
};

export class MailSendDisabledError extends Error {
  constructor() {
    super(
      "Wysyłka poczty jest wyłączona w tym środowisku. Ustaw MAIL_SEND_ENABLED=true, " +
        "jeśli świadomie chcesz wysyłać wiadomości do prawdziwych odbiorców."
    );
    this.name = "MailSendDisabledError";
  }
}

/**
 * Jeden punkt kontroli wysyłki. Celowo tutaj, a nie w trasie API — środowisko
 * deweloperskie pracuje na kopii bazy produkcyjnej z prawdziwymi adresami klientów
 * i żadna przyszła trasa nie może tego bezpiecznika ominąć.
 */
export function isMailSendEnabled(): boolean {
  const flag = process.env.MAIL_SEND_ENABLED?.trim().toLowerCase();
  return flag === "true" || flag === "1";
}

export async function sendFromAccount(
  account: MailAccount,
  appPassword: string,
  mail: OutgoingMail
): Promise<{ messageId: string }> {
  if (!isMailSendEnabled()) throw new MailSendDisabledError();

  const transporter = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_port === 465,
    auth: { user: account.email_address, pass: appPassword }
  });

  const info = await transporter.sendMail({
    from: account.email_address,
    to: mail.to.join(", "),
    subject: mail.subject,
    // Oba warianty naraz: część programów pocztowych i filtrów antyspamowych
    // czyta wyłącznie czysty tekst.
    text: mail.text,
    html: mail.html || undefined,
    attachments: mail.attachments?.length ? mail.attachments : undefined,
    inReplyTo: mail.inReplyTo,
    references: mail.references?.length ? mail.references : undefined
  });

  return { messageId: info.messageId };
}
