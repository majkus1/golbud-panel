/**
 * Szablony dokumentów firmowych (wg rodzin wzorów GolBud): umowy, aneksy,
 * protokoły, wezwania do zapłaty, oświadczenia. Treść jest w pełni edytowalna w UI przed generowaniem
 * PDF — szablon dostarcza profesjonalny punkt wyjścia z uzupełnionymi danymi
 * sprawy. Dokładną treść prawną można wkleić z własnych wzorów.
 */

export type DocumentCategory = "umowa" | "aneks" | "protokół" | "wezwanie do zapłaty" | "oświadczenie";

export type DocumentTemplateContext = {
  clientName: string;
  clientAddress: string;
  clientPhone: string;
  clientEmail: string;
  scope: string;
  todayPl: string;
  /** Wartość brutto (netto z wyceny + VAT z ustawień firmy) — sformatowana lub pusty string. */
  valueGross: string;
  /** Wartość netto z wyceny — sformatowana lub pusty string. */
  valueNet: string;
  /**
   * Pełny zapis do umowy: „12 000,00 zł netto, tj. 12 960,00 zł brutto (VAT 8 %)”.
   * Pole w sprawie nazywa się „szacowana wartość netto”, więc dokument musi pokazać obie
   * kwoty — wcześniej netto trafiało do umowy z podpisem „brutto”.
   */
  valueDescription: string;
  /** Planowane rozpoczęcie prac (dd.mm.rrrr) lub pusty string — sprawa nie ma jeszcze tego pola. */
  startDate: string;
  /** Planowane zakończenie z karty sprawy (dd.mm.rrrr) lub pusty string. */
  endDate: string;
  /** Aktualna kwota zaległości do wezwania — sformatowana lub pusty string. */
  debtAmount: string;
  /** Krótki opis zaległych płatności z harmonogramu. */
  overduePaymentSummary: string;
  sellerLegalName: string;
  sellerNip: string;
  sellerAddress: string;
  sellerPhone: string;
};

export type DocumentTemplate = {
  id: string;
  /** Etykieta w wyborze szablonu. */
  label: string;
  /** Grupa (do kategorii załącznika). */
  category: DocumentCategory;
  /** Tytuł na PDF. */
  title: string;
  /** Czy pokazać blok stron (Wykonawca / Zamawiający). */
  showParties: boolean;
  /** Czy pokazać miejsca na podpisy. */
  showSignatures: boolean;
  /** Etykiety podpisów. */
  signLeft: string;
  signRight: string;
  /** Budowa treści startowej z danych sprawy. */
  buildBody: (ctx: DocumentTemplateContext) => string;
};

const fb = (v: string, placeholder = "………") => (v && v.trim() ? v.trim() : placeholder);

