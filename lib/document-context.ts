import { amountInWordsPl } from "@/lib/amount-words-pl";
import { isoToPlDate } from "@/lib/date-parse";
import { formatPlMoney, grossFromNet, roundMoney } from "@/lib/money-vat";
import type { OfferSellerProfile } from "@/lib/offer-seller-profile";
import { summarizeOfferLines } from "@/lib/offer-sections";
import type { CaseRow, ExtraWork, OfferLine, Payment } from "@/lib/types";

/**
 * Dane podstawiane do wzorów dokumentów. Wszystko jako gotowy tekst — pusty napis, gdy
 * w sprawie czegoś brakuje; wtedy wzór wstawia wielokropek, a generator ostrzega
 * (`findMissingFields`), zanim dokument trafi do klienta.
 */
export type DocumentContext = {
  // Klient i budowa
  clientName: string;
  /** Adres klienta; gdy go nie ma — adres budowy. */
  clientAddress: string;
  clientTaxId: string;
  clientPhone: string;
  clientEmail: string;
  /** Zapis strony „Inwestor” do umowy: pogrubiona nazwa, adres, PESEL/NIP. */
  clientParty: string;
  siteAddress: string;
  scope: string;
  /** Punkty zakresu prac: z pozycji wariantu albo z wierszy opisu sprawy. */
  scopeItems: string[];

  // Umowa i terminy
  contractNumber: string;
  contractDate: string;
  /** Miejsce zawarcia w miejscowniku („Ożarowie Mazowieckim”) — „zawarta w …”. */
  place: string;
  todayPl: string;
  startDate: string;
  endDate: string;

  // Kwoty
  vatRate: number;
  valueNet: string;
  valueGross: string;
  /** „12 000,00 zł netto, tj. 12 960,00 zł brutto (VAT 8 %)”. */
  valueDescription: string;
  valueGrossWords: string;
  /** Stawki jednostkowe do § 5 ust. 2 umowy. */
  rateLines: string[];
  /** Wiersze tabel (protokół częściowy, aneks rozliczeniowy). */
  lineRows: { lp: number; label: string; unit: string; quantity: string }[];
  /** Trzy zaliczki po 30 % wartości brutto. */
  advances: string[];
  bankAccount: string;

  // Roboty dodatkowe (aneks)
  extrasLines: string[];
  extrasNet: string;
  extrasNetWords: string;
  extrasGross: string;

  // Zaległości (wezwanie, aneks o zapłatę)
  debtAmount: string;
  debtAmountWords: string;
  overduePaymentSummary: string;

  // Wykonawca
  sellerLegalName: string;
  sellerShortName: string;
  sellerNip: string;
  sellerKrs: string;
  sellerRegon: string;
  sellerAddress: string;
  sellerAddressLine: string;
  sellerPostalCity: string;
  sellerPhone: string;
  sellerEmail: string;
  sellerContactPerson: string;
  /** Pełna klauzula stron: nazwa, siedziba, KRS, NIP, REGON, reprezentacja. */
  sellerKomparycja: string;
  /** Jak wyżej, z pełnomocnikiem (umowa przedwstępna). */
  sellerKomparycjaWithProxy: string;
};

/** Zgodność ze starszą nazwą typu. */
export type DocumentTemplateContext = DocumentContext;

const plNumber = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 });

/**
 * Podział kwoty na części procentowe (np. zaliczki 30/30/30). Części zaokrąglone do groszy
 * sumują się dokładnie do zaokrąglonej sumy procentów — różnica z zaokrągleń trafia do ostatniej.
 */
export function splitAdvances(total: number, percents: number[]): number[] {
  if (!Number.isFinite(total) || total <= 0 || percents.length === 0) return percents.map(() => 0);
  const parts = percents.map((p) => roundMoney((total * p) / 100));
  const expected = roundMoney((total * percents.reduce((s, p) => s + p, 0)) / 100);
  const diff = roundMoney(expected - parts.reduce((s, p) => s + p, 0));
  parts[parts.length - 1] = roundMoney(parts[parts.length - 1] + diff);
  return parts;
}

/** „GOLBUD DAWID GOLCZUK SPÓŁKA KOMANDYTOWA” → „GOLBUD DAWID GOLCZUK Sp. k.” (nagłówek, stopka). */
export function shortLegalName(legalName: string): string {
  return legalName
    .replace(/\s*spółka komandytowa\s*$/i, " Sp. k.")
    .replace(/\s*spółka z ograniczoną odpowiedzialnością\s*$/i, " Sp. z o.o.")
    .replace(/\s*spółka jawna\s*$/i, " Sp. j.")
    .trim();
}

/**
 * Komparycja wykonawcy — zdanie o stronie umowy, jak we wzorach Dawida. Brakujące dane
 * (np. KRS) po prostu pomija, żeby nie drukować „KRS pod numerem ,”.
 */
