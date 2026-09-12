import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Dla Route Handlerów: najpierw sesja z cookies (SSR),
 * jeśli brak — JWT z nagłówka Authorization (fetch z klienta).
 * Dzięki temu PDF działa także gdy cookies nie trafiają do funkcji na Vercel.
 */
export async function getSupabaseUserClient(request: Request): Promise<{ supabase: SupabaseClient } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const cookieClient = await createSupabaseServerClient();
  const {
    data: { user: cookieUser }
  } = await cookieClient.auth.getUser();
  if (cookieUser) {
    return { supabase: cookieClient };
  }

  const header = request.headers.get("authorization") || request.headers.get("Authorization");
  const bearerMatch = header?.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1]?.trim() ?? null;
  if (!token) return null;

  const bearerClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const {
    data: { user },
    error
  } = await bearerClient.auth.getUser();
  if (error || !user) return null;

  return { supabase: bearerClient };
}
