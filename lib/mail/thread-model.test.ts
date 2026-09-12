import { describe, expect, it } from "vitest";
import {
  buildReplyHeaders,
  groupIntoThreads,
  htmlToPlainText,
  markDirection,
  normalizeSubject,
  replySubject,
  sortThreads,
  stripQuotedReply,
  type MailMessage
} from "@/lib/mail/thread-model";

const MAILBOX = "handlowiec@golbud.pl";
const CLIENT = "klient@example.com";

function message(overrides: Partial<MailMessage> & { uid: number }): MailMessage {
  return {
    messageId: `<msg-${overrides.uid}@test>`,
    threadId: null,
    inReplyTo: null,
    references: [],
    subject: "Oferta elewacja",
    from: { name: "Klient", address: CLIENT },
    to: [{ name: "GolBud", address: MAILBOX }],
    cc: [],
    date: "2026-08-01T10:00:00.000Z",
    text: "treść",
    html: null,
    attachments: [],
    ...overrides
  };
}

describe("normalizeSubject", () => {
  it("usuwa prefiksy odpowiedzi i przekazań, także zagnieżdżone", () => {
    expect(normalizeSubject("Re: Oferta")).toBe("oferta");
    expect(normalizeSubject("RE: Odp: FWD: Oferta")).toBe("oferta");
    expect(normalizeSubject("Re[2]: Oferta")).toBe("oferta");
  });

  it("nie obcina tematu, który tylko zaczyna się podobnie", () => {
    expect(normalizeSubject("Remont łazienki")).toBe("remont łazienki");
  });
});

describe("markDirection", () => {
  it("wiadomość od właściciela skrzynki jest wychodząca", () => {
    const outgoing = message({ uid: 1, from: { name: "Ja", address: MAILBOX } });
    expect(markDirection(outgoing, MAILBOX)).toBe("outgoing");
  });

  it("wiadomość od klienta jest przychodząca", () => {
    expect(markDirection(message({ uid: 2 }), MAILBOX)).toBe("incoming");
  });

  it("ignoruje wielkość liter i spacje w adresie", () => {
    const outgoing = message({ uid: 3, from: { name: "Ja", address: "  Handlowiec@GolBud.pl " } });
    expect(markDirection(outgoing, MAILBOX)).toBe("outgoing");
  });

  it("brak nadawcy traktuje jako wiadomość przychodzącą", () => {
    expect(markDirection(message({ uid: 4, from: null }), MAILBOX)).toBe("incoming");
  });
});

describe("groupIntoThreads", () => {
  it("skleja wiadomości po identyfikatorze wątku Gmaila, nawet gdy temat się zmienił", () => {
    const threads = groupIntoThreads(
      [
        message({ uid: 1, threadId: "t1", subject: "Oferta" }),
        message({ uid: 2, threadId: "t1", subject: "Zupełnie inny temat" })
      ],
      MAILBOX
    );
    expect(threads).toHaveLength(1);
    expect(threads[0].messageCount).toBe(2);
  });

  it("bez identyfikatora wątku grupuje po znormalizowanym temacie", () => {
    const threads = groupIntoThreads(
      [message({ uid: 1, subject: "Oferta elewacja" }), message({ uid: 2, subject: "Re: Oferta elewacja" })],
      MAILBOX
    );
    expect(threads).toHaveLength(1);
  });

  it("nie łączy różnych tematów", () => {
    const threads = groupIntoThreads(
      [message({ uid: 1, subject: "Oferta" }), message({ uid: 2, subject: "Faktura" })],
      MAILBOX
    );
    expect(threads).toHaveLength(2);
  });

  it("porządkuje wiadomości w wątku chronologicznie, niezależnie od kolejności wejściowej", () => {
    const threads = groupIntoThreads(
      [
        message({ uid: 2, threadId: "t1", date: "2026-08-05T10:00:00.000Z" }),
        message({ uid: 1, threadId: "t1", date: "2026-08-01T10:00:00.000Z" })
      ],
      MAILBOX
    );
    expect(threads[0].messages.map((m) => m.uid)).toEqual([1, 2]);
    expect(threads[0].lastMessageAt).toBe("2026-08-05T10:00:00.000Z");
  });

  it("na liście uczestników pomija własny adres i nie duplikuje osób", () => {
    const threads = groupIntoThreads(
      [
        message({ uid: 1, threadId: "t1" }),
        message({ uid: 2, threadId: "t1", from: { name: "Ja", address: MAILBOX } })
      ],
      MAILBOX
    );
    expect(threads[0].participants).toEqual(["Klient"]);
  });

  it("pusty temat zastępuje czytelną etykietą", () => {
    const threads = groupIntoThreads([message({ uid: 1, subject: "" })], MAILBOX);
    expect(threads[0].subject).toBe("(bez tematu)");
  });
});

