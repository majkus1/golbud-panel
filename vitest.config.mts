import { defineConfig } from "vitest/config";

/**
 * Testy dzielą się na dwie grupy:
 *  - `lib/**` — czyste funkcje, uruchamiane zawsze i bez żadnych zależności,
 *  - `tests/integration/**` — wymagają lokalnego Supabase (`npx supabase start`)
 *    i same się pomijają, gdy stos nie działa.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000
  },
  resolve: {
    alias: { "@": import.meta.dirname }
  }
});
