"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { NotificationBell } from "@/components/notification-bell";
import { NotificationsProvider, useNotifications } from "@/components/notifications-provider";
import { ToastContainer } from "@/components/toast";
import { useOrg } from "@/components/org-context";
import { canManageOrg, canViewPayroll } from "@/components/org-context";
import { supabase } from "@/lib/supabase";
import type { MemberRole } from "@/lib/types";

/** `roles` = role NIE-zarządcze, które widzą pozycję. Brak `roles` = widoczne dla wszystkich.
 *  Role zarządcze (owner/office/manager) widzą zawsze wszystko. */
type NavItem = { href: string; label: string; roles?: MemberRole[] };

type NavGroup = {
  title: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    title: "Praca",
    items: [
      { href: "/", label: "Dashboard" },
      { href: "/board", label: "Tablica", roles: ["sales"] },
      { href: "/cases?preset=realizacja", label: "W trakcie realizacji", roles: ["sales", "brygadzista", "podwykonawca", "member"] },
      { href: "/cases", label: "Zlecenia", roles: ["owner", "office", "sales", "manager"] },
      { href: "/cases/new", label: "Nowe zlecenie", roles: ["owner", "office", "sales", "manager"] },
      { href: "/tasks", label: "Zadania pracowników" },
      { href: "/notifications", label: "Powiadomienia" },
      { href: "/calendar", label: "Kalendarz" },
      { href: "/assistant", label: "Asystent AI", roles: ["sales", "brygadzista"] },
      { href: "/time", label: "Czas pracy", roles: ["brygadzista"] },
    ]
  },
  {
    title: "Zasoby",
    items: [
      { href: "/reports", label: "Raporty", roles: [] },
      { href: "/reports/profitability", label: "Rentowność budów", roles: [] },
      { href: "/settlements/employees", label: "Rozliczenia pracowników", roles: [] },
      { href: "/vehicles", label: "Samochody", roles: [] },
      { href: "/policies", label: "Polisy firmowe", roles: [] },
      { href: "/warehouse", label: "Magazyn", roles: ["brygadzista", "member"] },
      { href: "/equipment", label: "Sprzęt / rusztowania", roles: ["brygadzista", "member"] }
    ]
  },
  {
    title: "Kontrola",
    items: [
      { href: "/hr", label: "Kadry i dokumenty", roles: [] },
      { href: "/activity", label: "Dziennik zmian", roles: [] }
    ]
  },
  {
    title: "Ustawienia",
    items: [
      { href: "/settings/dictionaries", label: "Słowniki", roles: [] },
      { href: "/settings/organization", label: "Struktura firmy", roles: [] },
      { href: "/settings/subcontractors", label: "Podwykonawcy", roles: [] },
      { href: "/settings/catalog", label: "Katalog pozycji", roles: [] },
      { href: "/settings/company", label: "Firma", roles: [] },
      { href: "/settings/team", label: "Zespół i role", roles: [] },
      // Ustawienie osobiste, nie firmowe — handlowiec też musi mieć tu dostęp.
      { href: "/settings/mail", label: "Moja poczta", roles: ["sales"] }
    ]
  }
];

function isItemVisible(role: MemberRole | null, item: NavItem): boolean {
  if (item.href === "/settlements/employees") return canViewPayroll(role);
  if (canManageOrg(role)) return true;
  if (!item.roles) return true;
  return role != null && item.roles.includes(role);
}

function visibleNavGroups(role: MemberRole | null): NavGroup[] {
  return navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => isItemVisible(role, i)) }))
    .filter((g) => g.items.length > 0);
}

function parseNavHref(href: string): { path: string; preset: string | null } {
  const [path, qs] = href.split("?");
  return { path, preset: qs ? new URLSearchParams(qs).get("preset") : null };
}

/** Presety /cases z własną pozycją w menu — „Zlecenia” nie jest aktywne, gdy któryś z nich jest w URL. */
function navCasePresets(): string[] {
  return navGroups
    .flatMap((g) => g.items)
    .map((item) => parseNavHref(item.href).preset)
    .filter((p): p is string => p !== null);
}

function isNavActive(pathname: string, searchParams: URLSearchParams, href: string): boolean {
  const { path, preset: hrefPreset } = parseNavHref(href);
  const currentPreset = searchParams.get("preset");

  if (path === "/") return pathname === "/";
  if (path === "/notifications") return pathname === "/notifications";
  if (path === "/activity") return pathname === "/activity";
  if (path === "/assistant") return pathname === "/assistant";
  if (path === "/cases/new") return pathname === "/cases/new";

  if (path === "/cases") {
    if (pathname === "/cases/new") return false;
    if (!pathname.startsWith("/cases")) return false;

    if (hrefPreset) {
      return pathname === "/cases" && currentPreset === hrefPreset;
    }

    if (pathname !== "/cases") {
      return true;
    }

    if (currentPreset && navCasePresets().includes(currentPreset)) {
      return false;
    }
    return true;
  }

  if (path.startsWith("/settings")) return pathname.startsWith(path);
  return pathname === path || pathname.startsWith(`${path}/`);
}

function navLinkClass(active: boolean): string {
  if (active) return "bg-ink text-white";
  return "text-steel hover:bg-stone-100 hover:text-ink";
}

