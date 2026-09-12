"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NotificationListItem, useNotifications } from "@/components/notifications-provider";

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}

type NotificationBellProps = {
  /** Wyrównanie panelu — `start` gdy dzwoneczek jest po lewej (mobile). */
  menuAlign?: "start" | "end";
  /** Kierunek rozwijania — `above` gdy dzwoneczek jest przy dolnej krawędzi (sidebar). */
  menuPlacement?: "below" | "above";
};

export function NotificationBell({ menuAlign = "end", menuPlacement = "below" }: NotificationBellProps) {
  const { unreadCount, recent, loading, markRead, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void refresh();
        }}
        aria-label={unreadCount > 0 ? `Powiadomienia, ${unreadCount} nieprzeczytanych` : "Powiadomienia"}
        aria-expanded={open}
        className={`relative inline-flex h-10 w-10 items-center justify-center rounded-lg border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:h-8 lg:w-8 lg:rounded-md ${
          unreadCount > 0
            ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
            : "border-stone-300 text-steel hover:bg-stone-100 hover:text-ink"
        }`}
      >
        <BellIcon className="lg:size-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[0.6rem] font-bold leading-none text-white lg:min-h-[15px] lg:min-w-[15px] lg:text-[0.55rem]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`z-50 rounded-xl2 border border-stone-200 bg-white shadow-panel
            fixed left-4 right-4 top-[4.25rem] w-auto max-h-[min(32rem,calc(100dvh-5rem))]
            lg:absolute lg:top-full lg:mt-2 lg:max-h-none lg:w-[min(22rem,calc(100vw-2rem))]
            ${menuPlacement === "above" ? "lg:bottom-full lg:top-auto lg:mb-2 lg:mt-0" : ""}
            ${menuAlign === "start" ? "lg:left-0 lg:right-auto" : "lg:right-0 lg:left-auto"}`}
        >
          <div className="flex max-h-[inherit] flex-col">
          <div className="flex shrink-0 items-center justify-between overflow-visible border-b border-stone-100 px-4 py-3">
            <span className="text-sm font-bold text-ink">Powiadomienia</span>
            <Link href="/notifications" onClick={() => setOpen(false)} className="text-xs font-semibold text-moss hover:underline">
              Wszystkie
            </Link>
          </div>

          <div className="border-b border-stone-100 bg-stone-50 px-4 py-2.5">
            <Link href="/notifications" onClick={() => setOpen(false)} className="text-xs font-semibold text-moss hover:underline">
              Ustawienia push i historia →
            </Link>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2 lg:max-h-80">
            {loading ? (
              <p className="px-3 py-6 text-center text-sm text-steel">Wczytywanie…</p>
            ) : recent.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-steel">Brak powiadomień. Gdy coś ważnego się wydarzy, zobaczysz to tutaj.</p>
            ) : (
              <ul className="space-y-0.5">
                {recent.map((n) => (
                  <li key={n.id}>
                    <NotificationListItem
                      item={n}
                      onRead={(id) => {
                        void markRead(id);
                        setOpen(false);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
