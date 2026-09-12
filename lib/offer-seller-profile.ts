import type { OrganizationOfferRow } from "@/lib/organization-offer-profile";
import { sellerProfileFromOrganization } from "@/lib/organization-offer-profile";

export type OfferSellerProfile = {
  legalName: string;
  nip: string;
  addressLine: string;
  postalCity: string;
  phone: string;
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