function AiNavGlyph({ active }: { active: boolean }) {
  return (
    <span
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[0.65rem] font-black tracking-[0.14em] shadow-sm ${
        active ? "bg-amberline text-ink" : "bg-ink text-amberline"
      }`}
      aria-hidden="true"
    >
      AI
    </span>
  );
}

function NavLinkItem({
  item,
  pathname,
  searchParams,
  onNavigate
}: {
  item: NavItem;
  pathname: string;
  searchParams: URLSearchParams;
  onNavigate?: () => void;
}) {
  const active = isNavActive(pathname, searchParams, item.href);
  const { unreadCount } = useNotifications();
  const showBadge = item.href === "/notifications" && unreadCount > 0;
  const isAssistant = item.href === "/assistant";

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
        isAssistant
          ? active
            ? "bg-ink text-white shadow-sm"
            : "bg-stone-50 text-ink ring-1 ring-stone-200 hover:bg-ink hover:text-white"
          : navLinkClass(active)
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {isAssistant ? <AiNavGlyph active={active} /> : null}
        <span className={isAssistant ? "grid min-w-0" : ""}>
          <span>{isAssistant ? "GolBud AI" : item.label}</span>
          {isAssistant ? (
            <span
              className={`text-[0.65rem] font-semibold ${active ? "text-white/70" : "text-steel group-hover:text-white/80"}`}
            >
              firmowy asystent
            </span>
          ) : null}
        </span>
      </span>
      {showBadge && (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold leading-none ${
            active ? "bg-white/20 text-white" : "bg-red-500 text-white"
          }`}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );
}

function NavGroups({
  pathname,
  searchParams,
  className,
  onNavigate
}: {
  pathname: string;
  searchParams: URLSearchParams;
  className?: string;
  onNavigate?: () => void;
}) {
  const { role } = useOrg();
  const groups = visibleNavGroups(role);
  return (
    <div className={className}>
      {groups.map((group, index) => (
        <div key={group.title} className={index > 0 ? "mt-6" : ""}>
          <p className="px-3 pb-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-stone-400">
            {group.title}
          </p>
          <ul className="space-y-0.5" role="list">
            {group.items.map((item) => (
              <li key={item.href}>
                <NavLinkItem item={item} pathname={pathname} searchParams={searchParams} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuTriggerRef.current?.focus();
  }, []);

  // Zamknij szufladę po przejściu na inną stronę lub zmianie filtra w URL.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, searchParams]);

  // Zablokuj scroll tła, gdy szuflada jest otwarta.
  useEffect(() => {
    if (!drawerOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [drawerOpen]);

  // Obsługa klawiatury w szufladzie: Escape zamyka, Tab krąży wewnątrz (focus trap).
  useEffect(() => {
    if (!drawerOpen) return;
    const node = drawerRef.current;
    if (!node) return;

    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      );

    focusable()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDrawer();
        return;
      }
      if (e.key === "Tab") {
        const els = focusable();
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, closeDrawer]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <NotificationsProvider>
    <div className="min-h-screen bg-concrete">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Przejdź do treści
      </a>
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-stone-200 bg-white lg:flex">
        <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-4 pt-6">
          <Link href="/" className="inline-block min-w-0">
            <Image
              src="/logo-golbud.png"
              alt="GolBud"
              width={160}
              height={44}
              className="h-auto w-full max-w-[152px]"
              priority
            />
          </Link>
          <NotificationBell menuAlign="start" />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
          <NavGroups pathname={pathname} searchParams={searchParams} />
        </nav>

        <div className="shrink-0 border-t border-stone-200 bg-white px-5 py-4">
          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-stone-100"
          >
            Wyloguj
          </button>
        </div>
      </aside>

      {/* Header mobilny */}
      <header className="sticky top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2 justify-self-start">
          <button
            ref={menuTriggerRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Otwórz menu"
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-stone-300 text-ink hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <MenuIcon />
          </button>
          <NotificationBell menuAlign="start" />
        </div>
        <Link href="/" className="inline-block shrink-0 justify-self-center">
          <Image src="/logo-golbud.png" alt="GolBud" width={120} height={32} className="h-7 w-auto" priority />
        </Link>
        <div className="flex shrink-0 items-center justify-self-end">
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-lg px-2 py-2 text-sm font-semibold text-steel hover:bg-stone-100"
          >
            Wyloguj
          </button>
        </div>
      </header>

      {/* Drawer mobilny */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu główne">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <div ref={drawerRef} className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col border-r border-stone-200 bg-white shadow-panel">
            <div className="flex shrink-0 items-center justify-between border-b border-stone-200 px-5 py-4">
              <Image src="/logo-golbud.png" alt="GolBud" width={120} height={32} className="h-7 w-auto" />
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Zamknij menu"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-stone-300 text-ink hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <CloseIcon />
              </button>
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              <NavGroups pathname={pathname} searchParams={searchParams} onNavigate={() => setDrawerOpen(false)} />
            </nav>
            <div className="shrink-0 border-t border-stone-200 px-4 py-4">
              <button
                type="button"
                onClick={() => void signOut()}
                className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-semibold text-ink hover:bg-stone-100"
              >
                Wyloguj
              </button>
            </div>
          </div>
        </div>
      )}

      <main id="main-content" tabIndex={-1} className="min-w-0 overflow-x-clip focus:outline-none lg:pl-64">
        <div className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 2xl:px-12">{children}</div>
      </main>
      <ToastContainer />
    </div>
    </NotificationsProvider>
  );
}
