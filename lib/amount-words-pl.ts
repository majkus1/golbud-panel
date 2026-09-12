/** Kwota w złotych — słownie po polsku (np. do ofert PDF). */

const ONES_M = [
  "zero",
  "jeden",
  "dwa",
  "trzy",
  "cztery",
  "pięć",
  "sześć",
  "siedem",
  "osiem",
  "dziewięć"
];

const ONES_F = [
  "zero",
  "jedna",
  "dwie",
  "trzy",
  "cztery",
  "pięć",
  "sześć",
  "siedem",
  "osiem",
  "dziewięć"
];

const TEENS = [
  "dziesięć",
  "jedenaście",
  "dwanaście",
  "trzynaście",
  "czternaście",
  "piętnaście",
  "szesnaście",
  "siedemnaście",
  "osiemnaście",
  "dziewiętnaście"
];

const TENS = ["", "dziesięć", "dwadzieścia", "trzydzieści", "czterdzieści", "pięćdziesiąt", "sześćdziesiąt", "siedemdziesiąt", "osiemdziesiąt", "dziewięćdziesiąt"];

const HUNDREDS = [
  "",
  "sto",
  "dwieście",
  "trzysta",
  "czterysta",
  "pięćset",
  "sześćset",
  "siedemset",
  "osiemset",
  "dziewięćset"
];

function pluralZl(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return "złoty";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "złote";
  return "złotych";
}

function pluralGr(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return "grosz";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "grosze";
  return "groszy";
}

function tripletWords(n: number, feminine: boolean): string {
  if (n === 0) return "";
  const ones = feminine ? ONES_F : ONES_M;
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const t = Math.floor(rest / 10);
  const o = rest % 10;

  if (h > 0) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10]);
  } else {
    if (t > 0) parts.push(TENS[t]);
    if (o > 0) parts.push(ones[o]);
  }
  return parts.join(" ");
}

function scaleWord(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function integerToWords(n: number): string {
  if (n === 0) return "zero";
  if (n < 0) return `minus ${integerToWords(-n)}`;

  const chunks: string[] = [];
  let rest = n;
  let scale = 0;

  while (rest > 0) {
    const chunk = rest % 1000;
    if (chunk > 0) {
      const feminine = scale === 1;
      let word = tripletWords(chunk, feminine);
      if (scale === 1) {
        word = `${word} ${scaleWord(chunk, ["tysiąc", "tysiące", "tysięcy"])}`.trim();
      } else if (scale === 2) {
        word = `${word} ${scaleWord(chunk, ["milion", "miliony", "milionów"])}`.trim();
      } else if (scale === 3) {
        word = `${word} ${scaleWord(chunk, ["miliard", "miliardy", "miliardów"])}`.trim();
      }
      chunks.unshift(word);
    }
    rest = Math.floor(rest / 1000);
    scale += 1;
  }

  return chunks.join(" ");
}

/**
 * @param amount — kwota brutto (lub inna, jeśli podasz etykietę)
 */
export function amountInWordsPl(amount: number): string {
  if (!Number.isFinite(amount)) return "zero złotych";
  const abs = Math.abs(amount);
  const zl = Math.floor(abs);
  const gr = Math.round((abs - zl) * 100);

  const zlWords = integerToWords(zl);
  const prefix = amount < 0 ? "minus " : "";
  const grPart = gr > 0 ? ` ${integerToWords(gr)} ${pluralGr(gr)}` : "";
  return `${prefix}${zlWords} ${pluralZl(zl)}${grPart}`.replace(/\s+/g, " ").trim();
}