describe("sortThreads", () => {
  const threads = groupIntoThreads(
    [
      message({ uid: 1, threadId: "stary", subject: "Stary", date: "2026-07-01T10:00:00.000Z" }),
      message({ uid: 2, threadId: "nowy", subject: "Nowy", date: "2026-08-05T10:00:00.000Z" })
    ],
    MAILBOX
  );

  it("domyślnie od najnowszych", () => {
    expect(sortThreads(threads, "newest").map((t) => t.subject)).toEqual(["Nowy", "Stary"]);
  });

  it("i odwrotnie na życzenie", () => {
    expect(sortThreads(threads, "oldest").map((t) => t.subject)).toEqual(["Stary", "Nowy"]);
  });
});

describe("htmlToPlainText", () => {
  it("zamienia znaczniki na tekst i dekoduje encje", () => {
    expect(htmlToPlainText("<p>Dzień dobry</p><p>Pozdrawiam&nbsp;&amp; do usłyszenia</p>")).toBe(
      "Dzień dobry\nPozdrawiam & do usłyszenia"
    );
  });

  it("wycina skrypty i style razem z zawartością", () => {
    const html = "<style>p{color:red}</style><script>alert(1)</script><p>Treść</p>";
    const text = htmlToPlainText(html);
    expect(text).toBe("Treść");
    expect(text).not.toContain("alert");
  });
});

describe("stripQuotedReply", () => {
  it("odcina cytowaną historię po nagłówku odpowiedzi", () => {
    const body = "Dziękuję, pasuje.\n\nW dniu 1 sierpnia 2026 Jan Kowalski napisał(a):\n> Przesyłam ofertę";
    expect(stripQuotedReply(body)).toBe("Dziękuję, pasuje.");
  });

  // Realny format Gmaila po polsku — nagłówek zaczyna się od skrótu dnia tygodnia,
  // a adres nadawcy potrafi przenieść go do następnej linii.
  it("radzi sobie z polskim nagłówkiem Gmaila zawiniętym na kilka linii", () => {
    const body =
      "hej\n\nsob., 8 sie 2026 o 23:06 Golbud Powiadomienia <\ngolbud.powiadomienia@gmail.com> napisał(a):\n\n> test2";
    expect(stripQuotedReply(body)).toBe("hej");
  });

  // Poczta chodzi z CRLF — regresja na realnych danych z Gmaila.
  it("działa też przy zakończeniach linii CRLF", () => {
    const body = "hej\r\n\r\nsob., 8 sie 2026 o 23:06 Golbud Powiadomienia <\r\ngolbud@gmail.com> napisał(a):\r\n\r\n> test2";
    expect(stripQuotedReply(body)).toBe("hej");
  });

  it("radzi sobie z angielskim nagłówkiem Gmaila", () => {
    const body =
      "test2\n\nOn Sat, Aug 8, 2026 at 11:06 PM Golbud Powiadomienia <\ngolbud.powiadomienia@gmail.com> wrote:\n\n> test 1";
    expect(stripQuotedReply(body)).toBe("test2");
  });

  it("zostawia treść bez zmian, gdy nie ma cytatu", () => {
    expect(stripQuotedReply("Krótka odpowiedź")).toBe("Krótka odpowiedź");
  });

  it("nie zwraca pustki, gdy wiadomość jest samym cytatem", () => {
    expect(stripQuotedReply("> tylko cytat")).toBe("> tylko cytat");
  });
});

describe("replySubject", () => {
  it("dodaje prefiks tylko raz", () => {
    expect(replySubject("Oferta")).toBe("Re: Oferta");
    expect(replySubject("Re: Oferta")).toBe("Re: Oferta");
  });

  it("radzi sobie z pustym tematem", () => {
    expect(replySubject("")).toBe("Re: (bez tematu)");
  });
});

describe("buildReplyHeaders", () => {
  it("wiąże odpowiedź z ostatnią wiadomością wątku", () => {
    const [thread] = groupIntoThreads(
      [
        message({ uid: 1, threadId: "t1", messageId: "<a@test>", date: "2026-08-01T10:00:00.000Z" }),
        message({
          uid: 2,
          threadId: "t1",
          messageId: "<b@test>",
          references: ["<a@test>"],
          date: "2026-08-02T10:00:00.000Z"
        })
      ],
      MAILBOX
    );
    expect(buildReplyHeaders(thread)).toEqual({
      inReplyTo: "<b@test>",
      references: ["<a@test>", "<b@test>"]
    });
  });

  it("bez identyfikatora wiadomości nie zmyśla nagłówków", () => {
    const [thread] = groupIntoThreads([message({ uid: 1, messageId: null })], MAILBOX);
    expect(buildReplyHeaders(thread)).toEqual({});
  });

  it("przycina bardzo długi łańcuch odniesień", () => {
    const references = Array.from({ length: 40 }, (_, i) => `<ref-${i}@test>`);
    const [thread] = groupIntoThreads([message({ uid: 1, messageId: "<last@test>", references })], MAILBOX);
    const headers = buildReplyHeaders(thread);
    expect(headers.references).toHaveLength(20);
    expect(headers.references?.at(-1)).toBe("<last@test>");
  });
});
