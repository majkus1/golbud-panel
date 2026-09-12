/** Czy host wygląda na tymczasowy preview deploy Vercel (linki z maili szybko wygasają). */
export function isEphemeralVercelPreviewHost(hostname: string): boolean {
  return hostname.endsWith(".vercel.app") && hostname.includes("-projects.");
}

/**
 * Bazowy publiczny URL panelu — do linków w mailach (reset hasła, digest).
 * Zawsze preferuj NEXT_PUBLIC_APP_URL na produkcji.
 */
export function getPublicAppBaseUrl(fallbackOrigin?: string): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  if (fallbackOrigin) return fallbackOrigin.replace(/\/$/, "");

  if (typeof window !== "undefined") return window.location.origin;

  return "http://localhost:3000";
}

export function getPasswordRecoveryRedirectUrl(fallbackOrigin?: string): {
  url: string;
  blocked?: string;
} {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = getPublicAppBaseUrl(fallbackOrigin);
  const url = `${base}/login?recovery=1`;

  if (explicit) return { url };

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (isEphemeralVercelPreviewHost(host)) {
      return {
        url,
        blocked:
          "Reset hasła z tymczasowego adresu Vercel nie zadziała — link wygasa po deployu. Ustaw NEXT_PUBLIC_APP_URL na stałą domenę (Vercel → Settings → Environment Variables) i wyślij link ponownie z produkcji."
      };
    }
  }

  return { url };
}
