import { GOLBUD_OFFER_DEFAULTS } from "@/lib/golbud-offer-config";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";

/** Pola organizacji używane na PDF oferty (Supabase). */
export type OrganizationOfferRow = {
  name?: string | null;
  offer_legal_name?: string | null;
  offer_nip?: string | null;
  offer_krs?: string | null;
  offer_regon?: string | null;
  offer_representation?: string | null;
  offer_proxy?: string | null;
  offer_seat?: string | null;
  offer_phone_secondary?: string | null;
  offer_slogan?: string | null;
  offer_address_line?: string | null;
  offer_postal_city?: string | null;
  offer_phone?: string | null;
  offer_email?: string | null;
  offer_website?: string | null;
  offer_bank_account?: string | null;
  offer_bank_name?: string | null;
  offer_payment_terms?: string | null;
  offer_default_vat_rate?: number | string | null;
  offer_validity_days?: number | null;
  accountant_email?: string | null;
  invoice_email_subject?: string | null;
  invoice_email_body?: string | null;
};

export const ORGANIZATION_OFFER_SELECT =
  "name, offer_legal_name, offer_nip, offer_krs, offer_regon, offer_representation, offer_proxy, offer_seat, offer_phone_secondary, offer_slogan, offer_address_line, offer_postal_city, offer_phone, offer_email, offer_website, offer_bank_account, offer_bank_name, offer_payment_terms, offer_default_vat_rate, offer_validity_days";

export const ORGANIZATION_INVOICE_MAIL_SELECT = "accountant_email, invoice_email_subject, invoice_email_body";

/** Domyślne treści maila z fakturą (gdy organizacja nic nie ustawiła). */
export const INVOICE_EMAIL_DEFAULTS = {
  subject: "Faktura {numer} — {firma}",
  body:
    "Dzień dobry,\n\n" +
    "w załączniku przesyłamy fakturę {numer} na kwotę {kwota}.\n" +
    "Prosimy o płatność do dnia {termin}.\n\n" +
    "W razie pytań pozostajemy do dyspozycji.\n\n" +
    "Pozdrawiamy,\n{firma}"
} as const;

function pickText(...values: (string | null | undefined)[]): string {
  for (const v of values) {
    const t = v?.trim();
    if (t) return t;
  }
  return "";
}

