import type { OrganizationOfferRow } from "@/lib/organization-offer-profile";
import { sellerProfileFromOrganization } from "@/lib/organization-offer-profile";

export type OfferSellerProfile = {
  legalName: string;
  nip: string;
  /** KRS, REGON, reprezentacja, pełnomocnik, siedziba (miejscownik) — do komparycji umów. */
  krs: string;
  regon: string;
  representation: string;
  proxy: string;
  seat: string;
  /** Osoba do kontaktu w umowie — na razie tylko z ustawień domyślnych. */
  contactPerson: string;
  addressLine: string;
  postalCity: string;
  phone: string;
  phoneSecondary: string;
  slogan: string;
  email: string;
  website: string;
  bankAccount: string;
  bankName: string;
  paymentTerms: string;
  defaultVatRate: number;
  validityDays: number;
};

/** @deprecated Użyj sellerProfileFromOrganization(orgRow) — dane z Supabase. */
export function getOfferSellerProfile(org?: OrganizationOfferRow | null): OfferSellerProfile {
  return sellerProfileFromOrganization(org);
}