export function buildKomparycja(seller: OfferSellerProfile, options: { withProxy?: boolean } = {}): string {
  const parts: string[] = [`**${seller.legalName}**`];
  const seat = seller.seat ? ` z siedzibą w ${seller.seat}` : "";
  const address = [seller.addressLine, seller.postalCity].filter(Boolean).join(", ");
  let text = `${parts[0]}${seat}${address ? `, ${address}` : ""}`;
  const registry: string[] = [];
  if (seller.krs) registry.push(`wpisaną do Rejestru Przedsiębiorców KRS pod numerem ${seller.krs}`);
  const ids = [seller.nip ? `NIP ${seller.nip}` : "", seller.regon ? `REGON ${seller.regon}` : ""].filter(Boolean);
  if (registry.length) text += `, ${registry.join(", ")}`;
  if (ids.length) text += `, ${ids.join(", ")}`;
  if (seller.representation) text += `, reprezentowaną przez ${seller.representation}`;
  if (options.withProxy && seller.proxy) {
    text += `, oraz przez ${seller.proxy}, działającego w imieniu spółki na podstawie udzielonego pełnomocnictwa`;
  }
  return text;
}

function money(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) && value > 0 ? formatPlMoney(value) : "";
}

type ContextInput = {
  caseRow: Pick<
    CaseRow,
    | "client_name"
    | "phone"
    | "email"
    | "location"
    | "client_address"
    | "client_tax_id"
    | "work_description"
    | "contract_number"
    | "contract_date"
    | "planned_start_date"
    | "realization_end_date"
    | "estimated_value"
  > | null;
  seller: OfferSellerProfile | null;
  /** Pozycje wybranego wariantu — wartość umowy, stawki, zakres. */
  lines?: OfferLine[];
  payments?: Payment[];
  extras?: ExtraWork[];
  /** Dzisiejsza data ISO (rrrr-mm-dd) — przekazywana, żeby wynik nie zależał od zegara. */
  todayIso: string;
};

export function buildDocumentContext({ caseRow, seller, lines = [], payments = [], extras = [], todayIso }: ContextInput): DocumentContext {
  const vatRate = seller?.defaultVatRate ?? 23;

  // Wartość: suma wariantu, a bez pozycji — szacowana wartość netto ze sprawy.
  const variantNet = lines.length ? summarizeOfferLines(lines).total : 0;
  const net = variantNet > 0 ? variantNet : Number(caseRow?.estimated_value) || 0;
  const vat = net > 0 ? grossFromNet(net, vatRate) : null;

  const rateLines = lines.map((l) => {
    const rateGross = grossFromNet(Number(l.unit_rate) || 0, vatRate).gross;
    return `${l.label} — ${formatPlMoney(Number(l.unit_rate) || 0)} netto za ${l.unit}, tj. ${formatPlMoney(rateGross)} brutto`;
  });
  const lineRows = lines.map((l, i) => ({ lp: i + 1, label: l.label, unit: l.unit, quantity: plNumber.format(Number(l.quantity) || 0) }));

  const scopeFromLines = Array.from(new Set(lines.map((l) => l.label.trim()).filter(Boolean)));
  const scopeFromDescription = (caseRow?.work_description || "")
    .split(/\n|;/)
    .map((s) => s.replace(/^[-•\d.)\s]+/, "").trim())
    .filter(Boolean);

  // Zaległości: najpierw po terminie, a gdy takich nie ma — wszystkie nieopłacone.
  const unpaid = payments
    .map((payment) => ({ payment, balance: Math.max(0, Number(payment.amount_due || 0) - Number(payment.amount_paid || 0)) }))
    .filter(({ balance }) => balance > 0);
  const overdue = unpaid.filter(({ payment }) => payment.due_date && payment.due_date <= todayIso);
  const debtRows = overdue.length > 0 ? overdue : unpaid;
  const debtTotal = roundMoney(debtRows.reduce((sum, row) => sum + row.balance, 0));
  const overduePaymentSummary = debtRows
    .map(({ payment, balance }) => `${payment.title}${payment.due_date ? `, termin ${isoToPlDate(payment.due_date)}` : ""}: ${formatPlMoney(balance)}`)
    .join("; ");

  // Roboty dodatkowe: zaakceptowane, a gdy żadna nie jest zaakceptowana — wszystkie z listy.
  const acceptedExtras = extras.filter((e) => e.accepted);
  const extrasUsed = acceptedExtras.length > 0 ? acceptedExtras : extras;
  const extrasNetValue = roundMoney(extrasUsed.reduce((s, e) => s + (Number(e.line_total) || 0), 0));
  const extrasLines = extrasUsed.map(
    (e) => `${e.description} — ${plNumber.format(Number(e.quantity) || 0)} ${e.unit} × ${formatPlMoney(Number(e.unit_rate) || 0)} netto = ${formatPlMoney(Number(e.line_total) || 0)} netto`
  );

  const clientAddress = (caseRow?.client_address || caseRow?.location || "").trim();
  const clientName = (caseRow?.client_name || "").trim();
  const clientTaxId = (caseRow?.client_tax_id || "").trim();
  const clientParty = [
    clientName ? `**${clientName}**` : "**…………………………………………**",
    clientAddress ? `zam. ${clientAddress}` : "",
    clientTaxId ? `PESEL/NIP: ${clientTaxId}` : ""
  ]
    .filter(Boolean)
    .join(", ");

  const sellerAddress = [seller?.addressLine, seller?.postalCity].filter((p) => p && p.trim()).join(", ");

  return {
    clientName,
    clientAddress,
    clientTaxId,
    clientPhone: (caseRow?.phone || "").trim(),
    clientEmail: (caseRow?.email || "").trim(),
    clientParty,
    siteAddress: (caseRow?.location || "").trim(),
    scope: (caseRow?.work_description || "").trim(),
    scopeItems: scopeFromLines.length ? scopeFromLines : scopeFromDescription,

    contractNumber: (caseRow?.contract_number || "").trim(),
    contractDate: isoToPlDate(caseRow?.contract_date),
    place: seller?.seat || "",
    todayPl: isoToPlDate(todayIso),
    startDate: isoToPlDate(caseRow?.planned_start_date),
    endDate: isoToPlDate(caseRow?.realization_end_date),

    vatRate,
    valueNet: vat ? formatPlMoney(vat.net) : "",
    valueGross: vat ? formatPlMoney(vat.gross) : "",
    valueDescription: vat ? `${formatPlMoney(vat.net)} netto, tj. ${formatPlMoney(vat.gross)} brutto (VAT ${vat.vatRate} %)` : "",
    valueGrossWords: vat ? amountInWordsPl(vat.gross) : "",
    rateLines,
    lineRows,
    advances: vat ? splitAdvances(vat.gross, [30, 30, 30]).map(formatPlMoney) : [],
    bankAccount: seller?.bankAccount || "",

    extrasLines,
    extrasNet: money(extrasNetValue),
    extrasNetWords: extrasNetValue > 0 ? amountInWordsPl(extrasNetValue) : "",
    extrasGross: extrasNetValue > 0 ? formatPlMoney(grossFromNet(extrasNetValue, vatRate).gross) : "",

    debtAmount: money(debtTotal),
    debtAmountWords: debtTotal > 0 ? amountInWordsPl(debtTotal) : "",
    overduePaymentSummary,

    sellerLegalName: seller?.legalName || "",
    sellerShortName: seller ? shortLegalName(seller.legalName) : "",
    sellerNip: seller?.nip || "",
    sellerKrs: seller?.krs || "",
    sellerRegon: seller?.regon || "",
    sellerAddress,
    sellerAddressLine: seller?.addressLine || "",
    sellerPostalCity: seller?.postalCity || "",
    sellerPhone: seller?.phone || "",
    sellerEmail: seller?.email || "",
    sellerContactPerson: seller?.contactPerson || "",
    sellerKomparycja: seller ? buildKomparycja(seller) : "",
    sellerKomparycjaWithProxy: seller ? buildKomparycja(seller, { withProxy: true }) : ""
  };
}

