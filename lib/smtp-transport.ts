import nodemailer from "nodemailer";

/**
 * Jedno połączenie SMTP dla całej aplikacji.
 *
 * Do tej pory były dwie kopie tej funkcji: powiadomienia usuwały spacje z hasła
 * aplikacji Google, poranny digest — nie. Hasło wklejone tak, jak pokazuje je Google
 * („abcd efgh ijkl mnop”), działało dla faktur i powiadomień, a digest po cichu padał.
 * Jedno miejsce = jedno zachowanie.
 */

/** Google pokazuje hasło aplikacji w czterech blokach ze spacjami — SMTP wymaga ciągu bez nich. */
export function normalizeAppPassword(value: string | null | undefined): string {
  return (value ?? "").replace(/\s/g, "");
}

export function getSmtpTransporter() {
  const user = process.env.SMTP_GMAIL_USER?.trim();
  const pass = normalizeAppPassword(process.env.SMTP_GMAIL_APP_PASSWORD);
  if (!user || !pass) throw new Error("Brak SMTP_GMAIL_USER lub SMTP_GMAIL_APP_PASSWORD");
  return nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
}

export function getSmtpFrom(): string {
  const from = process.env.SMTP_GMAIL_FROM?.trim() || process.env.SMTP_GMAIL_USER?.trim();
  if (!from) throw new Error("Brak SMTP_GMAIL_USER / SMTP_GMAIL_FROM");
  return from;
}

/** Czytelny komunikat dla UI — bez surowego logu Gmaila. */
export function formatSmtpError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Brak SMTP_GMAIL")) return msg;
  if (msg.includes("535") || /badcredentials/i.test(msg) || /username and password not accepted/i.test(msg)) {
    return (
      "Gmail odrzucił dane logowania SMTP. W Vercel ustaw SMTP_GMAIL_USER (pełny adres Gmail) " +
      "i SMTP_GMAIL_APP_PASSWORD (16-znakowe hasło aplikacji Google — nie zwykłe hasło do konta). " +
      "Konto musi mieć włączone 2FA, żeby wygenerować hasło aplikacji."
    );
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|getaddrinfo/i.test(msg)) {
    return "Nie udało się połączyć z serwerem Gmail (smtp.gmail.com:465). Sprawdź połączenie sieciowe serwera.";
  }
  return msg;
}
