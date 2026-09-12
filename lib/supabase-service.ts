import { createClient } from "@supabase/supabase-js";

/** Tylko po stronie serwera (cron, PDF). Nigdy w bundle klienta. */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Brak NEXT_PUBLIC_SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
