import { supabase } from "@/lib/supabase";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined"
    && window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

export async function getPushPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

function pushErrorReason(error: unknown): string {
  const err = error as { name?: string; message?: string };
  const detail = err.message?.trim();

  if (err.name === "NotAllowedError") {
    return "Przeglądarka nie pozwoliła utworzyć subskrypcji. Sprawdź uprawnienia powiadomień i spróbuj ponownie.";
  }
  if (err.name === "AbortError") {
    return "Usługa powiadomień przeglądarki nie odpowiedziała. Sprawdź w ustawieniach przeglądarki, czy obsługa powiadomień push nie jest wyłączona, uruchom ją ponownie i spróbuj jeszcze raz.";
  }
  if (err.name === "InvalidStateError") {
    return "Service worker nie jest jeszcze gotowy. Odśwież stronę i ponownie połącz to urządzenie.";
  }
  return detail ? `Nie udało się utworzyć subskrypcji: ${detail}` : "Nie udało się utworzyć subskrypcji push na tym urządzeniu.";
}

async function readyServiceWorker(): Promise<ServiceWorkerRegistration> {
  const current = await navigator.serviceWorker.getRegistration("/");
  if (!current) await navigator.serviceWorker.register("/sw.js", { scope: "/" });

  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new DOMException("Przekroczono czas oczekiwania na service worker", "InvalidStateError")), 12_000);
    })
  ]);
}

export async function subscribeBrowserPush(organizationId: string): Promise<{ ok: boolean; reason?: string }> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return { ok: false, reason: "Brak klucza VAPID na serwerze" };
  if (!isPushSupported()) return { ok: false, reason: "Ta przeglądarka lub połączenie nie obsługuje bezpiecznych powiadomień push" };

  try {
    // Rozpoczynamy przygotowanie SW bez czekania, aby sam prompt nadal wynikał
    // bezpośrednio z kliknięcia użytkownika (wymagane szczególnie przez Safari).
    const registrationPromise = readyServiceWorker();
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    if (permission === "default") {
      return { ok: false, reason: "Nie wybrano zgody na powiadomienia. Kliknij ponownie i wybierz „Zezwól”." };
    }
    if (permission !== "granted") {
      return { ok: false, reason: "Powiadomienia są zablokowane w ustawieniach przeglądarki lub systemu." };
    }

    const applicationServerKey = urlBase64ToUint8Array(publicKey);
    if (applicationServerKey.byteLength !== 65) {
      return { ok: false, reason: "Publiczny klucz VAPID ma nieprawidłowy format" };
    }

    const reg = await registrationPromise;
    let sub = await reg.pushManager.getSubscription();
    let createdNow = false;
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource
      });
      createdNow = true;
    }

    const json = sub.toJSON();
    const keys = json.keys;
    if (!json.endpoint || !keys?.p256dh || !keys.auth) {
      if (createdNow) await sub.unsubscribe().catch(() => false);
      return { ok: false, reason: "Przeglądarka nie zwróciła kompletnych danych subskrypcji" };
    }

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) {
      if (createdNow) await sub.unsubscribe().catch(() => false);
      return { ok: false, reason: "Brak sesji" };
    }

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        organizationId,
        endpoint: json.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: navigator.userAgent
      })
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      if (createdNow) await sub.unsubscribe().catch(() => false);
      return { ok: false, reason: err.error || "Nie udało się zapisać urządzenia na serwerze" };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, reason: pushErrorReason(error) };
  }
}

export async function unsubscribeBrowserPush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  await sub.unsubscribe();

  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return;

  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint })
  });
}

export async function sendTestBrowserPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) return { ok: false, reason: "Przeglądarka nie obsługuje push" };

  try {
    const reg = await readyServiceWorker();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: false, reason: "Najpierw połącz to urządzenie" };

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return { ok: false, reason: "Brak sesji" };

    const res = await fetch("/api/push/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { ok: true } : { ok: false, reason: body.error || "Nie udało się wysłać testu" };
  } catch (error) {
    return { ok: false, reason: pushErrorReason(error) };
  }
}
