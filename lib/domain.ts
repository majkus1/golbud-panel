/** Stałe domenowe — zgodne z konwersacją z klientem (proces GolBud). */

export const CASE_STATUSES = [
  "nowe zapytanie",
  "do kontaktu",
  "wysłano pytania",
  "oczekujemy na zdjęcia/projekt",
  "do wyceny",
  "wycena wysłana",
  "do decyzji klienta",
  "umowa do podpisu",
  "zaliczka do wpłaty",
  "termin zarezerwowany",
  "realizacja",
  "odbiór",
  "rozliczone",
  "utracone"
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_SOURCES = ["Google Ads", "strona", "polecenie", "OLX", "telefon", "mail", "WhatsApp", "SMS"] as const;

export type CaseSource = (typeof CASE_SOURCES)[number];

export const UNITS = ["m²", "mb", "szt.", "kpl.", "roboczogodz.", "usługa"] as const;

export type Unit = (typeof UNITS)[number];

export const ATTACHMENT_CATEGORIES = [
  "przed pracami",
  "w trakcie",
  "po zakończeniu",
  "usterki",
  "materiały",
  "projekt",
  "inspiracje",
  "kosztorys zewnętrzny",
  "umowa",
  "aneks",
  "protokół",
  "wezwanie do zapłaty",
  "oświadczenie"
] as const;

export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

export const PROTOCOL_TYPES = ["po ociepleniu", "po siatce", "po tynku", "odbiór końcowy", "prace dodatkowe"] as const;

export type ProtocolType = (typeof PROTOCOL_TYPES)[number];

export const DEFAULT_SCHEDULE_TITLES = [
  "Podpisanie umowy",
  "Zaliczka",
  "Zamówienie materiału",
  "Dostawa materiału",
  "Start prac",
  "Etap po ociepleniu",
  "Etap po siatce",
  "Tynkowanie",
  "Odbiór",
  "Faktura końcowa"
] as const;

export const MEMBER_ROLES = ["owner", "office", "sales", "manager", "brygadzista", "podwykonawca", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Właściciel",
  office: "Biuro",
  sales: "Handlowiec",
  manager: "Kierownik",
  brygadzista: "Brygadzista",
  podwykonawca: "Podwykonawca",
  member: "Pracownik"
};

/** Role z pełnym wglądem w organizację (zarządzanie, finanse, wszystkie sprawy). */
export const MANAGEMENT_ROLES: MemberRole[] = ["owner", "office", "manager"];

/** Role z dostępem do indywidualnych wynagrodzeń pracowników. */
export const PAYROLL_ROLES: MemberRole[] = ["owner", "manager"];

/** Role biurowe — typowo odpowiedzialni za prowadzenie sprawy. */
export const OFFICE_ROLES: MemberRole[] = ["owner", "office", "manager", "sales"];

/** Role „terenowe" — ograniczony dostęp: tylko przypisane budowy, bez finansów. */
export const FIELD_ROLES: MemberRole[] = ["brygadzista", "podwykonawca", "member"];

export const CASE_ASSIGNMENT_ROLES = ["lead", "field"] as const;
export type CaseAssignmentRole = (typeof CASE_ASSIGNMENT_ROLES)[number];

export const TASK_STATUSES = ["do zrobienia", "w toku", "zrobione", "anulowane"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["niski", "normalny", "wysoki", "pilne"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const SUBCONTRACTOR_STATUSES = ["planowane", "w toku", "zakończone", "wstrzymane"] as const;
export type SubcontractorStatus = (typeof SUBCONTRACTOR_STATUSES)[number];

/* ── Faktury (proforma / zaliczkowa / końcowa / VAT) ───────────────────────── */

export const INVOICE_KINDS = ["proforma", "zaliczkowa", "końcowa", "vat"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  proforma: "Faktura proforma",
  zaliczkowa: "Faktura zaliczkowa",
  "końcowa": "Faktura końcowa",
  vat: "Faktura VAT"
};

/** Prefiks numeru faktury per typ (np. PF/2026/0001). */
export const INVOICE_KIND_PREFIX: Record<InvoiceKind, string> = {
  proforma: "PF",
  zaliczkowa: "FZ",
  "końcowa": "FK",
  vat: "FV"
};

/** Proforma nie jest fakturą VAT w rozumieniu ustawy — wpływa na treść PDF i eksport KSeF. */
export const INVOICE_KIND_IS_VAT: Record<InvoiceKind, boolean> = {
  proforma: false,
  zaliczkowa: true,
  "końcowa": true,
  vat: true
};

export const INVOICE_STATUSES = ["szkic", "wystawiona", "opłacona", "anulowana"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ["przelew", "gotówka", "karta", "BLIK"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Stawki VAT dopuszczalne w pozycji faktury (uproszczony zestaw budowlany). */
export const VAT_RATES = [23, 8, 5, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];

export const ACTIVE_BOARD_STATUSES = [
  "nowe zapytanie",
  "do kontaktu",
  "wysłano pytania",
  "oczekujemy na zdjęcia/projekt",
  "do wyceny",
  "wycena wysłana",
  "do decyzji klienta",
  "umowa do podpisu",
  "zaliczka do wpłaty",
  "termin zarezerwowany",
  "realizacja",
  "odbiór"
] as const satisfies readonly CaseStatus[];