function pickNum(value: number | string | null | undefined, fallback: number): number {
  if (value == null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Profil sprzedawcy: baza z Supabase, puste pola — domyślne z golbud-offer-config. */
export function sellerProfileFromOrganization(org: OrganizationOfferRow | null | undefined): OfferSellerProfile {
  const d = GOLBUD_OFFER_DEFAULTS;
  // KRS, REGON, reprezentację i pełnomocnika spółki podstawiamy tylko wtedy, gdy w ustawieniach
  // jest NIP spółki albo pusto. Przy innym NIP (np. dawnej JDG) umowa miałaby nazwę jednej firmy
  // i KRS drugiej — wtedy pola zostają puste, a generator dokumentów prosi o ich uzupełnienie.
  const orgNip = org?.offer_nip?.replace(/\D/g, "") ?? "";
  const companyDefaults = !orgNip || orgNip === d.nip;

  return {
    // Bez sklejania „{nazwa w panelu} — usługi ogólnobudowlane”: na umowie spółki musi być
    // pełna nazwa z KRS, a nie nazwa skrócona z panelu.
    legalName: pickText(org?.offer_legal_name, d.legalName),
    nip: pickText(org?.offer_nip, d.nip),
    krs: pickText(org?.offer_krs, companyDefaults ? d.krs : ""),
    regon: pickText(org?.offer_regon, companyDefaults ? d.regon : ""),
    representation: pickText(org?.offer_representation, companyDefaults ? d.representation : ""),
    proxy: pickText(org?.offer_proxy, companyDefaults ? d.proxy : ""),
    seat: pickText(org?.offer_seat, d.seat),
    contactPerson: d.contactPerson,
    addressLine: pickText(org?.offer_address_line, d.addressLine) || d.addressLine,
    postalCity: pickText(org?.offer_postal_city, d.postalCity) || d.postalCity,
    phone: pickText(org?.offer_phone, d.phone) || d.phone,
    phoneSecondary: pickText(org?.offer_phone_secondary, d.phoneSecondary),
    slogan: pickText(org?.offer_slogan, d.slogan),
    email: pickText(org?.offer_email, d.email) || d.email,
    website: pickText(org?.offer_website, d.website) || d.website,
    bankAccount: pickText(org?.offer_bank_account, d.bankAccount),
    bankName: pickText(org?.offer_bank_name, d.bankName),
    paymentTerms: pickText(org?.offer_payment_terms, d.paymentTerms) || d.paymentTerms,
    defaultVatRate: pickNum(org?.offer_default_vat_rate, d.defaultVatRate),
    validityDays: pickNum(org?.offer_validity_days, d.validityDays)
  };
}

export type OrganizationOfferForm = {
  name: string;
  offer_legal_name: string;
  offer_nip: string;
  offer_krs: string;
  offer_regon: string;
  offer_representation: string;
  offer_proxy: string;
  offer_seat: string;
  offer_phone_secondary: string;
  offer_slogan: string;
  offer_address_line: string;
  offer_postal_city: string;
  offer_phone: string;
  offer_email: string;
  offer_website: string;
  offer_bank_account: string;
  offer_bank_name: string;
  offer_payment_terms: string;
  offer_default_vat_rate: string;
  offer_validity_days: string;
  accountant_email: string;
  invoice_email_subject: string;
  invoice_email_body: string;
};

export function formFromOrganizationRow(org: OrganizationOfferRow & { name: string }): OrganizationOfferForm {
  const profile = sellerProfileFromOrganization(org);
  return {
    name: org.name?.trim() || "GolBud",
    offer_legal_name: org.offer_legal_name?.trim() || profile.legalName,
    offer_nip: org.offer_nip?.trim() || profile.nip,
    offer_krs: org.offer_krs?.trim() || profile.krs,
    offer_regon: org.offer_regon?.trim() || profile.regon,
    offer_representation: org.offer_representation?.trim() || profile.representation,
    offer_proxy: org.offer_proxy?.trim() || profile.proxy,
    offer_seat: org.offer_seat?.trim() || profile.seat,
    offer_phone_secondary: org.offer_phone_secondary?.trim() || profile.phoneSecondary,
    offer_slogan: org.offer_slogan?.trim() || profile.slogan,
    offer_address_line: org.offer_address_line?.trim() || profile.addressLine,
    offer_postal_city: org.offer_postal_city?.trim() || profile.postalCity,
    offer_phone: org.offer_phone?.trim() || profile.phone,
    offer_email: org.offer_email?.trim() || profile.email,
    offer_website: org.offer_website?.trim() || profile.website,
    offer_bank_account: org.offer_bank_account?.trim() || profile.bankAccount,
    offer_bank_name: org.offer_bank_name?.trim() || profile.bankName,
    offer_payment_terms: org.offer_payment_terms?.trim() || profile.paymentTerms,
    offer_default_vat_rate: String(profile.defaultVatRate),
    offer_validity_days: String(profile.validityDays),
    accountant_email: org.accountant_email?.trim() || "",
    invoice_email_subject: org.invoice_email_subject?.trim() || INVOICE_EMAIL_DEFAULTS.subject,
    invoice_email_body: org.invoice_email_body?.trim() || INVOICE_EMAIL_DEFAULTS.body
  };
}

export function organizationUpdateFromForm(form: OrganizationOfferForm) {
  const vat = Number(form.offer_default_vat_rate);
  const days = Number(form.offer_validity_days);
  return {
    name: form.name.trim() || "GolBud",
    offer_legal_name: form.offer_legal_name.trim() || null,
    offer_nip: form.offer_nip.trim() || null,
    offer_krs: form.offer_krs.trim() || null,
    offer_regon: form.offer_regon.trim() || null,
    offer_representation: form.offer_representation.trim() || null,
    offer_proxy: form.offer_proxy.trim() || null,
    offer_seat: form.offer_seat.trim() || null,
    offer_phone_secondary: form.offer_phone_secondary.trim() || null,
    offer_slogan: form.offer_slogan.trim() || null,
    offer_address_line: form.offer_address_line.trim() || null,
    offer_postal_city: form.offer_postal_city.trim() || null,
    offer_phone: form.offer_phone.trim() || null,
    offer_email: form.offer_email.trim() || null,
    offer_website: form.offer_website.trim() || null,
    offer_bank_account: form.offer_bank_account.trim() || null,
    offer_bank_name: form.offer_bank_name.trim() || null,
    offer_payment_terms: form.offer_payment_terms.trim() || null,
    offer_default_vat_rate: Number.isFinite(vat) ? vat : 8,
    offer_validity_days: Number.isFinite(days) && days > 0 ? Math.round(days) : 30,
    accountant_email: form.accountant_email.trim() || null,
    invoice_email_subject: form.invoice_email_subject.trim() || null,
    invoice_email_body: form.invoice_email_body.trim() || null
  };
}
