/**
 * Wzory dokumentów GolBud. Treść umów, aneksów, protokołów, klauzuli RODO, potwierdzenia
 * gotówki i oświadczenia VAT pochodzi z plików od Dawida (7.08.2026), zamówienie — z jego PDF.
 * Program uzupełnia dane sprawy i firmy; brakujące miejsca zostają jako wielokropki,
 * a generator pokazuje, czego brakuje (`requires`).
 *
 * Przy przepisywaniu poprawiono oczywiste błędy wzorów (lista w DOKUMENTY-POPRAWKI poniżej),
 * bez zmiany sensu postanowień. Oznaczenia w treści opisuje lib/document-body.ts.
 *
 * Poprawki względem plików Dawida:
 *  - umowa konsument § 4 ust. 2 lit. a: odwołanie „§ 5 ust. 4” → „§ 5 ust. 3” (tam są zaliczki);
 *  - umowa konsument § 3 ust. 2 lit. i: „nieingerowania w sposób wykonania zobowiązania przez Inwestora”
 *    → „przez Wykonawcę” (Inwestor zobowiązuje się nie ingerować w pracę Wykonawcy);
 *  - umowa konsument § 5 ust. 7 i § 8 ust. 1 lit. b: „Zamawiającego” → „Inwestora” (strona nazywa się Inwestor);
 *  - umowa konsument § 5 ust. 3 lit. c: „przez Wykonawcy” → „przez Wykonawcę”; § 9 ust. 7 „Zobowiązania … wiąże”
 *    → „Zobowiązanie … wiąże”; literówki „zostaćwykonana”, „zapewnienie kontenera”;
 *  - „zwanym … Wykonawcą” → „zwaną” (Wykonawca to spółka);
 *  - aneks roboty dodatkowe § 1 ust. 3: „§ 5 ust. 5” → „§ 5 ust. 3” (harmonogram zaliczek);
 *  - aneksy: „zawarta … (dalej: „Umowa”)” → „zawarty … (dalej: „Aneks”)” — aneks nie jest umową;
 *  - aneks o zapłatę: dopisane „zwaną … Inwestorem / Wykonawcą”, których brakowało;
 *  - RODO: „należy skontaktować się”, „postępowań”; oświadczenie VAT: „mieszczącego się”;
 *  - potwierdzenie gotówki: „od Inwestora” → „od Zleceniodawcy” (tak nazywa się strona w dokumencie).
 */

import type { DocumentContext, RequiredField } from "@/lib/document-context";

export type { DocumentTemplateContext } from "@/lib/document-context";

export type DocumentCategory = "umowa" | "aneks" | "protokół" | "wezwanie do zapłaty" | "oświadczenie";

export type DocumentTemplate = {
  id: string;
  /** Etykieta w wyborze wzoru. */
  label: string;
  /** Grupa — i kategoria pliku po zapisaniu w sprawie. */
  category: DocumentCategory;
  /** Nazwa pliku i tytuł PDF; na stronie drukujemy go tylko, gdy treść nie ma własnego „# ”. */
  title: string;
  /** „boxes” — ramki Wykonawca / Zamawiający nad treścią; „none” — strony opisane w treści. */
  parties: "boxes" | "none";
  /** Podpisy na końcu dokumentu; pusta lista — brak albo podpisy w treści (`[podpisy: …]`). */
  signatures: string[];
  /** Tekst stopki (obok numeru strony). */
  footer?: string;
  /** Czy wzór korzysta z pozycji wariantu — generator pokazuje wtedy wybór wariantu. */
  usesVariant?: boolean;
  /** Dane, których brak generator zgłasza przed zapisem. */
  requires: RequiredField[];
  buildBody: (ctx: DocumentContext) => string;
};

const DOTS = "……………………………………";
const LONG_DOTS = "………………………………………………………………………………";

/** Wartość albo wielokropek do ręcznego uzupełnienia. */
const fb = (value: string | null | undefined, placeholder = DOTS) => (value && value.trim() ? value.trim() : placeholder);

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Lista punktów „a) … b) …” z danych albo z pustymi miejscami (minimum `min` wierszy). */
function letterList(items: string[], min: number): string {
  const rows = items.length ? items : Array.from({ length: min }, () => LONG_DOTS);
  return rows.map((text, i) => `a)`.replace("a", LETTERS[i] ?? "z") + ` ${text}`).join("\n");
}

function numberedLines(items: string[], min: number): string {
  const rows = items.length ? items : Array.from({ length: min }, () => LONG_DOTS);
  return rows.map((text, i) => `${i + 1}. ${text}`).join("\n");
}

function sellerBlock(c: DocumentContext): string {
  return [
    `**${fb(c.sellerLegalName)}**`,
    c.sellerAddressLine,
    c.sellerPostalCity,
    c.sellerNip ? `NIP ${c.sellerNip}` : "",
    c.sellerKrs ? `KRS ${c.sellerKrs}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

/** Nagłówek aneksu: numer, umowa, miejsce i data, strony. */
function annexHeader(c: DocumentContext): string {
  return [
    `# ANEKS NR ${DOTS}`,
    `<> DO UMOWY O ROBOTY BUDOWLANE NR **${fb(c.contractNumber, "………")}** Z DNIA **${fb(c.contractDate, "………")}**`,
    `<> zawarty w ${fb(c.place)} w dniu ${c.todayPl} r. (dalej: „Aneks”) pomiędzy:`,
    ``,
    c.clientParty,
    `zwaną w dalszej części Aneksu: **„Inwestorem”**,`,
    `**a**`,
    `${c.sellerKomparycja},`,
    `zwaną w dalszej części Aneksu: **„Wykonawcą”**,`,
    `dalej łącznie zwani **„Stronami”**.`,
    ``,
    `<> **Preambuła**`,
    `1. W dniu ${fb(c.contractDate, "………")} Strony zawarły umowę o roboty budowlane nr ${fb(c.contractNumber, "………")} (dalej: „Umowa”).`
  ].join("\n");
}

