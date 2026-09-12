import { FIELD_ROLES, MANAGEMENT_ROLES, type MemberRole } from "@/lib/domain";

/** Wszystkie przełączniki digestu + powiadomienia natychmiastowego. */
export type UserNotificationPrefs = {
  digest_enabled: boolean;
  include_reminders: boolean;
  include_overdue_contact: boolean;
  include_schedule: boolean;
  include_payments: boolean;
  include_tasks: boolean;
  include_fleet: boolean;
  include_warehouse: boolean;
  include_profitability_alerts: boolean;
  include_cost_invoices: boolean;
  include_employee_compliance: boolean;
  include_settlements: boolean;
  include_stale_cases: boolean;
  notify_new_case: boolean;
  notify_task_comment: boolean;
  notify_financial_alerts: boolean;
  push_enabled: boolean;
};

export type DigestSectionPrefs = Omit<UserNotificationPrefs, "digest_enabled" | "notify_new_case" | "notify_task_comment" | "notify_financial_alerts" | "push_enabled">;

/** Podpowiedzi w UI — język dla użytkownika, nie dla programisty. */
export const NOTIFICATION_HELP = {
  sectionTitle:
    "Ustaw, kto dostaje maile z panelu. Domyślnie dopasowujemy je do roli — możesz to zmienić dla każdej osoby osobno.",
  digest:
    "Rano dostaniesz jeden mail z listą rzeczy do ogarnięcia: zaległe kontakty, etapy budowy, płatności itd. Wygodne na start dnia.",
  digestSections:
    "Zaznacz tylko to, co ta osoba naprawdę musi widzieć. Brygada nie potrzebuje płatności — biuro tak.",
  digestScope:
    "Osoby z budowy dostają w mailu tylko te sprawy, do których są przypisane — tak jak w panelu.",
  newCase:
    "Gdy ktoś doda nowe zapytanie od klienta, wybrana osoba dostanie mail od razu — nie musi co chwilę sprawdzać panelu.",
  taskComment:
    "Gdy ktoś napisze w dyskusji zadania, mail idzie do osób przypisanych do tego zadania. Autor wiadomości nie dostaje powiadomienia o własnym komentarzu.",
  financialAlert:
    "Dzwonek/push dla ról zarządczych, gdy pojawi się większy koszt, nieopłacona faktura albo duże rozliczenie wpływające na kasę.",
  pushEnabled:
    "Każdy użytkownik włącza push samodzielnie w sekcji Powiadomienia (telefon i przeglądarka).",
  resetRole:
    "Przywraca typowe ustawienia dla tej roli. Włączony poranny digest zostaje bez zmian."
} as const;

/** Grupy w UI — prostsze niż 7 osobnych checkboxów. */
export const DIGEST_PREF_GROUPS = [
  {
    id: "contact" as const,
    label: "Kontakt i sprzedaż",
    hint: "Przypomnienia z kart spraw, zaległy termin kontaktu z klientem",
    keys: ["include_reminders", "include_overdue_contact"] as const
  },
  {
    id: "delivery" as const,
    label: "Realizacja",
    hint: "Etapy harmonogramu i zadania po terminie",
    keys: ["include_schedule", "include_tasks"] as const
  },
  {
    id: "finance" as const,
    label: "Finanse",
    hint: "Płatności klientów, faktury kosztowe i alerty marży",
    keys: ["include_payments", "include_cost_invoices", "include_profitability_alerts"] as const
  },
  {
    id: "settlements" as const,
    label: "Rozliczenia ekip",
    hint: "Duże rozliczenia dostępne zgodnie z rolą użytkownika",
    keys: ["include_settlements"] as const
  },
  {
    id: "people" as const,
    label: "Kadry i terminy",
    hint: "BHP, badania, szkolenia, uprawnienia oraz budowy bez aktualizacji",
    keys: ["include_employee_compliance", "include_stale_cases"] as const
  },
  {
    id: "ops" as const,
    label: "Flota i magazyn",
    hint: "Terminy dokumentów pojazdów/polis, niski stan materiałów",
    keys: ["include_fleet", "include_warehouse"] as const
  }
];

export const DIGEST_GROUP_HELP: Record<(typeof DIGEST_PREF_GROUPS)[number]["id"], string> = {
  contact: "Przypomnienia z karty sprawy i klienci, z którymi trzeba się już odezwać.",
  delivery: "Opóźnione etapy na harmonogramie i zadania po terminie.",
  finance: "Płatności klientów, faktury dostawców oraz budowy, które tracą marżę.",
  settlements: "Duże rozliczenia operacyjne dostępne zgodnie z rolą użytkownika.",
  people: "Wygasające badania, BHP, szkolenia i uprawnienia oraz aktywne budowy bez świeżej aktualizacji.",
  ops: "Koniec ubezpieczenia lub przeglądu auta oraz materiały na wyczerpaniu w magazynie."
};

