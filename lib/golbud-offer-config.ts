/**
 * Dane firmy podstawiane, gdy w Ustawieniach → Firma pole jest puste.
 *
 * Od sierpnia 2026 GolBud działa jako spółka komandytowa — dane poniżej pochodzą z jej wzorów
 * dokumentów (umowa konsument, protokoły, aneksy). Wcześniej był tu NIP jednoosobowej
 * działalności (1182217667), który trafiał na każdy PDF z pustym polem w ustawieniach.
 *
 * To tylko wartości zapasowe — dane zapisane w bazie mają pierwszeństwo i program ich nie zmienia.
 */

export const GOLBUD_OFFER_DEFAULTS = {
  legalName: "GOLBUD DAWID GOLCZUK SPÓŁKA KOMANDYTOWA",
  nip: "1182321382",
  krs: "0001216652",
  regon: "543732168",
  representation: "komplementariusza Dawida Golczuka, uprawnionego do jednoosobowej reprezentacji spółki",
  /** Pełnomocnik do umów przedwstępnych — w bierniku, bo tak wchodzi do zdania. */
  proxy: "Kacpra Szmurło",
  /** Osoba odpowiedzialna za umowę po stronie Wykonawcy (§ 10 umowy konsumenckiej). */
  contactPerson: "Dawid Golczuk",
  addressLine: "ul. Wincentego Witosa 8a",
  postalCity: "05-850 Ożarów Mazowiecki",
  /** Siedziba w miejscowniku: „z siedzibą w Ożarowie Mazowieckim”, „zawarta w Ożarowie Mazowieckim”. */
  seat: "Ożarowie Mazowieckim",
  phone: "+48 508 792 580",
  phoneSecondary: "+48 797 927 535",
  email: "kontakt.golbud@gmail.com",
  website: "www.gol-bud.com",
  slogan: "",
  /** Wpisz numer konta, gdy masz — wtedy pojawi się na PDF i w warunkach płatności. */
  bankAccount: "",
  bankName: "",
  paymentTerms:
    "Przelew na konto w terminie 7 dni od daty faktury, o ile strony nie ustalą inaczej. Przy większych zleceniach możliwa zaliczka — do uzgodnienia.",
  /** Stawka VAT na pozycjach oferty (np. 8 lub 23). */
  defaultVatRate: 8,
  validityDays: 30
} as const;
