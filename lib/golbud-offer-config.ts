/**
 * Stałe dane firmy na PDF oferty — edytuj tutaj, bez zmiennych na Vercel.
 * Env (OFFER_*) nadal może nadpisać pojedyncze pola, jeśli kiedyś będzie potrzeba.
 */

export const GOLBUD_OFFER_DEFAULTS = {
  legalName: "Golbud Dawid Golczuk — usługi ogólnobudowlane",
  nip: "1182217667",
  addressLine: "ul. Wincentego Witosa 8a",
  postalCity: "05-850 Ożarów Mazowiecki",
  phone: "+48 508 792 580",
  email: "kontakt.golbud@gmail.com",
  website: "www.gol-bud.com",
  /** Wpisz numer konta, gdy masz — wtedy pojawi się na PDF i w warunkach płatności. */
  bankAccount: "",
  bankName: "",
  paymentTerms:
    "Przelew na konto w terminie 7 dni od daty faktury, o ile strony nie ustalą inaczej. Przy większych zleceniach możliwa zaliczka — do uzgodnienia.",
  /** Stawka VAT na pozycjach oferty (np. 8 lub 23). */
  defaultVatRate: 8,
  validityDays: 30
} as const;