const WYKONAWCA = "Wykonawca";
const ZAMAWIAJACY = "Zamawiający";

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  // ── UMOWY ───────────────────────────────────────────────────────────────────
  {
    id: "umowa-konsument",
    label: "Umowa o roboty budowlane — klient indywidualny",
    category: "umowa",
    title: "UMOWA O ROBOTY BUDOWLANE",
    showParties: true,
    showSignatures: true,
    signLeft: ZAMAWIAJACY,
    signRight: WYKONAWCA,
    buildBody: (c) =>
      [
        `§ 1. Przedmiot umowy`,
        `Wykonawca zobowiązuje się do wykonania na rzecz Zamawiającego robót budowlanych w zakresie: ${fb(c.scope)}.`,
        `Miejsce wykonania robót: ${fb(c.clientAddress)}.`,
        ``,
        `§ 2. Wynagrodzenie`,
        `Za wykonanie przedmiotu umowy Strony ustalają wynagrodzenie w wysokości ${fb(c.valueDescription, "……… zł netto, tj. ……… zł brutto")}, zgodnie z zaakceptowanym kosztorysem/ofertą stanowiącą załącznik do niniejszej umowy.`,
        `Płatność: zaliczka przed rozpoczęciem prac oraz pozostała część po odbiorze końcowym. Numer konta i warunki płatności zgodnie z ofertą.`,
        ``,
        `§ 3. Termin realizacji`,
        `Rozpoczęcie prac: ${fb(c.startDate, "do uzgodnienia")}. Planowane zakończenie: ${fb(c.endDate, "do uzgodnienia")}. Terminy mogą ulec zmianie z przyczyn niezależnych od Stron (warunki pogodowe, dostępność materiałów), co Strony potwierdzą pisemnie lub mailowo.`,
        ``,
        `§ 4. Prace dodatkowe`,
        `Prace spoza zakresu kosztorysu wymagają odrębnego ustalenia i wyceny w formie aneksu do umowy.`,
        ``,
        `§ 5. Gwarancja i rękojmia`,
        `Wykonawca udziela gwarancji na wykonane roboty na okres ……… miesięcy. Odpowiedzialność z tytułu rękojmi zgodnie z przepisami Kodeksu cywilnego.`,
        ``,
        `§ 6. Odstąpienie od umowy (konsument)`,
        `Zamawiającemu będącemu konsumentem przysługują uprawnienia wynikające z przepisów o ochronie konsumentów. Szczegóły zgodnie z pouczeniem stanowiącym załącznik.`,
        ``,
        `§ 7. Postanowienia końcowe`,
        `W sprawach nieuregulowanych stosuje się przepisy Kodeksu cywilnego. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze Stron.`
      ].join("\n")
  },
  {
    id: "umowa-firma",
    label: "Umowa o roboty budowlane — firma / przedsiębiorca",
    category: "umowa",
    title: "UMOWA O ROBOTY BUDOWLANE",
    showParties: true,
    showSignatures: true,
    signLeft: ZAMAWIAJACY,
    signRight: WYKONAWCA,
    buildBody: (c) =>
      [
        `§ 1. Przedmiot umowy`,
        `Wykonawca zobowiązuje się do wykonania robót budowlanych w zakresie: ${fb(c.scope)}, w lokalizacji: ${fb(c.clientAddress)}, zgodnie z kosztorysem/ofertą stanowiącą załącznik do umowy.`,
        ``,
        `§ 2. Wynagrodzenie i faktury`,
        `Wynagrodzenie ryczałtowe/kosztorysowe wynosi ${fb(c.valueDescription, "……… zł netto, tj. ……… zł brutto")}. Rozliczenie następuje na podstawie faktur VAT, płatnych przelewem w terminie ……… dni od daty wystawienia.`,
        ``,
        `§ 3. Termin realizacji`,
        `Rozpoczęcie: ${fb(c.startDate, "do uzgodnienia")}; zakończenie: ${fb(c.endDate, "do uzgodnienia")}. Zmiana terminu wymaga formy pisemnej (aneks).`,
        ``,
        `§ 4. Obowiązki Stron`,
        `Zamawiający zapewnia dostęp do terenu budowy, przyłącza oraz niezbędne uzgodnienia. Wykonawca wykonuje roboty zgodnie ze sztuką budowlaną, normami i przepisami BHP.`,
        ``,
        `§ 5. Kary umowne`,
        `Strony mogą zastrzec kary umowne za zwłokę w wykonaniu lub usunięciu wad — w wysokości ……… % wynagrodzenia za każdy dzień zwłoki.`,
        ``,
        `§ 6. Gwarancja`,
        `Wykonawca udziela gwarancji na okres ……… miesięcy od daty odbioru końcowego.`,
        ``,
        `§ 7. Postanowienia końcowe`,
        `W sprawach nieuregulowanych stosuje się Kodeks cywilny. Umowę sporządzono w dwóch egzemplarzach.`
      ].join("\n")
  },
  {
    id: "umowa-podwykonawcza",
    label: "Umowa podwykonawcza",
    category: "umowa",
    title: "UMOWA PODWYKONAWCZA",
    showParties: true,
    showSignatures: true,
    signLeft: "Podwykonawca",
    signRight: "Wykonawca (Generalny)",
    buildBody: (c) =>
      [
        `§ 1. Przedmiot umowy`,
        `Podwykonawca zobowiązuje się do wykonania na rzecz Wykonawcy następujących robót: ${fb(c.scope)}, w ramach inwestycji realizowanej w: ${fb(c.clientAddress)}.`,
        ``,
        `§ 2. Wynagrodzenie`,
        `Za wykonanie zakresu Podwykonawcy przysługuje wynagrodzenie w wysokości ${fb(c.valueDescription, "……… zł netto, tj. ……… zł brutto")}, płatne na podstawie faktury po odbiorze robót.`,
        ``,
        `§ 3. Termin`,
        `Rozpoczęcie: ………; zakończenie: ………. Podwykonawca zobowiązuje się do realizacji w terminach zgodnych z harmonogramem inwestycji.`,
        ``,
        `§ 4. Odpowiedzialność`,
        `Podwykonawca odpowiada za jakość i terminowość powierzonych robót oraz przestrzeganie przepisów BHP na terenie budowy.`,
        ``,
        `§ 5. Gwarancja`,
        `Podwykonawca udziela gwarancji na wykonane roboty na okres ……… miesięcy.`,
        ``,
        `§ 6. Postanowienia końcowe`,
        `W sprawach nieuregulowanych stosuje się Kodeks cywilny. Umowę sporządzono w dwóch egzemplarzach.`
      ].join("\n")
  },
  {
    id: "umowa-przedwstepna",
    label: "Umowa przedwstępna",
    category: "umowa",
    title: "UMOWA PRZEDWSTĘPNA",
    showParties: true,
    showSignatures: true,
    signLeft: ZAMAWIAJACY,
    signRight: WYKONAWCA,
    buildBody: (c) =>
      [
        `§ 1. Oświadczenia Stron`,
        `Strony oświadczają, że zamierzają zawrzeć umowę o roboty budowlane (umowę przyrzeczoną) w zakresie: ${fb(c.scope)}, w lokalizacji: ${fb(c.clientAddress)}.`,
        ``,
        `§ 2. Termin zawarcia umowy przyrzeczonej`,
        `Strony zobowiązują się zawrzeć umowę przyrzeczoną w terminie do dnia ………, po spełnieniu uzgodnionych warunków (m.in. akceptacja kosztorysu, dostępność terminu).`,
        ``,
        `§ 3. Zadatek / zaliczka`,
        `Na poczet realizacji Zamawiający wpłaca kwotę ……… zł tytułem zadatku/zaliczki. Skutki wpłaty regulują przepisy Kodeksu cywilnego (art. 394 k.c.).`,
        ``,
        `§ 4. Postanowienia końcowe`,
        `W sprawach nieuregulowanych stosuje się Kodeks cywilny. Umowę sporządzono w dwóch egzemplarzach.`
      ].join("\n")
  },

  // ── ANEKSY ──────────────────────────────────────────────────────────────────
  {
    id: "aneks-roboty-dodatkowe",
    label: "Aneks — roboty dodatkowe",
    category: "aneks",
    title: "ANEKS DO UMOWY — ROBOTY DODATKOWE",
    showParties: true,
    showSignatures: true,
    signLeft: ZAMAWIAJACY,
    signRight: WYKONAWCA,
    buildBody: (c) =>
      [
        `Aneks do umowy o roboty budowlane nr ……… z dnia ……… dotyczącej inwestycji w: ${fb(c.clientAddress)}.`,
        ``,
        `§ 1. Zakres robót dodatkowych`,
        `Strony zgodnie ustalają wykonanie następujących robót dodatkowych, nieobjętych pierwotnym kosztorysem: ${fb(c.scope, "……… (opis prac dodatkowych)")}.`,
        ``,
        `§ 2. Wynagrodzenie za roboty dodatkowe`,
        `Z tytułu robót dodatkowych Wykonawcy przysługuje dodatkowe wynagrodzenie w wysokości ……… zł brutto.`,
        ``,
        `§ 3. Wpływ na termin`,
        `Wykonanie robót dodatkowych wydłuża termin realizacji o ……… dni roboczych.`,
        ``,
        `§ 4. Pozostałe postanowienia`,
        `Pozostałe postanowienia umowy pozostają bez zmian. Aneks sporządzono w dwóch egzemplarzach.`
      ].join("\n")
  },
  {
    id: "aneks-termin",
    label: "Aneks — zmiana terminu",
    category: "aneks",
    title: "ANEKS DO UMOWY — ZMIANA TERMINU",
    showParties: true,
    showSignatures: true,
    signLeft: ZAMAWIAJACY,
    signRight: WYKONAWCA,
    buildBody: (c) =>
      [
        `Aneks do umowy o roboty budowlane nr ……… z dnia ……… dotyczącej inwestycji w: ${fb(c.clientAddress)}.`,
        ``,
        `§ 1. Zmiana terminu`,
        `Strony zgodnie zmieniają termin zakończenia robót. Nowy termin zakończenia: ………. Przyczyna zmiany: ……….`,
        ``,
        `§ 2. Pozostałe postanowienia`,
        `Pozostałe postanowienia umowy pozostają bez zmian. Aneks sporządzono w dwóch egzemplarzach.`
      ].join("\n")
  },
  {
    id: "aneks-zaplata",
    label: "Aneks — zobowiązanie do zapłaty",
    category: "aneks",
    title: "ANEKS / ZOBOWIĄZANIE DO ZAPŁATY",
    showParties: true,
    showSignatures: true,
    signLeft: "Dłużnik / Zamawiający",
    signRight: "Wierzyciel / Wykonawca",
    buildBody: (c) =>
      [
        `Dotyczy umowy/realizacji w: ${fb(c.clientAddress)} dla ${fb(c.clientName)}.`,
        ``,
        `§ 1. Uznanie zobowiązania`,
        `Zamawiający uznaje zobowiązanie wobec Wykonawcy w kwocie ${fb(c.valueGross, "……… zł")} z tytułu wykonanych robót budowlanych.`,
        ``,
        `§ 2. Harmonogram spłaty`,
        `Zamawiający zobowiązuje się do zapłaty powyższej kwoty w terminie do dnia ……… / w ratach: ……….`,
        ``,
        `§ 3. Skutki braku zapłaty`,
        `W przypadku braku zapłaty Wykonawca jest uprawniony do naliczenia odsetek ustawowych za opóźnienie oraz dochodzenia roszczeń na drodze sądowej.`,
        ``,
        `Dokument sporządzono w dwóch egzemplarzach.`
      ].join("\n")
  },

  // ── PROTOKOŁY ─────────────────────────────────────────────────────────────────
  {
    id: "protokol-odbioru",
    label: "Protokół odbioru końcowego",
    category: "protokół",
    title: "PROTOKÓŁ ODBIORU KOŃCOWEGO ROBÓT",
    showParties: true,
    showSignatures: true,
    signLeft: "Odbierający (Zamawiający)",
    signRight: "Przekazujący (Wykonawca)",
    buildBody: (c) =>
      [
        `Sporządzony w dniu ${c.todayPl} w: ${fb(c.clientAddress)}.`,
        `Dotyczy robót: ${fb(c.scope)} dla ${fb(c.clientName)}.`,
        ``,
        `§ 1. Przedmiot odbioru`,
        `Komisja w składzie: ze strony Wykonawcy ……… oraz ze strony Zamawiającego ……… dokonała odbioru końcowego wykonanych robót.`,
        ``,
        `§ 2. Ocena jakości`,
        `Roboty wykonano zgodnie / niezgodnie* z umową i sztuką budowlaną. Stwierdzone usterki: ……… (lub: brak usterek).`,
        ``,
        `§ 3. Wnioski`,
        `Roboty odebrano bez zastrzeżeń / z zastrzeżeniami*. Termin usunięcia usterek: ……….`,
        `* niepotrzebne skreślić.`,
        ``,
        `§ 4. Rozliczenie`,
        `Pozostała kwota do zapłaty: ${fb(c.valueGross, "……… zł")}. Podstawa do wystawienia faktury końcowej.`
      ].join("\n")
  },
  {
    id: "protokol-przekazania",
    label: "Protokół przekazania terenu budowy",
    category: "protokół",
    title: "PROTOKÓŁ PRZEKAZANIA TERENU BUDOWY",
    showParties: true,
    showSignatures: true,
    signLeft: "Przekazujący (Zamawiający)",
    signRight: "Przejmujący (Wykonawca)",
    buildBody: (c) =>
      [
        `Sporządzony w dniu ${c.todayPl} w: ${fb(c.clientAddress)}.`,
        ``,
        `§ 1. Przekazanie`,
        `Zamawiający przekazuje, a Wykonawca przejmuje teren budowy w celu realizacji robót: ${fb(c.scope)}.`,
        ``,
        `§ 2. Stan terenu i media`,
        `Stan terenu w dniu przekazania: ………. Dostępne przyłącza (woda, prąd): ………. Miejsce składowania materiałów: ……….`,
        ``,
        `§ 3. Uwagi`,
        `Uwagi Stron: ………. Z chwilą przejęcia terenu Wykonawca odpowiada za jego zabezpieczenie i przestrzeganie przepisów BHP.`
      ].join("\n")
  },

  // ── WEZWANIA DO ZAPŁATY ─────────────────────────────────────────────────────
  {
    id: "wezwanie-do-zaplaty",
    label: "Wezwanie do zapłaty",
    category: "wezwanie do zapłaty",
    title: "WEZWANIE DO ZAPŁATY",
    showParties: true,
    showSignatures: true,
    signLeft: "Potwierdzenie odbioru / Zamawiający",
    signRight: "Wzywający / Wykonawca",
    buildBody: (c) => {
      const amount = fb(c.debtAmount, fb(c.valueGross, "……… zł"));
      return [
        `Dotyczy realizacji robót budowlanych dla ${fb(c.clientName)} w lokalizacji: ${fb(c.clientAddress)}.`,
        ``,
        `W związku z brakiem terminowej płatności wzywamy Zamawiającego do zapłaty zaległej kwoty ${amount}.`,
        `Zaległość obejmuje: ${fb(c.overduePaymentSummary, "……… (np. faktura, etap prac, zaliczka lub rozliczenie końcowe)")}.`,
        ``,
        `§ 1. Termin zapłaty`,
        `Prosimy o uregulowanie wskazanej kwoty w terminie 7 dni od dnia doręczenia niniejszego wezwania, nie później niż do dnia ………, na rachunek bankowy wskazany w umowie/fakturze lub uzgodniony z Wykonawcą.`,
        ``,
        `§ 2. Podstawa naliczenia należności`,
        `Należność wynika z wykonanych robót budowlanych w zakresie: ${fb(c.scope, "………")}. Na dzień ${c.todayPl} płatność pozostaje nieuregulowana w całości albo w części.`,
        ``,
        `§ 3. Skutki braku zapłaty`,
        `Brak zapłaty w powyższym terminie może skutkować naliczeniem odsetek ustawowych za opóźnienie oraz skierowaniem sprawy na drogę postępowania sądowego, wraz z dochodzeniem kosztów odzyskania należności, o ile wynika to z umowy i obowiązujących przepisów.`,
        ``,
        `Niniejsze wezwanie stanowi próbę polubownego zakończenia sprawy. W przypadku dokonania płatności przed otrzymaniem pisma prosimy o przesłanie potwierdzenia przelewu.`
      ].join("\n");
    }
  },

  // ── OŚWIADCZENIA / DOKUMENTY OKOŁOUMOWNE ─────────────────────────────────────
  {
    id: "oswiadczenie-rodo",
    label: "Klauzula informacyjna RODO (konsument)",
    category: "oświadczenie",
    title: "KLAUZULA INFORMACYJNA RODO",
    showParties: false,
    showSignatures: true,
    signLeft: "Data i podpis Klienta",
    signRight: WYKONAWCA,
    buildBody: (c) =>
      [
        `Zgodnie z art. 13 RODO informujemy:`,
        ``,
        `1. Administratorem danych osobowych jest ${fb(c.sellerLegalName)}${c.sellerNip ? `, NIP ${c.sellerNip}` : ""}${c.sellerAddress ? `, ${c.sellerAddress}` : ""}.`,
        `2. Dane (imię, nazwisko, adres, telefon, e-mail) przetwarzane są w celu zawarcia i realizacji umowy oraz wystawienia dokumentów księgowych — na podstawie art. 6 ust. 1 lit. b i c RODO.`,
        `3. Dane mogą być udostępnione podmiotom współpracującym (biuro rachunkowe, podwykonawcy) wyłącznie w zakresie niezbędnym do realizacji umowy.`,
        `4. Dane przechowywane są przez okres realizacji umowy oraz przez czas wymagany przepisami prawa (m.in. podatkowymi).`,
        `5. Przysługuje Pani/Panu prawo dostępu do danych, ich sprostowania, usunięcia lub ograniczenia przetwarzania oraz wniesienia skargi do Prezesa UODO.`,
        ``,
        `Oświadczam, że zapoznałem/-am się z powyższą informacją.`
      ].join("\n")
  },
  {
    id: "oswiadczenie-vat8",
    label: "Oświadczenie — stawka VAT 8% (budownictwo mieszkaniowe)",
    category: "oświadczenie",
    title: "OŚWIADCZENIE — STAWKA VAT 8%",
    showParties: false,
    showSignatures: true,
    signLeft: "Data i podpis Inwestora",
    signRight: "",
    buildBody: (c) =>
      [
        `Ja, niżej podpisany/-a ${fb(c.clientName)}, zamieszkały/-a ${fb(c.clientAddress)},`,
        `oświadczam, że roboty budowlane wykonywane przez ${fb(c.sellerLegalName)} w zakresie: ${fb(c.scope)},`,
        `dotyczą obiektu budownictwa objętego społecznym programem mieszkaniowym w rozumieniu art. 41 ust. 12–12c ustawy o podatku od towarów i usług.`,
        ``,
        `Powierzchnia użytkowa lokalu mieszkalnego nie przekracza 150 m² / budynku mieszkalnego jednorodzinnego nie przekracza 300 m².*`,
        `W związku z powyższym do robót zastosowanie ma obniżona stawka podatku VAT 8%.`,
        `* niepotrzebne skreślić.`,
        ``,
        `Oświadczam, że powyższe dane są zgodne ze stanem faktycznym.`
      ].join("\n")
  },
  {
    id: "potwierdzenie-gotowka",
    label: "Potwierdzenie odbioru gotówki",
    category: "oświadczenie",
    title: "POTWIERDZENIE ODBIORU GOTÓWKI",
    showParties: false,
    showSignatures: true,
    signLeft: "Wpłacający",
    signRight: "Przyjmujący (Wykonawca)",
    buildBody: (c) =>
      [
        `Potwierdzam, że w dniu ${c.todayPl} przyjąłem/-am od ${fb(c.clientName)}`,
        `kwotę ${fb(c.valueGross, "……… zł")} (słownie: ………………………………)`,
        `tytułem: ${fb(c.scope, "zapłata za roboty budowlane")}, dotyczy inwestycji w: ${fb(c.clientAddress)}.`,
        ``,
        `Niniejsze potwierdzenie stanowi dowód przekazania i odbioru środków pieniężnych w gotówce.`
      ].join("\n")
  }
];

export function getDocumentTemplate(id: string): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES.find((t) => t.id === id);
}