const ANNEX_FINAL = (n: number) =>
  [
    ``,
    `§ ${n} Postanowienia końcowe`,
    `1. Pozostałe postanowienia Umowy pozostają bez zmian.`,
    `2. Niniejszy Aneks stanowi integralną część Umowy i wchodzi w życie z dniem jego podpisania przez obie Strony.`
  ].join("\n");

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  // ── UMOWY ───────────────────────────────────────────────────────────────────
  {
    id: "umowa-konsument",
    label: "Umowa o roboty budowlane — klient indywidualny (wzór GolBud)",
    category: "umowa",
    title: "UMOWA O ROBOTY BUDOWLANE",
    parties: "none",
    signatures: ["INWESTOR", "WYKONAWCA"],
    usesVariant: true,
    requires: ["clientName", "siteAddress", "contractNumber", "contractDate", "endDate", "value", "rates", "bankAccount", "sellerKrs", "sellerRegon"],
    buildBody: (c) => {
      const [a1, a2, a3] = c.advances.length ? c.advances : [DOTS, DOTS, DOTS];
      return [
        `# UMOWA O ROBOTY BUDOWLANE NR ${fb(c.contractNumber, "……")}`,
        `<> zawarta w ${fb(c.place)} w dniu ${fb(c.contractDate, DOTS)} r. (dalej: „Umowa”) pomiędzy:`,
        ``,
        c.clientParty,
        `zwaną w dalszej części Umowy: **„Inwestorem”**,`,
        `**a**`,
        `${c.sellerKomparycja},`,
        `zwaną w dalszej części Umowy: **„Wykonawcą”**,`,
        `dalej łącznie zwani **„Stronami”**.`,
        ``,
        `§ 1 Przedmiot Umowy`,
        `1. Inwestor powierza, a Wykonawca przyjmuje do wykonania roboty budowlane polegające na wykonaniu elewacji oraz innych robót budowlanych szczegółowo opisanych w ust. 2 poniżej w budynku położonym pod adresem: ${fb(c.siteAddress, LONG_DOTS)} (dalej: „Przedmiot Umowy”).`,
        `2. W zakres robót budowlanych stanowiących Przedmiot Umowy wchodzą następujące prace:`,
        letterList(c.scopeItems, 6),
        ``,
        `§ 2 Oświadczenia i zobowiązania ogólne Wykonawcy`,
        `1. Wykonawca oświadcza, że posiada niezbędne kwalifikacje, doświadczenie i zasoby do wykonania Przedmiotu Umowy.`,
        `2. Wykonawca zobowiązuje się do:`,
        `a) wykonywania Przedmiotu Umowy z należytą starannością, w sposób zgodny z wymaganiami Umowy oraz prawem powszechnie obowiązującym w Rzeczpospolitej Polskiej, jak również z projektem budowlanym, pod warunkiem przekazania Wykonawcy projektu budowlanego przed zawarciem Umowy;`,
        `b) utrzymywania terenu budowy w czystości i porządku, jak również uporządkowania terenu budowy, w tym usunięcia wszelkich zbędnych materiałów i odpadów po zakończeniu robót;`,
        `c) zapewnienia przestrzegania przepisów BHP, dotyczących ochrony przeciwpożarowej oraz przepisów dotyczących ochrony środowiska;`,
        `d) wykorzystania przy realizacji Przedmiotu Umowy własnych maszyn i narzędzi;`,
        `e) zapewnienia na własny koszt wszelkich wymaganych do realizacji Przedmiotu Umowy materiałów budowlanych, które będą zgodne z właściwymi przepisami (podpunkt dotyczy jedynie sytuacji, w której to Wykonawca zapewnia wszelkie wymagane materiały budowlane).`,
        `3. Wykonawca nie ponosi odpowiedzialności za wady, uszkodzenia lub inne nieprawidłowości w wykonanym Przedmiocie Umowy, które wynikają z:`,
        `a) niewłaściwego użytkowania budynku lub jego części przez Inwestora, w szczególności w sposób niezgodny z przeznaczeniem lub zaleceniami eksploatacyjnymi przekazanymi przez Wykonawcę;`,
        `b) błędów lub nieścisłości w projekcie budowlanym lub innej dokumentacji projektowej dostarczonej przez Inwestora lub osoby działające na jego zlecenie;`,
        `c) zastosowania materiałów budowlanych dostarczonych przez Inwestora, które nie spełniają wymagań technicznych lub jakościowych niezbędnych do prawidłowego wykonania robót;`,
        `d) zaniechania wykonania przez Inwestora wymaganych napraw, konserwacji lub innych czynności wynikających z zaleceń eksploatacyjnych.`,
        `4. W przypadku, gdy wady lub uszkodzenia powstaną w wyniku przyczyn określonych w ust. 3 powyżej, Wykonawca ma prawo do odmowy wykonania naprawy lub usunięcia wady w ramach gwarancji lub rękojmi.`,
        `5. Wykonawca nie ponosi odpowiedzialności za opóźnienia w realizacji Umowy wynikające z okoliczności określonych w ust. 3 powyżej.`,
        ``,
        `§ 3 Oświadczenia i zobowiązania ogólne Inwestora`,
        `1. Inwestor oświadcza, że budynek, na którym ma zostać wykonana elewacja, został wybudowany zgodnie z przepisami prawa, w tym przede wszystkim, że uzyskał wszelkie wymagane decyzje i pozwolenia.`,
        `2. Inwestor zobowiązuje się do:`,
        `a) dokonania zgłoszenia przebudowy polegającej na dociepleniu budynku o wysokości przekraczającej 12 m (dotyczy tylko budynków przekraczających 12 m wysokości);`,
        `b) udostępnienia Wykonawcy terenu budowy w terminie do dnia ${fb(c.startDate)}, na podstawie protokołu przekazania;`,
        `c) zapewnienia mediów — wody i energii elektrycznej dla celów wykonywania Przedmiotu Umowy oraz pokrywania kosztów związanych z ich dostarczeniem na teren budowy;`,
        `d) zapewnienia kontenera na odpady budowlane i inne nieczystości powstałe w czasie wykonywania Przedmiotu Umowy oraz jego regularnego opróżniania (w miarę potrzeby) i wywiezienia po wykonaniu Umowy oraz pokrycia kosztów z tym związanych;`,
        `e) dokonywania odbioru robót budowlanych;`,
        `f) zapłaty zaliczek i wynagrodzenia w terminie i na warunkach określonych w Umowie;`,
        `g) zapewnienia nadzoru uprawnionego kierownika budowy, jeżeli przepisy prawa przewidują taki obowiązek;`,
        `h) współdziałania z Wykonawcą przez cały okres realizacji inwestycji w zakresie niezbędnym do należytego i terminowego jej wykonania;`,
        `i) nieingerowania w sposób wykonania zobowiązania przez Wykonawcę, pod warunkiem że Wykonawca realizuje prace zgodnie z Umową, zasadami sztuki budowlanej i powszechnie obowiązującymi przepisami prawa;`,
        `j) zapewnienia na własny koszt wszystkich wymaganych do realizacji Przedmiotu Umowy materiałów budowlanych, które będą zgodne z właściwymi przepisami, i przekazywania tych materiałów w ilości i terminach uzgodnionych z Wykonawcą. Wykonawca z kolei jest zobowiązany do niezwłocznego poinformowania Inwestora o wszelkich wadach ilościowych lub jakościowych przekazanych materiałów budowlanych. Opóźnienie Inwestora w przekazaniu materiałów budowlanych powoduje odpowiednie przesunięcie terminu realizacji Przedmiotu Umowy (podpunkt dotyczy jedynie sytuacji, w której to Inwestor zapewnia wszelkie wymagane materiały budowlane).`,
        `3. Inwestor zgadza się na wykonywanie przez Wykonawcę zdjęć oraz filmów z realizacji Przedmiotu Umowy w trakcie jej realizacji, jak również po jej ukończeniu (najpóźniej w dniu odbioru końcowego) oraz udziela Wykonawcy zezwolenia na wykorzystywanie tak wykonanych zdjęć oraz filmów w celu promocji wykonywanej przez Wykonawcę działalności gospodarczej, w szczególności do prezentacji Przedmiotu Umowy w portfolio Wykonawcy, na stronie internetowej Wykonawcy, w kanałach społecznościowych prowadzonych przez Wykonawcę (m.in. Facebook, Instagram, LinkedIn) i na prezentowanie zdjęć i filmów obejmujących Przedmiot Umowy potencjalnym klientom Wykonawcy.`,
        ``,
        `§ 4 Termin wykonania oraz odbiór końcowy Przedmiotu Umowy`,
        `1. Strony ustalają termin wykonania Przedmiotu Umowy do dnia ${fb(c.endDate)}.`,
        `2. Zmiana terminu zakończenia wykonywania Przedmiotu Umowy jest możliwa w przypadkach:`,
        `a) wstrzymania robót lub przerw w pracach powstałych na wniosek Inwestora lub z przyczyn leżących po stronie Inwestora, przy czym Strony ustalają, że brak wpłaty przez Inwestora zaliczki w kwotach i terminach wskazanych w § 5 ust. 3 Umowy stanowi podstawę do wstrzymania robót budowlanych z przyczyn leżących po stronie Inwestora;`,
        `b) niekorzystnych warunków pogodowych uniemożliwiających albo poważnie utrudniających wykonywanie robót budowlanych;`,
        `c) działania siły wyższej, rozumianej jako zdarzenie zewnętrzne, na które żadna ze Stron nie miała wpływu, którego żadna ze Stron nie mogła przewidzieć w czasie zawierania Umowy lub w trakcie jej wykonywania oraz nie miała możliwości jemu zapobiec lub uniknąć, w tym w szczególności: działania wojenne, ataki terrorystyczne, zamieszki, strajki lub lokaut — spowodowany przez osoby inne niż personel Strony, zdarzenia spowodowane siłami przyrody, m.in. klęski żywiołowe, powodzie, huragany, trzęsienia ziemi.`,
        `3. Przez wykonanie Przedmiotu Umowy w określonej dacie rozumie się dokonanie przez Wykonawcę i Inwestora odbioru końcowego robót określonych w § 1 Umowy, potwierdzonego stosownym protokołem odbioru końcowego. Termin odbioru końcowego zostanie zaproponowany przez Wykonawcę pod koniec wykonywania Przedmiotu Umowy.`,
        `4. Z czynności odbioru zostanie sporządzony protokół odbioru końcowego, zawierający wszelkie ustalenia Stron, zgłoszone zastrzeżenia oraz stwierdzone wady lub usterki. Wady lub usterki wskazane w protokole odbioru końcowego zostaną usunięte przez Wykonawcę w terminie 14 dni od dnia zakończenia czynności odbiorowych, chyba że ze względów technologicznych, warunków atmosferycznych lub przyczyn niezależnych od Wykonawcy konieczne będzie ustalenie innego terminu. Bezpodstawne nieprzystąpienie przez Inwestora do odbioru końcowego, pomimo prawidłowego zawiadomienia go o terminie odbioru, uprawnia Wykonawcę do sporządzenia jednostronnego protokołu odbioru końcowego. Z dniem sporządzenia jednostronnego protokołu odbioru końcowego Przedmiot Umowy uznaje się za wykonany i odebrany. Podpisanie protokołu odbioru końcowego bez zastrzeżeń stanowi potwierdzenie prawidłowego wykonania Przedmiotu Umowy oraz ostateczną akceptację zakresu wykonanych robót, ich obmiaru i wysokości należnego Wykonawcy wynagrodzenia. Po podpisaniu protokołu odbioru końcowego bez zastrzeżeń Inwestor nie jest uprawniony do kwestionowania wysokości wynagrodzenia na podstawie późniejszych obmiarów, własnych kalkulacji, kosztorysów lub innych zestawień, z wyjątkiem oczywistych błędów rachunkowych.`,
        `5. Inwestor jest uprawniony do odmowy podpisania protokołu odbioru końcowego jedynie w przypadku, gdy Przedmiot Umowy posiada wady istotne, uniemożliwiające wykorzystanie Przedmiotu Umowy zgodnie z przeznaczeniem. W takim wypadku Wykonawca jest zobowiązany do usunięcia wad istotnych i ponownego zgłoszenia gotowości do odbioru końcowego.`,
        ``,
        `§ 5 Wynagrodzenie`,
        `1. Za wykonanie Przedmiotu Umowy Inwestor zapłaci na rzecz Wykonawcy wynagrodzenie kosztorysowe. Na podstawie udostępnionych Wykonawcy informacji dotyczących powierzchni budynku, na której ma zostać wykonana elewacja, oraz zakresu innych zleconych robót budowlanych, Strony przewidują, że wysokość wynagrodzenia kosztorysowego będzie wynosiła w granicach ${fb(c.valueNet, "……… zł")} netto, tj. ${fb(c.valueGross, "……… zł")} brutto.`,
        `2. Ostateczna wysokość wynagrodzenia zostanie ustalona na podstawie wykazu i zakresu faktycznie zrealizowanych robót, opracowanego na podstawie obmiarów powykonawczych wykonanych przez Wykonawcę. Przyjmuje się, że obmiar powierzchni elewacji dokonywany jest na podstawie powierzchni ścian zewnętrznych budynku liczonych w obrysie zewnętrznym, z wliczeniem powierzchni otworów okiennych, drzwiowych i bramowych, chyba że Strony wyraźnie postanowią inaczej w Przedmiocie Umowy lub wprost w treści niniejszej Umowy. Elementy, odcinki i fragmenty robót o ograniczonym dostępie, niewielkiej szerokości, nieregularnym kształcie lub wymagające zwiększonego nakładu pracy, w szczególności pasy, gzymsy, attyki, uskoki, podciągi, belki, cokoły, obróbki oraz inne powierzchnie, których rozliczenie w metrach kwadratowych byłoby nieadekwatne do faktycznej pracochłonności, będą rozliczane w metrach bieżących. Do wyliczenia wynagrodzenia końcowego zastosowanie znajdą następujące stawki wynagrodzenia:`,
        letterList(c.rateLines, 6),
        `3. Inwestor zobowiązuje się do zapłaty na rzecz Wykonawcy bezzwrotnych zaliczek podlegających zaliczeniu na poczet wynagrodzenia końcowego:`,
        `a) w dniu dostarczenia początkowych materiałów na budowę — 30% przewidywanego wynagrodzenia, o którym mowa w § 5 ust. 1 Umowy, tj. w kwocie ${a1};`,
        `b) w terminie 3 dni od dnia poinformowania Inwestora przez Wykonawcę o wykonaniu 40% Przedmiotu Umowy — w wysokości 30% przewidywanego wynagrodzenia, o którym mowa w § 5 ust. 1 Umowy, tj. w kwocie ${a2};`,
        `c) w terminie 3 dni od dnia poinformowania Inwestora przez Wykonawcę o wykonaniu 80% Przedmiotu Umowy — w wysokości 30% przewidywanego wynagrodzenia, o którym mowa w § 5 ust. 1 Umowy, tj. w kwocie ${a3}.`,
        `4. W przypadku braku uiszczenia zaliczki, o której mowa w § 5 ust. 3, Wykonawca jest uprawniony do wstrzymania dalszych prac budowlanych, w tym również nie jest zobowiązany do zamówienia materiałów budowlanych niezbędnych do kontynuowania prac budowlanych. Wykonawca nie ponosi odpowiedzialności za opóźnienie tym wywołane, a czas realizacji Przedmiotu Umowy ulega wydłużeniu o czas wstrzymania prac budowlanych z tego powodu.`,
        `5. W terminie 3 dni od odbioru końcowego Wykonawca dokona obmiarów powykonawczych robót i przedstawi Inwestorowi kosztorys powykonawczy sporządzony na podstawie cen jednostkowych wskazanych w § 5 ust. 2 Umowy, wraz z fakturą końcową, stanowiącą podstawę do zapłaty wynagrodzenia, pomniejszonego o wysokość uiszczonych przez Inwestora zaliczek na poczet wynagrodzenia Wykonawcy. Wynagrodzenie będzie płatne w terminie 3 dni od doręczenia faktury VAT Inwestorowi.`,
        `6. Zaliczki i wynagrodzenie będą płatne przelewem na rachunek bankowy Wykonawcy numer ${fb(c.bankAccount, LONG_DOTS)}.`,
        `7. Wszelkie materiały budowlane dostarczone przez Wykonawcę w celu wykonania Przedmiotu Umowy pozostają własnością Wykonawcy do czasu uiszczenia przez Inwestora całości wynagrodzenia określonego w niniejszym paragrafie. W przypadku opóźnienia w zapłacie wynagrodzenia przez Inwestora, Wykonawca ma prawo żądać zwrotu niewykorzystanych materiałów oraz materiałów, które nie zostały w sposób trwały połączone z nieruchomością.`,
        `8. W przypadku wzrostu rynkowych cen materiałów budowlanych, kosztów ich zakupu, transportu lub dostawy, niezbędnych do realizacji Przedmiotu Umowy, o więcej niż 5% względem cen przyjętych przez Wykonawcę na dzień sporządzenia oferty i zawarcia Umowy, Wykonawca ma prawo do odpowiedniego podwyższenia wynagrodzenia w części materiałowej, w zakresie odpowiadającym rzeczywistemu wzrostowi kosztów. Podstawą ustalenia zmiany wynagrodzenia mogą być w szczególności oferty dostawców, faktury, cenniki producentów, hurtowni lub inne dokumenty potwierdzające wzrost cen. Do czasu zaakceptowania przez Inwestora zwaloryzowanej wartości wynagrodzenia lub pokrycia różnicy wynikającej ze wzrostu kosztów Wykonawca ma prawo wstrzymać zamówienie materiałów lub dalszą realizację robót, bez ponoszenia odpowiedzialności za wynikające z tego opóźnienie.`,
        ``,
        `§ 6 Prace dodatkowe i zasady ich rozliczeń`,
        `1. W przypadku, gdy w trakcie realizacji Umowy okaże się konieczne wykonanie prac wykraczających poza zakres określony w § 1 Umowy (dalej „Prace dodatkowe”), Strony zobowiązują się do zawarcia aneksu określającego szczegółowy zakres, termin wykonania oraz wynagrodzenie za te prace.`,
        `2. Wynagrodzenie za prace dodatkowe ustalane będzie na podstawie odrębnej kalkulacji, sporządzonej przez Wykonawcę i zaakceptowanej przez Inwestora.`,
        `3. Inwestor przyjmuje do wiadomości, że realizacja prac dodatkowych może wiązać się z wydłużeniem terminu zakończenia prac oraz zwiększeniem kosztów realizacji Umowy.`,
        `4. W przypadku braku zgody Inwestora na wykonanie prac dodatkowych Wykonawca zastrzega sobie prawo do wstrzymania realizacji dalszych prac w zakresie, w jakim ich wykonanie uzależnione jest od uprzedniego przeprowadzenia prac dodatkowych.`,
        `5. Wykonawca nie ponosi odpowiedzialności za opóźnienia w realizacji Umowy lub dodatkowe koszty wynikające z braku zgody Inwestora na wykonanie niezbędnych prac dodatkowych, których potrzeba wykonania nie była znana w chwili zawierania Umowy.`,
        ``,
        `§ 7 Rękojmia i procedura reklamacyjna`,
        `1. Wykonawca ponosi odpowiedzialność z tytułu rękojmi za wady wykonanych robót budowlanych na zasadach i warunkach określonych w przepisach Kodeksu cywilnego.`,
        `2. Inwestor ma prawo zgłosić reklamację dotyczącą wad lub usterek stwierdzonych w przedmiocie Umowy w okresie rękojmi.`,
        `3. Reklamacja może być zgłoszona w dowolnej formie umożliwiającej Wykonawcy zapoznanie się z jej treścią (pisemnie, mailowo, telefonicznie lub osobiście).`,
        `4. Reklamacja powinna w miarę możliwości zawierać:`,
        `a) opis wady lub usterki,`,
        `b) datę jej stwierdzenia,`,
        `c) żądanie Inwestora dotyczące sposobu usunięcia wady (naprawa, wymiana, obniżenie ceny, jeśli wada jest istotna).`,
        `5. Wykonawca zobowiązuje się do rozpatrzenia reklamacji i udzielenia odpowiedzi w terminie 14 dni kalendarzowych od dnia otrzymania zgłoszenia.`,
        `6. Wniesienie reklamacji nie wstrzymuje obowiązku terminowej płatności zaliczek i wynagrodzenia stosownie do postanowień § 5 Umowy.`,
        ``,
        `§ 8 Przestój z winy Inwestora`,
        `1. W przypadku przestoju w realizacji prac spowodowanego z przyczyn leżących po stronie Inwestora Wykonawca ma prawo do:`,
        `a) przedłużenia terminu realizacji Umowy o okres odpowiadający czasowi przestoju,`,
        `b) żądania od Inwestora odszkodowania pokrywającego rzeczywiste koszty poniesione przez Wykonawcę w związku z przestojem, w szczególności koszty pracy, sprzętu oraz materiałów, które nie mogły być wykorzystane zgodnie z harmonogramem.`,
        `2. Wykonawca zobowiązany jest do niezwłocznego pisemnego poinformowania Inwestora o zaistnieniu przestoju i jego przyczynach, pod rygorem utraty roszczeń z tym związanych.`,
        `3. Wysokość należnego odszkodowania zostanie ustalona w drodze odrębnego porozumienia między Stronami lub na podstawie udokumentowanych kosztów poniesionych przez Wykonawcę.`,
        ``,
        `§ 9 Zachowanie poufności`,
        `1. Wszelkie informacje uzyskane przez Strony w związku z wykonywaniem Umowy, które nie są dostępne publicznie w okresie obowiązywania Umowy, będą traktowane jako poufne.`,
        `2. Strony zobowiązują się zapewnić, by one same oraz członkowie ich rodzin zachowali w tajemnicy wszystko, o czym dowiedzieli się w związku z zawarciem i wykonywaniem Umowy, także po ustaniu stosunku umownego pomiędzy Stronami, w tym treść Umowy, uzyskane wyceny, projekty oraz informacje o stosowanej technologii.`,
        `3. Zobowiązanie do zachowania poufności wiąże również Inwestora w stosunku do pracowników i podwykonawców Wykonawcy.`,
        `4. Strony zobowiązują się do zabezpieczenia przed nieuprawnionym dostępem osób trzecich wszelkich danych czy informacji otrzymanych od drugiej Strony w związku z wykonywaniem Umowy. Zobowiązanie to obejmuje także odpowiednie zabezpieczenie danych czy informacji przy ich przekazywaniu za pomocą środków porozumiewania się na odległość.`,
        `5. Z chwilą rozwiązania Umowy każda ze Stron, która otrzymała informacje poufne od drugiej Strony, zobowiązuje się zwrócić takie informacje, po uprzednim zniszczeniu ich kopii, oraz usunąć te informacje z wszelkich nośników danych utrwalonych materialnie, a także w tzw. chmurze (forma elektroniczna).`,
        `6. Jeżeli którakolwiek ze Stron, jej pracownicy lub współpracownicy zostaną zobowiązani do ujawnienia informacji poufnych odpowiednim władzom publicznym, to Strona ta poinformuje drugą Stronę (o ile będzie to dozwolone i wykonalne) o ewentualnym żądaniu lub obowiązku ujawnienia.`,
        `7. Zobowiązanie do zachowania poufności wiąże Strony przez 10 lat od dnia zawarcia Umowy.`,
        `8. Nie stanowi naruszenia poufności udostępnienie informacji poufnych doradcom prawnym lub księgowym Stron.`,
        `9. Strona, która naruszyła obowiązek zachowania poufności, będzie zobowiązana do zapłaty drugiej Stronie kary umownej w wysokości 10% ceny szacunkowej wskazanej w § 5 ust. 1 Umowy, w terminie 7 dni od dnia doręczenia jej wezwania do zapłaty kary umownej.`,
        ``,
        `§ 10 Osoby odpowiedzialne za wykonywanie Umowy`,
        `1. Strony ustalają, że osobą odpowiedzialną za realizację Umowy ze strony Inwestora będzie ${fb(c.clientName)}, e-mail: ${fb(c.clientEmail)}, tel. ${fb(c.clientPhone)}.`,
        `2. Strony ustalają, że osobą odpowiedzialną za realizację Umowy ze strony Wykonawcy będzie ${fb(c.sellerContactPerson)}, e-mail: ${fb(c.sellerEmail)}, tel. ${fb(c.sellerPhone)}.`,
        `3. Ewentualna zmiana lub dodanie przedstawiciela Inwestora lub przedstawiciela Wykonawcy wymaga poinformowania drugiej Strony w formie pisemnej lub e-mailowej.`,
        `4. Zmiana osoby odpowiedzialnej za realizację Umowy nie ma wpływu na dokonane wcześniej przez poprzednią osobę akceptacje w toku realizacji Przedmiotu Umowy.`,
        `5. Strony ustalają, że wszelkie zgłoszenia, powiadomienia, oświadczenia oraz korespondencja będą dokonywane na piśmie na adresy podane w komparycji Umowy lub pocztą elektroniczną na adresy poczty elektronicznej podane w ust. 1 i 2 powyżej, chyba że Umowa lub przepisy prawa przewidują inną szczególną formę dla dokonania czynności związanej z wykonywaniem Umowy.`,
        ``,
        `§ 11 Postanowienia końcowe`,
        `1. Inwestor oświadcza, że został poinformowany o prawie odstąpienia od umowy w terminie 14 dni zgodnie z ustawą z dnia 30 maja 2014 r. o prawach konsumenta oraz o skutkach jego utraty, i jednocześnie wyraża zgodę na rozpoczęcie świadczenia usług budowlanych niezwłocznie po podpisaniu niniejszej Umowy, tj. przed upływem ww. terminu. Inwestor przyjmuje do wiadomości, że z chwilą podpisania niniejszej Umowy traci prawo odstąpienia od niej, stosownie do art. 38 pkt 1 ustawy o prawach konsumenta.`,
        `2. Wszelkie zmiany lub uzupełnienia Umowy wymagają formy pisemnej pod rygorem nieważności.`,
        `3. Wykonawca i Inwestor oświadczają, że dołożą starań, aby ewentualne spory, jakie mogą powstać przy realizacji niniejszej Umowy, były rozwiązywane polubownie. W przypadku braku możliwości dokonania uzgodnień polubownych spory mogące wynikać ze stosunku prawnego objętego niniejszą Umową Strony poddają pod rozstrzygnięcie sądu miejscowo i rzeczowo właściwego zgodnie z przepisami Kodeksu postępowania cywilnego.`,
        `4. Umowa została sporządzona w dwóch jednobrzmiących egzemplarzach, po jednym egzemplarzu dla każdej ze Stron.`,
        `5. Wykonawca oświadcza, że posiada ubezpieczenie zawodowe.`
      ].join("\n");
    }
  },
  {
    id: "umowa-przedwstepna",
    label: "Umowa przedwstępna (wzór GolBud, z pełnomocnikiem)",
    category: "umowa",
    title: "UMOWA PRZEDWSTĘPNA",
    parties: "none",
    signatures: ["INWESTOR", "WYKONAWCA"],
    usesVariant: true,
    requires: ["clientName", "siteAddress", "value", "rates", "sellerKrs", "sellerRegon"],
    buildBody: (c) =>
      [
        `# UMOWA PRZEDWSTĘPNA`,
        `<> zawarta w ${fb(c.place)} w dniu ${c.todayPl} r. (dalej: „Umowa”) pomiędzy:`,
        ``,
        c.clientParty,
        `zwaną w dalszej części Umowy: **„Inwestorem”**,`,
        `**a**`,
        `${c.sellerKomparycjaWithProxy},`,
        `zwaną w dalszej części Umowy: **„Wykonawcą”**,`,
        `dalej łącznie zwani **„Stronami”**.`,
        ``,
        `§ 1 Przedmiot umowy`,
        `1. Strony zobowiązują się zawrzeć umowę przyrzeczoną o roboty budowlane, której przedmiotem będzie wykonanie przez Wykonawcę robót budowlanych polegających na wykonaniu elewacji oraz innych robót budowlanych szczegółowo opisanych w ust. 2 poniżej w budynku położonym pod adresem: ${fb(c.siteAddress, LONG_DOTS)} (dalej: „Przedmiot Umowy”).`,
        `2. W zakres robót budowlanych stanowiących Przedmiot Umowy wchodzą następujące prace:`,
        letterList(c.scopeItems, 7),
        `3. Umowa przyrzeczona zostanie zawarta do dnia ${DOTS}.`,
        ``,
        `§ 2 Podstawowe warunki umowy przyrzeczonej`,
        `1. Za wykonanie Przedmiotu Umowy Inwestor zapłaci na rzecz Wykonawcy wynagrodzenie kosztorysowe. Na podstawie udostępnionych Wykonawcy informacji dotyczących powierzchni budynku, na której ma zostać wykonana elewacja, oraz zakresu innych zleconych robót budowlanych, Strony przewidują, że wysokość wynagrodzenia kosztorysowego będzie wynosiła w granicach ${fb(c.valueNet, "……… zł")} netto, tj. ${fb(c.valueGross, "……… zł")} brutto.`,
        `2. Ostateczna wysokość wynagrodzenia zostanie ustalona na podstawie wykazu i zakresu faktycznie zrealizowanych robót, opracowanego na podstawie wykonanych przez Wykonawcę obmiarów powykonawczych robót. Do wyliczenia wynagrodzenia końcowego zastosowanie znajdą następujące stawki wynagrodzenia:`,
        letterList(c.rateLines, 7),
        `3. Termin realizacji robót wyniesie ${DOTS} od daty zawarcia umowy przyrzeczonej.`,
        ``,
        `§ 3 Kary umowne`,
        `1. W przypadku, gdy do niezawarcia umowy przyrzeczonej dojdzie z przyczyn leżących po jednej stronie, Strona, z winy której nie doszło do zawarcia umowy przyrzeczonej, zobowiązana będzie do zapłaty kary umownej na rzecz drugiej Strony w wysokości 10% wynagrodzenia szacunkowego wskazanego w § 2 ust. 1 Umowy.`,
        `2. W przypadku, gdy do niezawarcia umowy przyrzeczonej dojdzie z przyczyn leżących po obu stronach lub niezależnych od którejkolwiek ze stron, żadna ze stron nie będzie zobowiązana do zapłaty kary umownej.`,
        `3. Zapłata kary umownej nie wyłącza prawa dochodzenia odszkodowania na zasadach ogólnych, jeżeli poniesiona szkoda przewyższa wysokość kary umownej.`,
        ``,
        `§ 4 Postanowienia końcowe`,
        `1. W sprawach nieuregulowanych niniejszą Umową zastosowanie mają przepisy Kodeksu cywilnego.`,
        `2. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.`,
        `3. Inwestor zapoznał się ze stosowanym przez Wykonawcę wzorcem umowy o roboty budowlane i nie zgłasza do niego uwag.`
      ].join("\n")
  },
  {
    id: "zamowienie",
    label: "Zamówienie / skrócona umowa — małe zlecenia (wzór GolBud)",
    category: "umowa",
    title: "ZAMÓWIENIE — SKRÓCONA UMOWA O ROBOTY BUDOWLANE",
    parties: "none",
    signatures: [],
    footer: "Zamówienie / skrócona umowa — dokument do małych zleceń",
    usesVariant: true,
    requires: ["clientName", "clientAddress", "siteAddress", "startDate", "endDate", "value", "bankAccount", "sellerKrs", "sellerRegon"],
    buildBody: (c) =>
      [
        `# ZAMÓWIENIE NR ${fb(c.contractNumber, "………")} / SKRÓCONA UMOWA O ROBOTY BUDOWLANE`,
        `<> zawarte w ${fb(c.place)} w dniu ${fb(c.contractDate, c.todayPl)} r. pomiędzy:`,
        ``,
        `**Inwestorem:** ${fb(c.clientName, LONG_DOTS)}`,
        `Adres: ${fb(c.clientAddress, LONG_DOTS)}`,
        `PESEL / NIP: ${fb(c.clientTaxId)}    tel.: ${fb(c.clientPhone)}`,
        `e-mail: ${fb(c.clientEmail)}`,
        ``,
        `a`,
        `${c.sellerKomparycja}, zwaną dalej „Wykonawcą”.`,
        ``,
        `§ 1 Przedmiot zamówienia`,
        `1. Inwestor zleca, a Wykonawca przyjmuje do wykonania roboty budowlane w budynku / lokalu położonym pod adresem: ${fb(c.siteAddress, LONG_DOTS)}.`,
        `2. Zakres prac objęty zamówieniem:`,
        c.scopeItems.length ? c.scopeItems.map((t, i) => `  ${i + 1}) ${t}`).join("\n") : [1, 2, 3, 4, 5].map((n) => `  ${n}) ${LONG_DOTS}`).join("\n"),
        `3. Materiały po stronie:`,
        `  [ ] Wykonawcy`,
        `  [ ] Inwestora`,
        `  [ ] częściowo według ustaleń: ${LONG_DOTS}`,
        `4. Poza zakresem zamówienia pozostają roboty niewskazane powyżej, w szczególności prace dodatkowe ujawnione dopiero po rozpoczęciu robót, prace naprawcze podłoża, przeróbki instalacji, roboty demontażowe oraz inne elementy nieujęte wprost w niniejszym dokumencie, chyba że Strony uzgodnią inaczej na piśmie, mailowo lub SMS.`,
        ``,
        `§ 2 Termin realizacji`,
        `1. Planowany termin rozpoczęcia prac: ${fb(c.startDate)}.`,
        `2. Planowany termin zakończenia prac: ${fb(c.endDate)}.`,
        `3. Termin realizacji może ulec odpowiedniemu przesunięciu w przypadku niekorzystnych warunków pogodowych, braku dostępu do frontu robót, braku mediów, opóźnienia w płatności, opóźnienia w dostawie materiałów, konieczności wykonania prac dodatkowych albo innych przeszkód niezależnych od Wykonawcy.`,
        ``,
        `§ 3 Wynagrodzenie i płatność`,
        c.valueNet
          ? `1. Strony ustalają wynagrodzenie za wykonanie zakresu podstawowego w wysokości ${c.valueNet} netto plus VAT według właściwej stawki (${c.vatRate} %), tj. ${c.valueGross} brutto.`
          : `1. Strony ustalają wynagrodzenie za wykonanie zakresu podstawowego w wysokości: ${LONG_DOTS} brutto / netto plus VAT według właściwej stawki — niepotrzebne skreślić.`,
        `2. Wynagrodzenie obejmuje wyłącznie zakres wskazany w § 1. Jeżeli w toku robót okaże się konieczne wykonanie dodatkowych czynności, zostaną one rozliczone oddzielnie po wcześniejszej akceptacji Inwestora.`,
        `3. Warunki płatności:`,
        `a) zaliczka przy podpisaniu zamówienia / przed rozpoczęciem prac: ${DOTS} zł,`,
        `b) płatność końcowa po zakończeniu prac i zgłoszeniu gotowości do odbioru: ${DOTS} zł,`,
        `c) termin płatności faktury / rachunku / rozliczenia końcowego: 3 dni od dnia doręczenia dokumentu rozliczeniowego, chyba że Strony ustalą inaczej.`,
        `4. Płatność nastąpi przelewem na rachunek bankowy Wykonawcy: ${fb(c.bankAccount, LONG_DOTS)}.`,
        `5. Brak zapłaty zaliczki lub wymagalnej części wynagrodzenia uprawnia Wykonawcę do wstrzymania prac i zamówień materiałowych bez odpowiedzialności za powstałe z tego tytułu przesunięcie terminu.`,
        `6. Materiały dostarczone przez Wykonawcę pozostają własnością Wykonawcy do czasu zapłaty całości wynagrodzenia, o ile nie zostały trwale połączone z nieruchomością.`,
        ``,
        `§ 4 Obowiązki Inwestora`,
        `1. Inwestor zapewnia dostęp do miejsca prowadzenia prac, możliwość składowania materiałów oraz niezakłócony front robót.`,
        `2. Inwestor zapewnia energię elektryczną i wodę niezbędną do realizacji robót oraz ponosi koszty ich zużycia, chyba że Strony ustalą inaczej.`,
        `3. Inwestor odpowiada za stan techniczny budynku, podłoży, instalacji oraz za przekazanie Wykonawcy informacji mogących mieć wpływ na realizację robót.`,
        `4. Kontener na odpady budowlane oraz wywóz odpadów zapewnia:`,
        `  [ ] Inwestor`,
        `  [ ] Wykonawca`,
        `  [ ] według osobnego rozliczenia`,
        `5. Inwestor zobowiązuje się do terminowego odbioru prac i zapłaty wynagrodzenia.`,
        ``,
        `§ 5 Obowiązki Wykonawcy`,
        `1. Wykonawca zobowiązuje się wykonać prace z należytą starannością, zgodnie ze sztuką budowlaną, zasadami BHP i ustalonym zakresem.`,
        `2. Wykonawca wykorzystuje własne narzędzia i sprzęt niezbędny do realizacji robót, o ile zakres zlecenia tego wymaga.`,
        `3. Wykonawca uporządkuje miejsce prowadzenia robót po zakończeniu prac w zakresie wynikającym z realizowanego zlecenia.`,
        `4. Wykonawca nie odpowiada za wady wynikające z błędów projektowych, wadliwych materiałów dostarczonych przez Inwestora, ukrytych wad podłoża, ingerencji osób trzecich, braku konserwacji albo użytkowania niezgodnego z przeznaczeniem.`,
        ``,
        `§ 6 Odbiór prac`,
        `1. Po zakończeniu prac Wykonawca zgłasza Inwestorowi gotowość do odbioru ustnie, SMS, mailowo lub pisemnie.`,
        `2. Odbiór może zostać potwierdzony protokołem, wiadomością SMS, wiadomością e-mail albo podpisem pod niniejszym dokumentem w części „Potwierdzenie wykonania”.`,
        `3. Inwestor może odmówić odbioru wyłącznie w przypadku wad istotnych uniemożliwiających normalne korzystanie z wykonanego zakresu. Drobne usterki nie wstrzymują odbioru ani obowiązku zapłaty, a Wykonawca usuwa je w uzgodnionym terminie.`,
        `4. Nieprzystąpienie przez Inwestora do odbioru w terminie 3 dni od zgłoszenia gotowości do odbioru uprawnia Wykonawcę do jednostronnego potwierdzenia zakończenia prac.`,
        ``,
        `§ 7 Prace dodatkowe`,
        `1. Prace dodatkowe, zamienne lub rozszerzenie zakresu podstawowego wymagają odrębnej akceptacji Inwestora. Dopuszczalna jest akceptacja pisemna, mailowa, SMS albo inna forma dokumentowa pozwalająca potwierdzić zakres i zgodę na rozliczenie.`,
        `2. Prace dodatkowe rozliczane są według osobnej kalkulacji, stawki godzinowej, stawki jednostkowej albo uzgodnionej kwoty ryczałtowej.`,
        `3. Konieczność wykonania prac dodatkowych może przesunąć termin zakończenia zamówienia.`,
        ``,
        `§ 8 Rękojmia i reklamacje`,
        `1. Wykonawca ponosi odpowiedzialność z tytułu rękojmi za wady wykonanych robót na zasadach wynikających z przepisów Kodeksu cywilnego.`,
        `2. Reklamacja powinna zawierać opis wady, datę jej stwierdzenia oraz dokumentację zdjęciową, jeżeli jest możliwa do wykonania.`,
        `3. Wykonawca udzieli odpowiedzi na reklamację w terminie 14 dni od dnia jej otrzymania.`,
        `4. Zgłoszenie reklamacji nie wstrzymuje obowiązku zapłaty wynagrodzenia za zakres wykonany i odebrany, jeżeli wada nie ma charakteru istotnego.`,
        ``,
        `§ 9 Dokumentacja zdjęciowa i realizacje`,
        `1. Inwestor wyraża zgodę na wykonywanie przez Wykonawcę zdjęć i filmów z realizacji oraz po jej zakończeniu, z możliwością wykorzystania ich w portfolio, na stronie internetowej i w mediach społecznościowych Wykonawcy, bez ujawniania danych osobowych Inwestora, chyba że Strony ustalą inaczej.`,
        ``,
        `§ 10 Klauzula konsumencka`,
        `1. Jeżeli niniejsze zamówienie zawierane jest z konsumentem poza lokalem przedsiębiorstwa albo na odległość, Inwestor potwierdza otrzymanie informacji o prawie odstąpienia od umowy w terminie 14 dni, o ile prawo to przysługuje zgodnie z ustawą o prawach konsumenta.`,
        `2. Jeżeli Inwestor żąda rozpoczęcia prac przed upływem 14 dni od zawarcia zamówienia, składa poniżej wyraźne żądanie rozpoczęcia robót przed upływem tego terminu i przyjmuje do wiadomości, że w przypadku odstąpienia od umowy może być zobowiązany do zapłaty za świadczenia spełnione do chwili odstąpienia, zgodnie z przepisami prawa.`,
        `Żądanie rozpoczęcia prac przed upływem 14 dni:`,
        `  [ ] TAK`,
        `  [ ] NIE`,
        `[podpisy: | Podpis Inwestora]`,
        ``,
        `§ 11 Postanowienia końcowe`,
        `1. W sprawach nieuregulowanych niniejszym dokumentem zastosowanie mają przepisy Kodeksu cywilnego oraz właściwe przepisy prawa powszechnie obowiązującego.`,
        `2. Zmiany zakresu, ceny lub terminu mogą być dokonywane pisemnie, mailowo, SMS albo w innej formie dokumentowej, jeżeli pozwala ona ustalić treść uzgodnienia.`,
        `3. Dokument sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze Stron.`,
        `[podpisy: INWESTOR (data i podpis) | WYKONAWCA (data i podpis)]`,
        ``,
        `## POTWIERDZENIE WYKONANIA / ODBIORU`,
        `Inwestor potwierdza wykonanie prac objętych niniejszym zamówieniem. Uwagi / usterki do usunięcia:`,
        LONG_DOTS,
        LONG_DOTS,
        LONG_DOTS,
        `Data odbioru: ${DOTS}`,
        `[podpisy: Podpis Inwestora | Podpis Wykonawcy]`
      ].join("\n")
  },
  {
    id: "umowa-firma",
    label: "Umowa o roboty budowlane — firma / przedsiębiorca (wzór ogólny)",
    category: "umowa",
    title: "UMOWA O ROBOTY BUDOWLANE",
    parties: "boxes",
    signatures: ["Zamawiający", "Wykonawca"],
    requires: ["clientName", "siteAddress", "value"],
    buildBody: (c) =>
      [
        `§ 1 Przedmiot umowy`,
        `Wykonawca zobowiązuje się do wykonania robót budowlanych w zakresie: ${fb(c.scope)}, w lokalizacji: ${fb(c.siteAddress)}, zgodnie z kosztorysem/ofertą stanowiącą załącznik do umowy.`,
        ``,
        `§ 2 Wynagrodzenie i faktury`,
        `Wynagrodzenie ryczałtowe/kosztorysowe wynosi ${fb(c.valueDescription, "……… zł netto, tj. ……… zł brutto")}. Rozliczenie następuje na podstawie faktur VAT, płatnych przelewem w terminie ……… dni od daty wystawienia${c.bankAccount ? ` na rachunek ${c.bankAccount}` : ""}.`,
        ``,
        `§ 3 Termin realizacji`,
        `Rozpoczęcie: ${fb(c.startDate, "do uzgodnienia")}; zakończenie: ${fb(c.endDate, "do uzgodnienia")}. Zmiana terminu wymaga formy pisemnej (aneks).`,
        ``,
        `§ 4 Obowiązki Stron`,
        `Zamawiający zapewnia dostęp do terenu budowy, przyłącza oraz niezbędne uzgodnienia. Wykonawca wykonuje roboty zgodnie ze sztuką budowlaną, normami i przepisami BHP.`,
        ``,
        `§ 5 Kary umowne`,
        `Strony mogą zastrzec kary umowne za zwłokę w wykonaniu lub usunięciu wad — w wysokości ……… % wynagrodzenia za każdy dzień zwłoki.`,
        ``,
        `§ 6 Gwarancja`,
        `Wykonawca udziela gwarancji na okres ……… miesięcy od daty odbioru końcowego.`,
        ``,
        `§ 7 Postanowienia końcowe`,
        `W sprawach nieuregulowanych stosuje się Kodeks cywilny. Umowę sporządzono w dwóch egzemplarzach.`
      ].join("\n")
  },
  {
    id: "umowa-podwykonawcza",
    label: "Umowa podwykonawcza (wzór ogólny)",
    category: "umowa",
    title: "UMOWA PODWYKONAWCZA",
    parties: "boxes",
    signatures: ["Podwykonawca", "Wykonawca (Generalny)"],
    requires: ["siteAddress"],
    buildBody: (c) =>
      [
        `§ 1 Przedmiot umowy`,
        `Podwykonawca zobowiązuje się do wykonania na rzecz Wykonawcy następujących robót: ${fb(c.scope)}, w ramach inwestycji realizowanej w: ${fb(c.siteAddress)}.`,
        ``,
        `§ 2 Wynagrodzenie`,
        `Za wykonanie zakresu Podwykonawcy przysługuje wynagrodzenie w wysokości ……… zł netto, płatne na podstawie faktury po odbiorze robót.`,
        ``,
        `§ 3 Termin`,
        `Rozpoczęcie: ………; zakończenie: ………. Podwykonawca zobowiązuje się do realizacji w terminach zgodnych z harmonogramem inwestycji.`,
        ``,
        `§ 4 Odpowiedzialność`,
        `Podwykonawca odpowiada za jakość i terminowość powierzonych robót oraz przestrzeganie przepisów BHP na terenie budowy.`,
        ``,
        `§ 5 Gwarancja`,
        `Podwykonawca udziela gwarancji na wykonane roboty na okres ……… miesięcy.`,
        ``,
        `§ 6 Postanowienia końcowe`,
        `W sprawach nieuregulowanych stosuje się Kodeks cywilny. Umowę sporządzono w dwóch egzemplarzach.`
      ].join("\n")
  },

  // ── ANEKSY ──────────────────────────────────────────────────────────────────
  {
    id: "aneks-roboty-dodatkowe",
    label: "Aneks — roboty dodatkowe (wzór GolBud)",
    category: "aneks",
    title: "ANEKS — ROBOTY DODATKOWE",
    parties: "none",
    signatures: ["INWESTOR", "WYKONAWCA"],
    requires: ["clientName", "contractNumber", "contractDate", "extras"],
    buildBody: (c) =>
      [
        annexHeader(c),
        `2. Intencją Stron jest dokonanie zmian do Umowy w oparciu o § 6 ust. 1 Umowy.`,
        ``,
        `§ 1 Wprowadzenie prac dodatkowych`,
        `1. Strony uzgadniają, że w związku z realizacją Umowy Wykonawca wykona następujące prace dodatkowe (dalej „Prace Dodatkowe”):`,
        letterList(c.extrasLines, 3),
        `2. Wynagrodzenie za Prace Dodatkowe ustala się na łączną kwotę ${fb(c.extrasNet, "……… zł")} netto (słownie: ${fb(c.extrasNetWords, LONG_DOTS)}), powiększoną o podatek VAT według obowiązującej stawki, tj. ${fb(c.extrasGross, "……… zł")} brutto.`,
        `3. Wynagrodzenie za wykonanie Prac Dodatkowych będzie rozliczane sukcesywnie, proporcjonalnie do stopnia ich wykonania, zgodnie z procentowym harmonogramem płatności określonym w § 5 ust. 3 Umowy. Wartość wykonanych Prac Dodatkowych będzie każdorazowo doliczana do podstawy rozliczenia danego etapu i płatna wraz z wynagrodzeniem należnym za ten etap. Rozliczenie Prac Dodatkowych nie będzie odraczane do odbioru końcowego Przedmiotu Umowy.`,
        ``,
        `§ 2 Zmiana terminu realizacji Umowy`,
        `1. W związku z wprowadzeniem Prac Dodatkowych Strony ustalają, że termin realizacji Umowy, o którym mowa w § 4 ust. 1 Umowy, zostaje przedłużony do dnia ${DOTS}.`,
        `2. Strony oświadczają, że zmiana terminu realizacji jest uzasadniona charakterem i zakresem Prac Dodatkowych.`,
        ANNEX_FINAL(3)
      ].join("\n")
  },
  {
    id: "aneks-termin",
    label: "Aneks — zmiana terminu (wzór GolBud)",
    category: "aneks",
    title: "ANEKS — ZMIANA TERMINU",
    parties: "none",
    signatures: ["INWESTOR", "WYKONAWCA"],
    requires: ["clientName", "contractNumber", "contractDate", "endDate"],
    buildBody: (c) =>
      [
        annexHeader(c),
        `2. Intencją Stron jest dokonanie zmian do Umowy opisanych w Aneksie.`,
        ``,
        `§ 1 Zmiana terminu realizacji Umowy`,
        `1. Strony zgodnie ustalają, że termin realizacji Umowy, o którym mowa w § 4 ust. 1 Umowy, zostaje przedłużony do dnia: ${fb(c.endDate)}.`,
        ANNEX_FINAL(2)
      ].join("\n")
  },
  {
    id: "aneks-zaplata",
    label: "Aneks — zobowiązanie do zapłaty (wzór GolBud)",
    category: "aneks",
    title: "ANEKS — ZOBOWIĄZANIE DO ZAPŁATY",
    parties: "none",
    signatures: ["INWESTOR", "WYKONAWCA"],
    requires: ["clientName", "contractDate", "debt"],
    buildBody: (c) =>
      [
        `# ANEKS DO UMOWY O ROBOTY BUDOWLANE`,
        `<> zawarty w ${fb(c.place)} w dniu ${c.todayPl} r. (dalej: „Aneks”) pomiędzy:`,
        ``,
        c.clientParty,
        `zwaną w dalszej części Aneksu: **„Inwestorem”**,`,
        `**a**`,
        `${c.sellerKomparycja},`,
        `zwaną w dalszej części Aneksu: **„Wykonawcą”**,`,
        `dalej łącznie zwani **„Stronami”**.`,
        ``,
        `<> **Preambuła**`,
        `1. W dniu ${fb(c.contractDate, "………")} Strony zawarły umowę o roboty budowlane${c.contractNumber ? ` nr ${c.contractNumber}` : ""} (dalej: „Umowa”).`,
        `2. Intencją Stron jest dokonanie zmian do Umowy opisanych w Aneksie.`,
        ``,
        `§ 1 Zobowiązanie zapłaty`,
        `1. Strony zgodnie ustalają, że Inwestor zobowiązuje się do zapłaty końcowej kwoty Umowy w wysokości ${fb(c.debtAmount, "……… zł")}${c.debtAmountWords ? ` (słownie: ${c.debtAmountWords})` : ""} do dnia ${DOTS}.`,
        ANNEX_FINAL(2)
      ].join("\n")
  },
  {
    id: "aneks-rozliczeniowy",
    label: "Aneks rozliczeniowo-metrażowy (wzór GolBud)",
    category: "aneks",
    title: "ANEKS ROZLICZENIOWO-METRAŻOWY",
    parties: "boxes",
    signatures: ["Zamawiający", "Wykonawca"],
    usesVariant: true,
    requires: ["clientName", "contractNumber", "contractDate", "rates"],
    buildBody: (c) =>
      [
        `# ANEKS NR ${DOTS}`,
        `<> **DO UMOWY O ROBOTY BUDOWLANE NR ${fb(c.contractNumber, "………")} Z DNIA ${fb(c.contractDate, "………")}**`,
        `<> zawarty w ${fb(c.place)} w dniu ${c.todayPl} r. (dalej: „Aneks”) pomiędzy Stronami wskazanymi powyżej.`,
        ``,
        `§ 1 Ustalenie faktycznego zakresu robót`,
        `Strony zgodnie potwierdzają, że w toku realizacji inwestycji dokonano szczegółowego obmiaru robót, w wyniku którego stwierdzono, iż **rzeczywisty zakres robót przekracza wartości orientacyjne określone pierwotnie w umowie**.`,
        `Na podstawie wykonanych pomiarów ustala się następujący **faktyczny zakres robót**:`,
        c.lineRows.length
          ? [`| Lp. | Rodzaj robót | J.m. | Ilość |`, `| --- | --- | --- | --- |`, ...c.lineRows.map((r) => `| ${r.lp} | ${r.label} | ${r.unit} | ${r.quantity} |`)].join("\n")
          : numberedLines([], 7),
        `Powyższe wartości stanowią podstawę do rozliczenia końcowego robót.`,
        ``,
        `§ 2 Zasady rozliczenia`,
        `Strony potwierdzają, że zgodnie z zapisami umowy podstawowej:`,
        `**rozliczenie inwestycji następuje powykonawczo, wyłącznie w oparciu o faktycznie wykonane ilości robót, zgodnie z obowiązującymi cenami jednostkowymi określonymi w umowie.**`,
        `Niniejszy aneks doprecyzowuje jedynie faktyczny zakres robót i nie zmienia stawek jednostkowych ustalonych w umowie.`,
        ``,
        `§ 3 Charakter dokumentu`,
        `Niniejszy aneks stanowi **pisemne potwierdzenie rzeczywistego zakresu robót wynikającego z obmiaru powykonawczego** i zastępuje dotychczasowe szacunki metrażowe użyte w umowie oraz załącznikach wyłącznie w zakresie ilości robót.`,
        `Zamawiający potwierdza, że **zapoznał się z obmiarem robót i akceptuje wskazany zakres jako podstawę do rozliczenia końcowego**, bez możliwości kwestionowania ilości robót po podpisaniu niniejszego aneksu.`,
        `Pozostałe postanowienia umowy pozostają bez zmian i zachowują pełną moc obowiązującą.`,
        ``,
        `§ 4 Postanowienia końcowe`,
        `Aneks sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze Stron.`
      ].join("\n")
  },

  // ── PROTOKOŁY ───────────────────────────────────────────────────────────────
  {
    id: "protokol-odbioru",
    label: "Protokół odbioru końcowego (wzór GolBud)",
    category: "protokół",
    title: "PROTOKÓŁ ODBIORU KOŃCOWEGO",
    parties: "none",
    signatures: ["INWESTOR", "WYKONAWCA"],
    requires: ["clientName", "contractNumber", "contractDate", "siteAddress"],
    buildBody: (c) =>
      [
        `# PROTOKÓŁ ODBIORU KOŃCOWEGO ROBÓT BUDOWLANYCH`,
        `Sporządzony dnia ${c.todayPl}`,
        `Miejsce: ${fb(c.siteAddress, LONG_DOTS)}`,
        ``,
        `pomiędzy:`,
        `Imię i nazwisko: ${fb(c.clientName, LONG_DOTS)}`,
        `Adres: ${fb(c.clientAddress, LONG_DOTS)}`,
        `Telefon/e-mail: ${fb([c.clientPhone, c.clientEmail].filter(Boolean).join(" / "), LONG_DOTS)}`,
        `zwanym dalej **Inwestorem**,`,
        ``,
        `a`,
        ``,
        sellerBlock(c),
        `zwaną dalej **Wykonawcą**.`,
        ``,
        `Roboty budowlane wykonane na podstawie umowy nr ${fb(c.contractNumber, "………")} z dnia ${fb(c.contractDate, "………")}`,
        `dotyczącej: ${fb(c.scope, LONG_DOTS)}`,
        ``,
        `Prace rozpoczęto dnia ${fb(c.startDate)} oraz zakończono ${DOTS}.`,
        ``,
        `Odbioru końcowego robót dokonano w obecności:`,
        `Inwestora: ${LONG_DOTS}`,
        `Wykonawcy: ${LONG_DOTS}`,
        ``,
        `Po dokonaniu oględzin oraz weryfikacji zakresu wykonanych robót stwierdza się, że:`,
        `1. Roboty zostały wykonane zgodnie z umową, dokumentacją projektową, zasadami wiedzy technicznej oraz obowiązującymi przepisami prawa.`,
        `2. Jakość wykonanych robót jest prawidłowa i nie budzi zastrzeżeń.`,
        `3. Roboty nadają się do użytkowania zgodnie z przeznaczeniem.`,
        `4. Strony uznają roboty za wykonane i dokonują odbioru końcowego przedmiotu umowy.`,
        `5. Z dniem podpisania niniejszego protokołu następuje przekazanie przedmiotu umowy do użytkowania.`,
        `6. Z dniem podpisania niniejszego protokołu rozpoczyna się bieg okresu gwarancji oraz rękojmi, zgodnie z postanowieniami umowy.`,
        `7. Niniejszy protokół stanowi podstawę do wystawienia przez Wykonawcę faktury końcowej.`,
        ``,
        `Uwagi i ewentualne usterki:`,
        LONG_DOTS,
        LONG_DOTS,
        LONG_DOTS,
        LONG_DOTS
      ].join("\n")
  },
  {
    id: "protokol-czesciowy",
    label: "Protokół odbioru częściowego (wzór GolBud)",
    category: "protokół",
    title: "PROTOKÓŁ ODBIORU CZĘŚCIOWEGO",
    parties: "none",
    signatures: [],
    footer: "Protokół odbioru częściowego robót budowlanych",
    usesVariant: true,
    requires: ["clientName", "contractNumber", "contractDate", "siteAddress", "rates"],
    buildBody: (c) => {
      const rows = c.lineRows.length
        ? c.lineRows.map((r) => `| ${r.lp} | ${r.label} | ${r.unit} | ${r.quantity} |  | ……… % |`)
        : [1, 2, 3, 4, 5, 6, 7].map((n) => `| ${n} |  |  |  |  | ……… % |`);
      return [
        `# PROTOKÓŁ ODBIORU CZĘŚCIOWEGO ROBÓT BUDOWLANYCH`,
        `<> **NR ${DOTS}**`,
        ``,
        `| **Data odbioru:** ${c.todayPl} | **Miejsce odbioru:** ${fb(c.siteAddress)} |`,
        `| **Umowa nr:** ${fb(c.contractNumber, "………")} | **Data zawarcia umowy:** ${fb(c.contractDate, "………")} |`,
        `| **Inwestycja / adres budowy:** ${fb(c.siteAddress)} | **Inwestor:** ${fb(c.clientName)} |`,
        ``,
        `## ZAKRES ROBÓT I STOPIEŃ ZAAWANSOWANIA`,
        `| Lp. | Rodzaj i zakres wykonanych prac | J.m. | Przedmiar / zakres umowny | Ilość wykonana | Zaawansowanie |`,
        `| --- | --- | --- | --- | --- | --- |`,
        ...rows,
        ``,
        `**ŁĄCZNY STOPIEŃ ZAAWANSOWANIA ROBÓT OBJĘTYCH UMOWĄ: ……… %**`,
        ``,
        `## WYNIK ODBIORU`,
        `[ ] Roboty odebrano bez zastrzeżeń.`,
        `[ ] Roboty odebrano z uwagami niewstrzymującymi dalszej realizacji prac.`,
        `[ ] Roboty nie zostały odebrane z przyczyn wskazanych poniżej.`,
        ``,
        `## UWAGI, USTERKI LUB ZAKRES DO UZUPEŁNIENIA`,
        LONG_DOTS,
        LONG_DOTS,
        LONG_DOTS,
        `**Termin usunięcia uwag / uzupełnienia zakresu:** ${DOTS}`,
        ``,
        `## USTALENIA KOŃCOWE`,
        `- Strony potwierdzają wykonanie wskazanego wyżej zakresu robót oraz określony w protokole stopień ich zaawansowania.`,
        `- Niniejszy protokół stanowi dokument potwierdzający faktyczne zaawansowanie robót na dzień jego sporządzenia.`,
        `[podpisy: INWESTOR / PRZEDSTAWICIEL INWESTORA (data i czytelny podpis) | WYKONAWCA / PRZEDSTAWICIEL WYKONAWCY (data i czytelny podpis)]`
      ].join("\n");
    }
  },
  {
    id: "protokol-przekazania",
    label: "Protokół przekazania terenu budowy (wzór GolBud)",
    category: "protokół",
    title: "PROTOKÓŁ PRZEKAZANIA TERENU BUDOWY",
    parties: "none",
    signatures: ["INWESTOR", "WYKONAWCA"],
    requires: ["clientName", "siteAddress"],
    buildBody: (c) =>
      [
        `# PROTOKÓŁ PRZEKAZANIA TERENU BUDOWY`,
        `Zawarty dnia ${c.todayPl}`,
        `Miejsce: ${fb(c.siteAddress, LONG_DOTS)}`,
        ``,
        `pomiędzy:`,
        `Imię i nazwisko: ${fb(c.clientName, LONG_DOTS)}`,
        `Adres: ${fb(c.clientAddress, LONG_DOTS)}`,
        `Telefon/e-mail: ${fb([c.clientPhone, c.clientEmail].filter(Boolean).join(" / "), LONG_DOTS)}`,
        `zwanym dalej **Inwestorem**, a`,
        ``,
        sellerBlock(c),
        `zwaną dalej **Wykonawcą**.`,
        ``,
        `Lokalizacja inwestycji: ${fb(c.siteAddress, LONG_DOTS)}`,
        `Zakres prac: ${fb(c.scope, LONG_DOTS)}`,
        ``,
        `Stan terenu w chwili przekazania: ${LONG_DOTS}`,
        LONG_DOTS,
        `Dokumentacja przekazana Wykonawcy: ${LONG_DOTS}`,
        LONG_DOTS
      ].join("\n")
  },

  // ── WEZWANIA DO ZAPŁATY ─────────────────────────────────────────────────────
  {
    id: "wezwanie-do-zaplaty",
    label: "Wezwanie do zapłaty (wzór ogólny)",
    category: "wezwanie do zapłaty",
    title: "WEZWANIE DO ZAPŁATY",
    parties: "boxes",
    signatures: ["Potwierdzenie odbioru / Zamawiający", "Wzywający / Wykonawca"],
    requires: ["clientName", "debt"],
    buildBody: (c) => {
      const amount = fb(c.debtAmount, fb(c.valueGross, "……… zł"));
      return [
        `Dotyczy realizacji robót budowlanych dla ${fb(c.clientName)} w lokalizacji: ${fb(c.siteAddress)}.`,
        ``,
        `W związku z brakiem terminowej płatności wzywamy Zamawiającego do zapłaty zaległej kwoty ${amount}${c.debtAmountWords ? ` (słownie: ${c.debtAmountWords})` : ""}.`,
        `Zaległość obejmuje: ${fb(c.overduePaymentSummary, "……… (np. faktura, etap prac, zaliczka lub rozliczenie końcowe)")}.`,
        ``,
        `§ 1 Termin zapłaty`,
        `Prosimy o uregulowanie wskazanej kwoty w terminie 7 dni od dnia doręczenia niniejszego wezwania, nie później niż do dnia ………, na rachunek bankowy ${c.bankAccount ? `nr ${c.bankAccount}` : "wskazany w umowie/fakturze lub uzgodniony z Wykonawcą"}.`,
        ``,
        `§ 2 Podstawa naliczenia należności`,
        `Należność wynika z wykonanych robót budowlanych w zakresie: ${fb(c.scope, "………")}. Na dzień ${c.todayPl} płatność pozostaje nieuregulowana w całości albo w części.`,
        ``,
        `§ 3 Skutki braku zapłaty`,
        `Brak zapłaty w powyższym terminie może skutkować naliczeniem odsetek ustawowych za opóźnienie oraz skierowaniem sprawy na drogę postępowania sądowego, wraz z dochodzeniem kosztów odzyskania należności, o ile wynika to z umowy i obowiązujących przepisów.`,
        ``,
        `Niniejsze wezwanie stanowi próbę polubownego zakończenia sprawy. W przypadku dokonania płatności przed otrzymaniem pisma prosimy o przesłanie potwierdzenia przelewu.`
      ].join("\n");
    }
  },

  // ── OŚWIADCZENIA / DOKUMENTY OKOŁOUMOWNE ─────────────────────────────────────
  {
    id: "oswiadczenie-rodo",
    label: "Klauzula informacyjna RODO (wzór GolBud)",
    category: "oświadczenie",
    title: "KLAUZULA INFORMACYJNA RODO",
    parties: "none",
    signatures: [],
    requires: ["sellerKrs", "sellerRegon"],
    buildBody: (c) =>
      [
        `# KLAUZULA INFORMACYJNA O PRZETWARZANIU DANYCH OSOBOWYCH`,
        `Zgodnie z art. 13, 14 oraz art. 26 ust. 2 rozporządzenia Parlamentu Europejskiego i Rady (UE) 2016/679 z 27.04.2016 r. w sprawie ochrony osób fizycznych w związku z przetwarzaniem danych osobowych i w sprawie swobodnego przepływu takich danych oraz uchylenia dyrektywy 95/46/WE (ogólne rozporządzenie o ochronie danych, dalej RODO) informujemy o zasadach przetwarzania Państwa danych osobowych oraz o przysługujących Państwu prawach z tym związanych.`,
        `1. Administratorem Pani/Pana danych osobowych jest **${fb(c.sellerLegalName)}**${c.place ? ` z siedzibą w ${c.place}` : ""}${c.sellerAddress ? `, ${c.sellerAddress}` : ""}${c.sellerKrs ? `, wpisana do rejestru przedsiębiorców Krajowego Rejestru Sądowego pod numerem KRS ${c.sellerKrs}` : ""}${c.sellerNip ? `, NIP: ${c.sellerNip}` : ""}${c.sellerRegon ? `, REGON: ${c.sellerRegon}` : ""}${c.sellerEmail ? `, e-mail: ${c.sellerEmail}` : ""}.`,
        `2. W przypadku pytań dotyczących sposobu i zakresu przetwarzania Pani/Pana danych osobowych w zakresie działania Administratora, a także przysługujących Pani/Panu uprawnień należy skontaktować się z Administratorem danych, zgodnie z podanymi wyżej sposobami kontaktu.`,
        `3. Administrator danych osobowych przetwarza Pani/Pana dane osobowe w celu realizacji zawartej umowy, wystawienia rachunku/faktury, prawnie uzasadnionego interesu Administratora, którym jest prawo do ustalenia lub dochodzenia roszczeń lub obrony przed roszczeniami. W tym przypadku podanie danych ma charakter obowiązkowy, a podstawą przetwarzania Pani/Pana danych osobowych jest zawarta umowa oraz przepisy prawa, np. prawo podatkowe (art. 6 ust. 1 lit. b, c i f RODO).`,
        `4. W związku z przetwarzaniem danych w celach, o których mowa w pkt 3, Pani/Pana dane osobowe mogą być udostępniane osobom upoważnionym przez Administratora oraz innym podmiotom na podstawie przepisów szczególnych (np. instytucje podatkowe).`,
        `5. Pani/Pana dane osobowe będą przechowywane przez okres niezbędny do realizacji celów określonych w pkt 3, a po tym czasie przez okres 5 lat. W sytuacji toczących się postępowań — na czas trwania tych postępowań.`,
        `6. W związku z przetwarzaniem Pani/Pana danych osobowych przysługują Pani/Panu następujące uprawnienia:`,
        `a) prawo dostępu do danych osobowych, w tym prawo do uzyskania kopii tych danych;`,
        `b) prawo do żądania sprostowania (poprawiania) danych osobowych — w przypadku, gdy dane są nieprawidłowe lub niekompletne;`,
        `c) prawo do żądania ograniczenia przetwarzania danych osobowych.`,
        `7. W przypadku powzięcia informacji o niezgodnym z prawem przetwarzaniu przez Administratora danych osobowych przysługuje Pani/Panu prawo wniesienia skargi do organu nadzorczego, tj. Prezesa Urzędu Ochrony Danych Osobowych na adres: Urząd Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warszawa.`,
        `8. Pani/Pana dane nie będą przetwarzane w sposób zautomatyzowany i nie będą podlegały profilowaniu.`,
        `9. Pani/Pana dane osobowe nie będą przekazywane do państw trzecich ani organizacji międzynarodowych.`
      ].join("\n")
  },
  {
    id: "oswiadczenie-vat8",
    label: "Oświadczenie VAT 8 % — powierzchnia do 300 / 150 m² (wzór GolBud)",
    category: "oświadczenie",
    title: "OŚWIADCZENIE — STAWKA VAT 8%",
    parties: "none",
    signatures: [],
    requires: ["siteAddress"],
    buildBody: (c) =>
      [
        sellerBlock(c),
        ``,
        `# OŚWIADCZENIE`,
        `1. Zgodnie z dyspozycją art. 41 ust. 12 ustawy o VAT oświadczam, że całkowita powierzchnia użytkowa obiektu budownictwa mieszkaniowego sklasyfikowanego w PKOB dział 11 (tj. budynki mieszkalne stałego zamieszkania) mieszczącego się pod adresem ${fb(c.siteAddress, LONG_DOTS)} nie przekracza:`,
        `a) 300 m² (w przypadku budynków mieszkalnych jednorodzinnych),`,
        `b) 150 m² (w przypadku lokali mieszkalnych).`,
        `2. Zobowiązuję się na każde wezwanie/żądanie Wykonawcy oraz organów podatkowych i skarbowych przedstawić do wglądu lub udostępnić kopię kompletnej dokumentacji techniczno-budowlanej lub innej określającej lub uzasadniającej dane zawarte w niniejszym oświadczeniu.`,
        `3. Ponoszę pełną odpowiedzialność za szkody Wykonawcy powstałe na skutek wskazania błędnych lub nieprecyzyjnych danych dotyczących świadczonych usług lub urządzeń będących przedmiotem tych usług, jak też wynikające z nieposiadania lub posiadania niekompletnej lub wadliwej dokumentacji techniczno-budowlanej lub innej określającej lub uzasadniającej dane zawarte w niniejszym oświadczeniu.`,
        ``,
        `[podpisy: | Data i podpis Zamawiającego]`
      ].join("\n")
  },
  {
    id: "potwierdzenie-gotowka",
    label: "Potwierdzenie odbioru gotówki (wzór GolBud)",
    category: "oświadczenie",
    title: "POTWIERDZENIE ODBIORU GOTÓWKI",
    parties: "none",
    signatures: ["WYKONAWCA", "ZLECENIODAWCA"],
    requires: ["clientName"],
    buildBody: (c) =>
      [
        `# POTWIERDZENIE ODBIORU GOTÓWKI`,
        ``,
        `**Wykonawca:**`,
        sellerBlock(c),
        ``,
        `**Zleceniodawca:**`,
        `Imię i nazwisko / nazwa firmy: ${fb(c.clientName, LONG_DOTS)}`,
        `Adres: ${fb(c.clientAddress, LONG_DOTS)}`,
        ``,
        `## Potwierdzenie odbioru gotówki`,
        `Niniejszym potwierdzam odbiór kwoty ${DOTS} zł, słownie: ${LONG_DOTS} zł, od Zleceniodawcy wskazanego powyżej. Kwota ta stanowi wynagrodzenie za wykonanie usługi budowlanej realizowanej zgodnie z zawartą umową.`,
        `Gotówka została przekazana na poczet:`,
        `[ ] wynagrodzenia za dotychczasowe prace`,
        `[ ] zadatku / zaliczki na prace do wykonania`,
        ``,
        `## Oświadczenie`,
        `Wykonawca oświadcza, że powyższa kwota została przyjęta zgodnie z umową i na poczet ustalonych prac budowlanych.`
      ].join("\n")
  }
];

export function getDocumentTemplate(id: string): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES.find((t) => t.id === id);
}
