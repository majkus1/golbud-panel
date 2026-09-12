/**
 * Generuje kwadratowe ikony PWA z logo GolBud.
 * Logo jest szerokie (~4:1) — skalujemy po szerokości, żeby wypełnić ikonę profesjonalnie.
 * Uruchom: npm run generate:icons
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const iconsDir = path.join(publicDir, "icons");
const logoPath = path.join(publicDir, "logo-golbud.png");

/** Tło zgodne z manifestem / theme aplikacji */
const BG = "#f4f4f1";

/** Przygotuj logo: przytnij przezroczyste obramowanie, zachowaj proporcje. */
async function loadLogoBuffer() {
  return sharp(logoPath).trim({ threshold: 12 }).png().toBuffer();
}

/**
 * @param {number} size — bok kwadratu w px
 * @param {number} widthScale — ułamek szerokości ikony zajmowany przez logo (np. 0.94)
 * @param {string} outName
 * @param {{ maskable?: boolean }} opts — maskable: Android safe zone ~80%
 */
async function makeSquareIcon(size, widthScale, outName, { maskable = false } = {}) {
  const logoBuffer = await loadLogoBuffer();
  const meta = await sharp(logoBuffer).metadata();
  const logoAspect = (meta.width || 1) / (meta.height || 1);

  let targetWidth = Math.round(size * widthScale);
  let targetHeight = Math.round(targetWidth / logoAspect);

  if (maskable) {
    const safe = Math.round(size * 0.8);
    if (targetWidth > safe || targetHeight > safe) {
      const scale = safe / Math.max(targetWidth, targetHeight);
      targetWidth = Math.round(targetWidth * scale);
      targetHeight = Math.round(targetHeight * scale);
    }
  }

  const resizedLogo = await sharp(logoBuffer)
    .resize({ width: targetWidth, height: targetHeight, fit: "fill" })
    .png()
    .toBuffer();

  const left = Math.round((size - targetWidth) / 2);
  const top = Math.round((size - targetHeight) / 2);

  await sharp({
    create: { width: size, height: size, channels: 4, background: BG }
  })
    .composite([{ input: resizedLogo, left, top }])
    .png()
    .toFile(path.join(iconsDir, outName));
}

if (!fs.existsSync(logoPath)) {
  console.error("Brak pliku public/logo-golbud.png");
  process.exit(1);
}

fs.mkdirSync(iconsDir, { recursive: true });

/** Standardowe ikony — logo na ~96% szerokości (maks. czytelność bez obcięcia) */
const WIDTH_SCALE = 0.96;
/** Maskable — bezpieczna strefa Android, ale szersze niż wcześniej */
const MASKABLE_WIDTH_SCALE = 0.88;

await makeSquareIcon(192, WIDTH_SCALE, "icon-192.png");
await makeSquareIcon(512, WIDTH_SCALE, "icon-512.png");
await makeSquareIcon(180, WIDTH_SCALE, "apple-touch-icon.png");
await makeSquareIcon(512, MASKABLE_WIDTH_SCALE, "maskable-512.png", { maskable: true });
await makeSquareIcon(32, 0.9, "favicon-32.png");

console.log("Wygenerowano ikony PWA w public/icons/");
