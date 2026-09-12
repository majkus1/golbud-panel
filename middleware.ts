import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = supabaseEnv();
  if (env) {
    const supabase = createServerClient(env.url, env.key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        }
      }
    });
    await supabase.auth.getUser();
  }

  const { pathname } = request.nextUrl;
  if (pathname === "/leads" || pathname.startsWith("/leads/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/leads/, "/cases");
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
