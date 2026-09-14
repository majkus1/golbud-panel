import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Testy dzielą się na dwie grupy:
 *  - `lib/**` — czyste funkcje, uruchamiane zawsze i bez żadnych zależności,
 *  - `tests/integration/**` — wymagają lokalnego Supabase (`npx supabase start`)
 *    i same się pomijają, gdy stos nie działa.
 *
 * Klucze lokalnego Supabase testy biorą z `.env.local` (poza gitem) — dlatego ładujemy
 * go tutaj. Bez tego pliku testy integracyjne po prostu się pomijają.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
    // Trzeci argument "" = wczytaj wszystkie zmienne, nie tylko z prefiksem VITE_.
    env: loadEnv("", process.cwd(), "")
  },
  resolve: {
    alias: { "@": import.meta.dirname }
  }
});
