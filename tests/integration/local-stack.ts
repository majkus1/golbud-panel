/**
 * Dostęp do lokalnego Supabase w testach integracyjnych.
 *
 * Klucze NIE są wpisane w kodzie. Wcześniej każdy test miał na sztywno klucze demo
 * lokalnego Supabase (te same na każdej instalacji, publiczne w dokumentacji) — nie są
 * tajne, ale skaner GitGuardian nie umie tego odróżnić i podnosi alarm przy każdym
 * pushu. Repozytorium ma być czyste dla każdego, kto je zobaczy, więc klucze czytamy
 * z `.env.local` (poza gitem), które vitest ładuje w `vitest.config.mts`.
 *
 * Nazwy zmiennych: dedykowane `SUPABASE_TEST_*`, a bez nich te same, których używa
 * aplikacja na dev — `npx supabase status` pokazuje wszystkie trzy.
 */

export const SUPABASE_URL = process.env.SUPABASE_TEST_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
export const ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Hasło kont tymczasowych — losowe na każde uruchomienie, żeby nie wyglądało jak sekret. */
export const TEST_PASSWORD = `Test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}!`;

/** Ustawiane raz w `beforeAll` przez `detectStack()`. */
export const stack = { available: false };

export async function stackIsUp(): Promise<boolean> {
  if (!ANON_KEY || !SERVICE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: ANON_KEY } });
    return res.ok;
  } catch {
    return false;
  }
}

export async function detectStack(): Promise<boolean> {
  stack.available = await stackIsUp();
  return stack.available;
}

type SkippableContext = { skip: () => void };

/** Pomija test, gdy lokalny Supabase nie działa albo brak kluczy (np. maszyna bez Dockera). */
export function requireStack(ctx: SkippableContext): boolean {
  if (!stack.available) {
    ctx.skip();
    return false;
  }
  return true;
}
