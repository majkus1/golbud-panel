"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { showToast } from "@/components/toast";
import { useOrg } from "@/components/org-context";
import {
  getPushPermission,
  isPushSupported,
  sendTestBrowserPush,
  subscribeBrowserPush,
  unsubscribeBrowserPush
} from "@/lib/push-client";
import { supabase } from "@/lib/supabase";

type PushState = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  pushEnabled: boolean;
  hasSubscription: boolean;
};

export function PushNotificationSettings({ compact = false }: { compact?: boolean }) {
  const { organizationId, userId } = useOrg();
  const [state, setState] = useState<PushState>({
    supported: false,
    permission: "default",
    pushEnabled: false,
    hasSubscription: false
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  const refresh = useCallback(async () => {
    const supported = isPushSupported();
    const permission = await getPushPermission();
    let hasSubscription = false;
    if (supported && permission === "granted") {
      try {
        const reg = await navigator.serviceWorker.ready;
        const endpoint = (await reg.pushManager.getSubscription())?.endpoint ?? null;
        // Subskrypcja w przeglądarce to za mało — musi być też zapisana na serwerze,
        // inaczej wysyłka (i test) kończy się błędem „urządzenie nie jest zapisane”.
        if (endpoint && userId) {
          const { data: savedSubscription } = await supabase
            .from("push_subscriptions")
            .select("endpoint")
            .eq("user_id", userId)
            .eq("endpoint", endpoint)
            .maybeSingle();
          hasSubscription = savedSubscription != null;
        }
      } catch {
        hasSubscription = false;
      }
    }

    let pushEnabled = false;
    // Filtr po user_id jest konieczny: właściciel firmy widzi przez RLS preferencje
    // wszystkich członków organizacji, więc bez niego maybeSingle() zwraca błąd
    // przy więcej niż jednym wierszu i przełącznik nigdy się nie zapala.
    if (organizationId && userId) {
      const { data } = await supabase
        .from("digest_email_prefs")
        .select("push_enabled")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .maybeSingle();
      pushEnabled = data?.push_enabled ?? false;
    }

    setState({ supported, permission, pushEnabled, hasSubscription });
    setLoading(false);
  }, [organizationId, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setPushEnabled = async (enabled: boolean) => {
    if (!organizationId) return;
    setBusy(true);
    setConnectionError("");

    try {
      if (enabled) {
        const result = await subscribeBrowserPush(organizationId);
        if (!result.ok) {
          const reason = result.reason || "Nie udało się włączyć push";
          setConnectionError(reason);
          showToast(reason, "error");
          return;
        }
        showToast("To urządzenie połączono z powiadomieniami");
      } else {
        await unsubscribeBrowserPush();
        const { error } = await supabase.rpc("set_own_push_enabled", {
          p_organization_id: organizationId,
          p_enabled: false
        });
        if (error) {
          showToast("Nie udało się wyłączyć push", "error");
          return;
        }
        showToast("Powiadomienia push wyłączone");
      }
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const active = state.pushEnabled && state.permission === "granted" && state.hasSubscription;

  const sendTest = async () => {
    setTesting(true);
    const result = await sendTestBrowserPush();
    setTesting(false);
    if (result.ok) showToast("Wysłano test na to urządzenie");
    else showToast(result.reason || "Nie udało się wysłać testu", "error");
  };

  if (loading) {
    return (
      <div className={`rounded-xl2 border border-stone-200 bg-white ${compact ? "p-4" : "p-5 shadow-card"}`}>
        <p className="text-sm text-steel">Wczytywanie ustawień push…</p>
      </div>
    );
  }

  if (!state.supported) {
    return (
      <div className={`rounded-xl2 border border-stone-200 bg-stone-50 ${compact ? "p-4" : "p-5 shadow-card"}`}>
        <h2 className="text-sm font-bold text-ink">Powiadomienia push</h2>
        <p className="mt-2 text-sm text-steel">
          To urządzenie nie obsługuje powiadomień push albo panel został otwarty w sposób, który je wyłącza.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-steel">
          <li>Zaktualizuj przeglądarkę i system do aktualnej wersji.</li>
          <li>Nie korzystaj z okna prywatnego / incognito.</li>
          <li>Otwórz panel przez adres z „https”.</li>
          <li>Na telefonie dodaj GolBud do ekranu głównego i uruchamiaj go jako aplikację.</li>
        </ul>
      </div>
    );
  }

  if (state.permission === "denied") {
    return (
      <div className={`rounded-xl2 border border-amber-200 bg-amber-50 ${compact ? "p-4" : "p-5 shadow-card"}`}>
        <h2 className="text-sm font-bold text-ink">Powiadomienia push</h2>
        <p className="mt-2 text-sm text-steel">Zgoda na powiadomienia jest zablokowana dla GolBud na tym urządzeniu.</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-steel">
          <li>
            W przeglądarce kliknij ikonę przy adresie tej strony i zmień uprawnienie „Powiadomienia” na „Zezwalaj”. To
            samo ustawienie znajdziesz w ustawieniach przeglądarki, w sekcji uprawnień witryn.
          </li>
          <li>
            Jeśli GolBud jest zainstalowany jako aplikacja, sprawdź też powiadomienia w ustawieniach systemu — aplikacja
            figuruje tam pod nazwą „GolBud”.
          </li>
          <li>Po zmianie odśwież tę stronę i włącz przełącznik ponownie.</li>
        </ul>
      </div>
    );
  }

  return (
    <div className={`rounded-xl2 border border-stone-200 bg-white ${compact ? "p-4" : "p-5 shadow-card"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink">Powiadomienia push</h2>
          <p className="mt-1 text-sm text-steel">
            Na telefonie (aplikacja z ekranu głównego) i w przeglądarce na komputerze. Dostaniesz je od razu przy zdarzeniu — nowa sprawa, zadanie, komentarz.
          </p>
          {!compact && (
            <p className="mt-2 text-xs text-stone-400">
              To ustawienie dotyczy tylko Ciebie na tym urządzeniu. Maile i digest ustawia właściciel firmy w Zespole.
            </p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          disabled={busy}
          onClick={() => void setPushEnabled(!active)}
          className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50 ${
            active ? "bg-moss" : "bg-stone-300"
          }`}
        >
          <span
            className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform ${
              active ? "left-[1.35rem]" : "left-0.5"
            }`}
          />
          <span className="sr-only">{active ? "Wyłącz powiadomienia push" : "Włącz powiadomienia push"}</span>
        </button>
      </div>
      {state.pushEnabled && !state.hasSubscription && state.permission === "granted" && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-amber-900">Zgoda jest przyznana, ale to urządzenie nie zostało jeszcze połączone.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void setPushEnabled(true)}
            className="shrink-0 rounded-md bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-moss disabled:opacity-50"
          >
            {busy ? "Łączenie…" : "Połącz to urządzenie"}
          </button>
        </div>
      )}
      {active && (
        <button
          type="button"
          disabled={testing}
          onClick={() => void sendTest()}
          className="mt-3 rounded-md border border-stone-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-stone-50 disabled:opacity-50"
        >
          {testing ? "Wysyłanie testu…" : "Wyślij powiadomienie testowe"}
        </button>
      )}
      {connectionError && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
          <p className="font-semibold">Nie udało się połączyć urządzenia</p>
          <p className="mt-1 break-words">{connectionError}</p>
          <p className="mt-2 text-rose-800">
            Jeśli błąd się powtarza: odśwież stronę, upewnij się, że nie działasz w oknie prywatnym, i sprawdź w
            ustawieniach przeglądarki, czy obsługa powiadomień push nie jest wyłączona. Po zmianie ustawień uruchom
            przeglądarkę ponownie.
          </p>
        </div>
      )}
      {compact && (
        <Link href="/notifications" className="mt-3 inline-block text-xs font-semibold text-moss hover:underline">
          Więcej w Powiadomieniach →
        </Link>
      )}
    </div>
  );
}
