import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Klient pod przeglądarkę — musi być z @supabase/ssr, żeby sesja trafiała do cookies.
 * Wtedy Route Handlery (np. PDF) widzą użytkownika przez createServerClient + cookies().
 * Sam createClient z supabase-js trzymał tylko localStorage → „Brak sesji” przy window.open na /api/...
 */
export const supabase = createBrowserClient(
  supabaseUrl || "https://example.supabase.co",
  supabaseAnonKey || "missing-anon-key"
);