/** Dane, bez których wzór wychodzi z wielokropkami — z informacją, gdzie je uzupełnić. */
export type RequiredField =
  | "clientName"
  | "clientAddress"
  | "clientTaxId"
  | "siteAddress"
  | "contractNumber"
  | "contractDate"
  | "startDate"
  | "endDate"
  | "value"
  | "rates"
  | "bankAccount"
  | "sellerKrs"
  | "sellerRegon"
  | "extras"
  | "debt";

const REQUIRED_LABELS: Record<RequiredField, { label: string; where: string }> = {
  clientName: { label: "imię i nazwisko klienta", where: "Edytuj dane" },
  clientAddress: { label: "adres klienta", where: "Edytuj dane" },
  clientTaxId: { label: "PESEL / NIP klienta", where: "Edytuj dane" },
  siteAddress: { label: "adres budowy", where: "Edytuj dane" },
  contractNumber: { label: "numer umowy", where: "zakładka Umowa" },
  contractDate: { label: "data umowy", where: "zakładka Umowa" },
  startDate: { label: "planowane rozpoczęcie", where: "zakładka Umowa" },
  endDate: { label: "planowane zakończenie", where: "zakładka Umowa" },
  value: { label: "wartość prac", where: "Wycena i oferta" },
  rates: { label: "pozycje wyceny (stawki)", where: "Wycena i oferta" },
  bankAccount: { label: "numer konta firmy", where: "Ustawienia → Firma" },
  sellerKrs: { label: "KRS firmy", where: "Ustawienia → Firma" },
  sellerRegon: { label: "REGON firmy", where: "Ustawienia → Firma" },
  extras: { label: "roboty dodatkowe", where: "Więcej → Roboty dodatkowe" },
  debt: { label: "nieopłacone płatności", where: "zakładka Płatności" }
};

function isMissing(field: RequiredField, ctx: DocumentContext): boolean {
  switch (field) {
    case "value":
      return !ctx.valueNet;
    case "rates":
      return ctx.rateLines.length === 0;
    case "extras":
      return ctx.extrasLines.length === 0;
    case "debt":
      return !ctx.debtAmount;
    default:
      return !ctx[field];
  }
}

export function findMissingFields(required: RequiredField[], ctx: DocumentContext): { field: RequiredField; label: string; where: string }[] {
  return required.filter((f) => isMissing(f, ctx)).map((field) => ({ field, ...REQUIRED_LABELS[field] }));
}
