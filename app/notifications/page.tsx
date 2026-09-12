"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { PushNotificationSettings } from "@/components/push-notification-settings";
import { NotificationListItem } from "@/components/notifications-provider";
import { useOrg } from "@/components/org-context";
import { supabase } from "@/lib/supabase";
import type { UserNotification } from "@/lib/types";

export default function NotificationsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <NotificationsList />
        </AppShell>
      )}
    </AuthGate>
  );
}

function NotificationsList() {
  const { userId } = useOrg();
  const [items, setItems] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await supabase
      .from("user_notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    setItems((data || []) as UserNotification[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (id: string) => {
    const now = new Date().toISOString();
    await supabase.from("user_notifications").update({ read_at: now }).eq("id", id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: now } : n)));
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    await supabase.from("user_notifications").update({ read_at: now }).eq("user_id", userId).is("read_at", null);
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
  };

  const unread = items.filter((n) => !n.read_at).length;

  return (
    <div className="min-w-0 w-full max-w-2xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Centrum</p>
          <h1 className="mt-1 text-2xl font-bold text-ink">Powiadomienia</h1>
          <p className="mt-2 text-sm text-steel">
            Historia zdarzeń z panelu — każde powiadomienie pojawia się raz, gdy coś się dzieje.
          </p>
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-stone-50"
          >
            Oznacz wszystkie jako przeczytane
          </button>
        )}
      </div>

      <div className="mt-6">
        <PushNotificationSettings />
      </div>

      <section className="mt-6 rounded-xl2 border border-stone-200 bg-white shadow-card">
        {loading ? (
          <p className="p-8 text-center text-sm text-steel">Wczytywanie…</p>
        ) : items.length === 0 ? (
          <p className="p-8 text-center text-sm text-steel">Nie masz jeszcze powiadomień.</p>
        ) : (
          <ul className="divide-y divide-stone-100 p-2">
            {items.map((n) => (
              <li key={n.id}>
                <NotificationListItem item={n} onRead={markRead} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
