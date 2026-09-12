"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { useOrg } from "@/components/org-context";
import { showToast } from "@/components/toast";
import { getAuthenticatedJson, postAuthenticatedJson } from "@/lib/authed-fetch";
import { formatDateTime } from "@/lib/format";
import type { MailAccount } from "@/lib/mail/account";

/**
 * Konfiguracja własnej skrzynki pocztowej — źródło historii korespondencji przy zleceniach.
 * Hasło aplikacji wysyłamy tylko w jedną stronę; z serwera wraca wyłącznie status.
 */

export default function MailSettingsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <MailSettingsInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

const STATUS_LABEL: Record<MailAccount["status"], { text: string; tone: string }> = {
  ok: { text: "Połączenie działa", tone: "border-moss/30 bg-moss/10 text-moss-dark" },
  error: { text: "Błąd połączenia", tone: "border-rose-200 bg-rose-50 text-rose-800" },
  unverified: { text: "Niesprawdzona", tone: "border-amber-200 bg-amber-50 text-amber-900" }
};

function MailSettingsInner() {
  const { organizationId } = useOrg();
  const [account, setAccount] = useState<MailAccount | null>(null);
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const result = await getAuthenticatedJson<{ account: MailAccount | null }>(
      `/api/settings/mail-account?organizationId=${organizationId}`
    );
    if (result.ok) {
      setAccount(result.data.account);
      setEmail(result.data.account?.email_address ?? "");
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!organizationId) return;
    setSaving(true);
    const result = await postAuthenticatedJson("/api/settings/mail-account", {
      organizationId,
      email,
      appPassword
    });
    setSaving(false);

    if (!result.ok) {
      showToast(result.error, "error");
      await load();
      return;
    }
    setAppPassword("");
    showToast("Skrzynka zapisana i sprawdzona");
    await load();
  };

  const remove = async () => {
    if (!organizationId) return;
    setSaving(true);
    const result = await postAuthenticatedJson("/api/settings/mail-account/delete", { organizationId });
    setSaving(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    setAccount(null);
    setEmail("");
    setAppPassword("");
    showToast("Skrzynka usunięta");
  };

  const status = account ? STATUS_LABEL[account.status] : null;

  return (
    <div className="min-w-0 w-full max-w-2xl">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Ustawienia</p>
      <h1 className="mt-1 text-2xl font-bold text-ink">Moja poczta</h1>
      <p className="mt-2 text-sm text-steel">
        Po podłączeniu skrzynki w karcie każdego zlecenia pojawi się historia korespondencji z klientem —
        wiadomości wysłane i odebrane, pogrupowane w wątki.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-steel">Wczytywanie…</p>
      ) : (
        <section className="mt-6 rounded-xl2 border border-stone-200 bg-white p-5 shadow-card">
          {account && status && (
            <div className={`mb-4 rounded-lg border px-3 py-2 text-xs font-semibold ${status.tone}`}>
              {status.text}
              {account.last_checked_at && (
                <span className="ml-2 font-normal opacity-80">sprawdzono {formatDateTime(account.last_checked_at)}</span>
              )}
              {account.status === "error" && account.last_error && (
                <p className="mt-1 font-normal">{account.last_error}</p>
              )}
            </div>
          )}

          <div className="grid gap-4">
            <label className="grid gap-1 text-xs font-semibold text-ink">
              Adres skrzynki
              <input
                className="input font-normal"
                type="email"
                autoComplete="off"
                placeholder="np. kontakt.golbud@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <label className="grid gap-1 text-xs font-semibold text-ink">
              Hasło aplikacji Google
              <input
                className="input font-normal"
                type="password"
                autoComplete="new-password"
                placeholder={account ? "wpisz ponownie, aby zmienić" : "16 znaków z konta Google"}
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
              />
              <span className="text-[0.7rem] font-normal text-steel">
                To nie jest zwykłe hasło do konta. Wygenerujesz je na koncie Google w sekcji „Hasła aplikacji&rdquo; —
                wymaga włączonej weryfikacji dwuetapowej. W skrzynce musi być też włączony dostęp IMAP.
                Możesz wkleić hasło ze spacjami, tak jak pokazuje je Google — zostaną pominięte.
                Hasło wpisujesz raz; zapisujemy je na stałe i nie trzeba go odnawiać.
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || !email.trim() || !appPassword.trim()}
                onClick={() => void save()}
                className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50"
              >
                {saving ? "Sprawdzam połączenie…" : account ? "Zapisz i sprawdź ponownie" : "Zapisz i sprawdź połączenie"}
              </button>
              {account && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void remove()}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  Usuń skrzynkę
                </button>
              )}
            </div>
          </div>

          <p className="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-400">
            Hasło jest zapisywane w zaszyfrowanym magazynie bazy danych i nigdy nie wraca do przeglądarki.
            Właściciel firmy widzi jedynie, czy Twoja skrzynka jest podłączona — nie ma dostępu do hasła.
          </p>
        </section>
      )}
    </div>
  );
}
