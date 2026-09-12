"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useOrg } from "@/components/org-context";
import { resolveTaskCommentNotificationHref } from "@/lib/notification-links";
import { supabase } from "@/lib/supabase";
import type { UserNotification } from "@/lib/types";

type Ctx = {
  unreadCount: number;
  recent: UserNotification[];
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationsContext = createContext<Ctx | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { userId, organizationId } = useOrg();
  const [recent, setRecent] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [{ data: list }, { count }] = await Promise.all([
      supabase
        .from("user_notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("user_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null)
    ]);
    setRecent((list || []) as UserNotification[]);
    setUnreadCount(count ?? 0);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId || !organizationId) return;
    const channel = supabase
      .channel(`user-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          const row = payload.new as UserNotification;
          setRecent((prev) => [row, ...prev.filter((x) => x.id !== row.id)].slice(0, 8));
          setUnreadCount((c) => c + 1);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, organizationId]);

  const markRead = useCallback(
    async (id: string) => {
      const now = new Date().toISOString();
      await supabase.from("user_notifications").update({ read_at: now }).eq("id", id).eq("user_id", userId);
      setRecent((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: now } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    },
    [userId]
  );

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    await supabase.from("user_notifications").update({ read_at: now }).eq("user_id", userId).is("read_at", null);
    setRecent((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    setUnreadCount(0);
  }, [userId]);

  const value = useMemo(
    () => ({ unreadCount, recent, loading, refresh, markRead, markAllRead }),
    [unreadCount, recent, loading, refresh, markRead, markAllRead]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications wymaga NotificationsProvider");
  return ctx;
}

export function formatNotificationTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

export function NotificationListItem({
  item,
  onRead
}: {
  item: UserNotification;
  onRead?: (id: string) => void;
}) {
  const router = useRouter();
  const unread = !item.read_at;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (item.type !== "task_comment") {
      if (unread && onRead) void onRead(item.id);
      return;
    }

    e.preventDefault();
    if (unread && onRead) void onRead(item.id);
    void resolveTaskCommentNotificationHref(item).then((href) => router.push(href));
  };

  const href = item.type === "task_comment" && !item.href.includes("task=") ? "#" : item.href;

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={`block rounded-lg px-3 py-2.5 transition hover:bg-stone-50 ${unread ? "bg-moss/5" : ""}`}
    >
      <p className={`text-sm leading-snug ${unread ? "font-semibold text-ink" : "text-steel"}`}>{item.title}</p>
      {item.body && <p className="mt-0.5 line-clamp-2 text-xs text-steel">{item.body}</p>}
      <p className="mt-1 text-[0.65rem] text-stone-400">{formatNotificationTime(item.created_at)}</p>
    </Link>
  );
}
