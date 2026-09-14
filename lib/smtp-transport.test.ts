import { afterEach, describe, expect, it } from "vitest";
import { formatSmtpError, getSmtpFrom, getSmtpTransporter, normalizeAppPassword } from "./smtp-transport";

const ENV_KEYS = ["SMTP_GMAIL_USER", "SMTP_GMAIL_APP_PASSWORD", "SMTP_GMAIL_FROM"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  // Ruszamy tylko klucze jawnie podane — `{ X: undefined }` znaczy „usuń X”, brak klucza znaczy „nie dotykaj”.
  for (const key of ENV_KEYS) {
    if (!(key in values)) continue;
    if (!(key in saved)) saved[key] = process.env[key];
    const next = values[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const prev = saved[key];
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});

describe("normalizeAppPassword", () => {
  it("usuwa spacje z hasła wklejonego prosto z Google", () => {
    // Tak Google pokazuje hasło aplikacji — tak też ludzie je wklejają do Vercela.
    expect(normalizeAppPassword("abcd efgh ijkl mnop")).toBe("abcdefghijklmnop");
  });

  it("usuwa też tabulatory i końce linii, które łapią się przy kopiowaniu", () => {
    expect(normalizeAppPassword(" abcd\tefgh\nijkl mnop \r\n")).toBe("abcdefghijklmnop");
  });

  it("brak wartości daje pusty napis, nie wyjątek", () => {
    expect(normalizeAppPassword(undefined)).toBe("");
    expect(normalizeAppPassword(null)).toBe("");
  });
});

describe("getSmtpTransporter", () => {
  it("loguje się hasłem bez spacji — nawet gdy zmienna ma spacje", () => {
    setEnv({ SMTP_GMAIL_USER: "golbud.powiadomienia@gmail.com", SMTP_GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" });
    const transporter = getSmtpTransporter();
    // Ten sam transporter obsługuje powiadomienia, faktury i digest — wcześniej digest miał
    // własną kopię bez usuwania spacji i jako jedyny nie wychodził.
    const auth = (transporter.options as { auth?: { user?: string; pass?: string } }).auth;
    expect(auth?.user).toBe("golbud.powiadomienia@gmail.com");
    expect(auth?.pass).toBe("abcdefghijklmnop");
  });

  it("hasło złożone z samych spacji traktuje jak brak hasła", () => {
    setEnv({ SMTP_GMAIL_USER: "x@gmail.com", SMTP_GMAIL_APP_PASSWORD: "   " });
    expect(() => getSmtpTransporter()).toThrow(/Brak SMTP_GMAIL/);
  });
});

describe("getSmtpFrom", () => {
  it("woli jawny adres nadawcy, a bez niego bierze konto SMTP", () => {
    setEnv({ SMTP_GMAIL_USER: "konto@gmail.com", SMTP_GMAIL_FROM: "powiadomienia@golbud.pl" });
    expect(getSmtpFrom()).toBe("powiadomienia@golbud.pl");
    setEnv({ SMTP_GMAIL_FROM: undefined });
    expect(getSmtpFrom()).toBe("konto@gmail.com");
  });
});

describe("formatSmtpError", () => {
  it("odrzucone dane logowania tłumaczy na instrukcję, nie na kod Gmaila", () => {
    const msg = formatSmtpError(new Error("535-5.7.8 Username and Password not accepted"));
    expect(msg).toMatch(/hasło aplikacji/i);
    expect(msg).not.toMatch(/535/);
  });

  it("brak konfiguracji przekazuje bez zmian — to już jest czytelne", () => {
    expect(formatSmtpError(new Error("Brak SMTP_GMAIL_USER lub SMTP_GMAIL_APP_PASSWORD"))).toMatch(/^Brak SMTP_GMAIL/);
  });

  it("problem z siecią opisuje po ludzku", () => {
    expect(formatSmtpError(new Error("connect ETIMEDOUT 64.233.184.108:465"))).toMatch(/połączyć/);
  });
});