const ALL_ON: DigestSectionPrefs = {
  include_reminders: true,
  include_overdue_contact: true,
  include_schedule: true,
  include_payments: true,
  include_tasks: true,
  include_fleet: true,
  include_warehouse: true,
  include_profitability_alerts: true,
  include_cost_invoices: true,
  include_employee_compliance: true,
  include_settlements: true,
  include_stale_cases: true
};

const CONTACT_TASKS: DigestSectionPrefs = {
  include_reminders: true,
  include_overdue_contact: true,
  include_schedule: false,
  include_payments: false,
  include_tasks: true,
  include_fleet: false,
  include_warehouse: false,
  include_profitability_alerts: false,
  include_cost_invoices: false,
  include_employee_compliance: false,
  include_settlements: false,
  include_stale_cases: false
};

const FIELD_DEFAULT: DigestSectionPrefs = {
  include_reminders: false,
  include_overdue_contact: false,
  include_schedule: true,
  include_payments: false,
  include_tasks: true,
  include_fleet: false,
  include_warehouse: false,
  include_profitability_alerts: false,
  include_cost_invoices: false,
  include_employee_compliance: false,
  include_settlements: false,
  include_stale_cases: true
};

const SECTION_BY_ROLE: Record<MemberRole, DigestSectionPrefs> = {
  owner: ALL_ON,
  office: ALL_ON,
  manager: ALL_ON,
  sales: CONTACT_TASKS,
  brygadzista: FIELD_DEFAULT,
  podwykonawca: FIELD_DEFAULT,
  member: FIELD_DEFAULT
};

/** Czy rola widzi wszystkie sprawy w organizacji (jak w RLS). */
export function canSeeAllCasesInOrg(role: MemberRole): boolean {
  return (MANAGEMENT_ROLES as readonly string[]).includes(role);
}

/** Domyślne preferencje powiadomień dla roli — owner może nadpisać w panelu. */
export function defaultNotificationPrefsForRole(role: MemberRole): UserNotificationPrefs {
  const sections = SECTION_BY_ROLE[role] ?? FIELD_DEFAULT;
  const notifyNewCase =
    role === "owner" || role === "office" || role === "manager" || role === "sales";
  const notifyFinancialAlerts = role === "owner" || role === "office" || role === "manager";
  return {
    digest_enabled: false,
    notify_new_case: notifyNewCase,
    notify_task_comment: true,
    notify_financial_alerts: notifyFinancialAlerts,
    push_enabled: false,
    ...sections
  };
}

export function mergeNotificationPrefs(
  role: MemberRole,
  row: Partial<UserNotificationPrefs> | null | undefined
): UserNotificationPrefs {
  const defaults = defaultNotificationPrefsForRole(role);
  if (!row) return defaults;
  return {
    digest_enabled: row.digest_enabled ?? defaults.digest_enabled,
    notify_new_case: row.notify_new_case ?? defaults.notify_new_case,
    notify_task_comment: row.notify_task_comment ?? defaults.notify_task_comment,
    notify_financial_alerts: row.notify_financial_alerts ?? defaults.notify_financial_alerts,
    push_enabled: row.push_enabled ?? defaults.push_enabled,
    include_reminders: row.include_reminders ?? defaults.include_reminders,
    include_overdue_contact: row.include_overdue_contact ?? defaults.include_overdue_contact,
    include_schedule: row.include_schedule ?? defaults.include_schedule,
    include_payments: row.include_payments ?? defaults.include_payments,
    include_tasks: row.include_tasks ?? defaults.include_tasks,
    include_fleet: row.include_fleet ?? defaults.include_fleet,
    include_warehouse: row.include_warehouse ?? defaults.include_warehouse,
    include_profitability_alerts: row.include_profitability_alerts ?? defaults.include_profitability_alerts,
    include_cost_invoices: row.include_cost_invoices ?? defaults.include_cost_invoices,
    include_employee_compliance: row.include_employee_compliance ?? defaults.include_employee_compliance,
    include_settlements: row.include_settlements ?? defaults.include_settlements,
    include_stale_cases: row.include_stale_cases ?? defaults.include_stale_cases
  };
}

export function groupChecked(
  prefs: Pick<UserNotificationPrefs, (typeof DIGEST_PREF_GROUPS)[number]["keys"][number]>,
  groupId: (typeof DIGEST_PREF_GROUPS)[number]["id"]
): boolean {
  const g = DIGEST_PREF_GROUPS.find((x) => x.id === groupId);
  if (!g) return false;
  return g.keys.every((k) => prefs[k]);
}

export function setGroupChecked(
  prefs: DigestSectionPrefs,
  groupId: (typeof DIGEST_PREF_GROUPS)[number]["id"],
  checked: boolean
): DigestSectionPrefs {
  const g = DIGEST_PREF_GROUPS.find((x) => x.id === groupId);
  if (!g) return prefs;
  const next = { ...prefs };
  for (const k of g.keys) next[k] = checked;
  return next;
}

/** Role terenowe — do krótkich opisów w UI. */
export function isFieldRoleLabel(role: MemberRole): boolean {
  return (FIELD_ROLES as readonly string[]).includes(role);
}
