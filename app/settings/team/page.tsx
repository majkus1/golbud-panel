"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { showToast } from "@/components/toast";
import { AuthGate } from "@/components/auth-gate";
import { useOrg } from "@/components/org-context";
import { InfoTip } from "@/components/info-tip";
import { postAuthenticatedJson } from "@/lib/authed-fetch";
import { MEMBER_ROLE_LABELS, MEMBER_ROLES } from "@/lib/domain";
import { defaultNotificationPrefsForRole, NOTIFICATION_HELP, type UserNotificationPrefs } from "@/lib/notification-prefs";
import { supabase } from "@/lib/supabase";
import {
  prefsFromMember,
  prefsToDbRow,
  resetPrefsForRole,
  TeamMemberNotificationPrefs
} from "@/components/team-member-notification-prefs";
import type { DigestEmailPref, MemberRole, OrgMemberProfile } from "@/lib/types";

export default function TeamSettingsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <Team />
        </AppShell>
      )}
    </AuthGate>
  );
}

function Team() {
  const { organizationId, role, userId } = useOrg();
  const isOwner = role === "owner";
  const [members, setMembers] = useState<OrgMemberProfile[]>([]);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, UserNotificationPrefs>>({});
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<MemberRole>("sales");
  const [busy, setBusy] = useState(false);
  const [digestBusy, setDigestBusy] = useState<string | null>(null);
  const [digestError, setDigestError] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState<string | null>(null);

  const ownerCount = useMemo(() => members.filter((m) => m.role === "owner").length, [members]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setDigestError(null);
    const [{ data }, prefResult] = await Promise.all([
      supabase.from("org_member_profiles").select("*").eq("organization_id", organizationId).order("role").order("email"),
      isOwner
        ? supabase.from("digest_email_prefs").select("*").eq("organization_id", organizationId)
        : Promise.resolve({ data: [] as DigestEmailPref[] | null, error: null })
    ]);
    const mems = (data || []) as OrgMemberProfile[];
    setMembers(mems);

    if (!isOwner) {
      setNotifPrefs({});
      setLoading(false);
      return;
    }

    const { data: prefData, error: prefErr } = prefResult;
    if (prefErr) {
      setDigestError(
        prefErr.message.includes("relation") || prefErr.code === "42P01"
          ? "Brak tabeli w bazie \u2014 administrator musi uruchomi\u0107 migracj\u0119 powiadomie\u0144 (plik SQL z projektu)."
          : prefErr.message
      );
      setNotifPrefs({});
    } else {
      const prefs = (prefData || []) as DigestEmailPref[];
      const map: Record<string, UserNotificationPrefs> = {};
      for (const m of mems) {
        const row = prefs.find((p) => p.user_id === m.user_id);
        map[m.user_id] = prefsFromMember(m, row);
      }
      setNotifPrefs(map);
    }
    setLoading(false);
  }, [organizationId, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  const inviteOrUpdate = async () => {
    if (!email.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_member_role", { target_email: email.trim(), target_role: newRole });
    setBusy(false);
    if (error) {
      showToast("Nie udało się — użytkownik musi się najpierw zarejestrować w aplikacji. " + error.message, "error");
      return;
    }
    setEmail("");
    showToast("Zapisano dostęp");
    await load();
  };

  const changeRole = async (m: OrgMemberProfile, value: MemberRole) => {
    if (!m.email) return;
    const { error } = await supabase.rpc("set_member_role", { target_email: m.email, target_role: value });
    if (error) {
      showToast("Nie udało się zmienić roli: " + error.message, "error");
      return;
    }
    showToast("Rola zmieniona");
    await load();
  };

  const removeMember = async (m: OrgMemberProfile) => {
    if (m.user_id === userId) return;
    const label = m.email || "tego u\u017cytkownika";
    if (
      !window.confirm(
        `Usun\u0105\u0107 ${label} z firmy?\n\nTa osoba straci dost\u0119p do spraw i danych w tym panelu. Konto logowania nadal istnieje \u2014 mo\u017cna j\u0105 ponownie doda\u0107 mailem poni\u017cej.`
      )
    ) {
      return;
    }
    setRemoveBusy(m.user_id);
    const { error } = await supabase.rpc("remove_organization_member", { target_user: m.user_id });
    setRemoveBusy(null);
    if (error) {
      showToast("Nie udało się usunąć: " + error.message, "error");
      return;
    }
    showToast("Usunięto z firmy");
    await load();
  };

  const saveNotifPrefs = async (uid: string) => {
    if (!organizationId) return;
    const prefs = notifPrefs[uid];
    if (!prefs) return;
    setDigestBusy(uid);
    setDigestError(null);
    const { error } = await supabase
      .from("digest_email_prefs")
      .upsert(prefsToDbRow(organizationId, uid, prefs), { onConflict: "organization_id,user_id" });
    setDigestBusy(null);
    if (error) {
      showToast("Nie udało się zapisać", "error");
      return;
    }
    showToast("Zapisano powiadomienia");
    await load();
  };

  if (!organizationId) return null;

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Ustawienia</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Zespół i role</h1>
        <p className="mt-2 text-sm text-steel">
          Właściciel widzi wszystko. Biuro i kierownik mogą zarządzać podwykonawcami i zadaniami zespołu. Handlowiec widzi tylko swoje zadania.
        </p>
      </div>

      {isOwner && (
        <section className="grid gap-3 rounded-lg bg-white p-5 shadow-panel">
          <h2 className="text-lg font-bold text-ink">Dodaj osobę do firmy</h2>
          <p className="text-xs text-steel">
            Osoba musi wcześniej założyć konto (wejść na logowanie i się zarejestrować). Tu nadajesz jej dostęp do tych samych spraw co reszta zespołu.
          </p>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <input
              type="email"
              className="input sm:max-w-xs"
              placeholder="E-mail osoby z konta"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select className="input sm:max-w-xs" value={newRole} onChange={(e) => setNewRole(e.target.value as MemberRole)}>
              {MEMBER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {MEMBER_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void inviteOrUpdate()}
              disabled={busy || !email.trim()}
              className="w-full rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50 sm:w-auto"
            >
              {busy ? "Zapisywanie\u2026" : "Dodaj / zapisz rol\u0119"}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-lg bg-white p-5 shadow-panel">
        <h2 className="text-lg font-bold text-ink">Kto ma dostęp</h2>
        {loading ? (
          <p className="mt-3 text-sm text-steel">Wczytywanie\u2026</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {members.map((m) => {
              const soleOwnerTarget = m.role === "owner" && ownerCount <= 1;
              const canRemove = isOwner && m.user_id !== userId && !soleOwnerTarget;
              return (
                <li key={m.user_id} className="grid gap-2 py-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{m.email || "(brak e-mailu w koncie)"}</p>
                    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide ${m.role === "owner" ? "bg-moss/12 text-moss-dark" : "bg-stone-100 text-stone-600"}`}>
                      {MEMBER_ROLE_LABELS[m.role]}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isOwner ? (
                      <>
                        <select
                          className="input py-1 text-xs"
                          value={m.role}
                          onChange={(e) => void changeRole(m, e.target.value as MemberRole)}
                        >
                          {MEMBER_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {MEMBER_ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                        {canRemove ? (
                          <button
                            type="button"
                            disabled={removeBusy === m.user_id}
                            onClick={() => void removeMember(m)}
                            className="rounded-md border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            {removeBusy === m.user_id ? "Usuwanie\u2026" : "Usu\u0144 z firmy"}
                          </button>
                        ) : isOwner && m.user_id === userId ? (
                          <span className="text-xs text-steel">To Ty</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-xs text-steel">{MEMBER_ROLE_LABELS[m.role]}</span>
                    )}
                  </div>
                </li>
              );
            })}
            {members.length === 0 && <li className="py-4 text-steel">Brak osób na liście.</li>}
          </ul>
        )}
      </section>

      {isOwner && (
        <section className="grid gap-3 rounded-lg bg-white p-5 shadow-panel">
          <h2 className="inline-flex items-center gap-2 text-lg font-bold text-ink">
            Powiadomienia e-mail
            <InfoTip text={NOTIFICATION_HELP.sectionTitle} />
          </h2>
          <p className="text-sm text-steel">
            Wybierz, kto i co dostaje mailem. Kliknij <span className="font-semibold">i</span> przy opcji, jeśli potrzebujesz krótkiego wyjaśnienia.
          </p>
          <TestEmailButton organizationId={organizationId} />
          {digestError && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {digestError}
            </p>
          )}
          {loading ? (
            <p className="text-sm text-steel">Wczytywanie…</p>
          ) : (
            <ul className="grid gap-3">
              {members.map((m) => {
                const prefs = notifPrefs[m.user_id] ?? defaultNotificationPrefsForRole(m.role);
                return (
                  <TeamMemberNotificationPrefs
                    key={`notif-${m.user_id}`}
                    member={m}
                    prefs={prefs}
                    busy={digestBusy === m.user_id}
                    onChange={(next) => setNotifPrefs((prev) => ({ ...prev, [m.user_id]: next }))}
                    onSave={() => void saveNotifPrefs(m.user_id)}
                    onResetRoleDefaults={() =>
                      setNotifPrefs((prev) => ({
                        ...prev,
                        [m.user_id]: resetPrefsForRole(m.role, prefs.digest_enabled)
                      }))
                    }
                  />
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Testowa wysyłka na własny adres — jedno kliknięcie zamiast grzebania w logach Vercela.
 *
 * Poranny digest przestał przychodzić i nie dało się tego sprawdzić: cron raportował sukces,
 * a na darmowym planie logi z 5:00 znikają po godzinie. Ten sam transport SMTP obsługuje
 * digest, powiadomienia i faktury, więc jeśli testowy mail dojdzie, dojdą też pozostałe;
 * jeśli nie — przyczyna jest na ekranie, dokładnie tak jak przy wysyłce faktury.
 */
function TestEmailButton({ organizationId }: { organizationId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy(true);
    setResult(null);
    const res = await postAuthenticatedJson<{ to: string; from: string }>("/api/notifications/test-email", { organizationId });
    setBusy(false);
    if (!res.ok) {
      setResult({ ok: false, text: res.error });
      return;
    }
    setResult({ ok: true, text: `Wysłano na ${res.data.to} z adresu ${res.data.from}. Sprawdź skrzynkę — także folder Spam.` });
  };

  return (
    <div className="grid gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-3 sm:flex sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">Sprawdź, czy poczta z panelu wychodzi</p>
        <p className="text-xs text-steel">Wyśle testową wiadomość na Twój adres tym samym połączeniem, z którego korzysta poranne podsumowanie i powiadomienia.</p>
        {result && (
          <p className={`mt-1 text-xs ${result.ok ? "text-emerald-700" : "text-rose-700"}`} role="status">
            {result.text}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void send()}
        disabled={busy}
        className="shrink-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-stone-100 disabled:opacity-50"
      >
        {busy ? "Wysyłam…" : "Wyślij testowy e-mail"}
      </button>
    </div>
  );
}
