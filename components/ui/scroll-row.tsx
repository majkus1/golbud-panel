"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Edges = {
  left: boolean;
  right: boolean;
  thumbLeft: number;
  thumbWidth: number;
};

/**
 * Rząd przycisków przewijany w bok (zakładki karty sprawy, sekcje dokumentacji) — na telefonie.
 *
 * Systemowy pasek przewijania na telefonach jest ukryty albo znika po chwili, więc użytkownik
 * nie wiedział, że za krawędzią są kolejne zakładki. Tu przewijanie widać od razu:
 *  - pod rzędem stale widoczny wskaźnik położenia (własny, działa też na iPhonie),
 *  - przy krawędzi, za którą coś jest, cieniowanie ze strzałką (klik przesuwa rząd),
 *  - element oznaczony `data-active="true"` ustawia się na środku po każdej zmianie `activeKey`.
 * Gdy wszystko się mieści (albo od `sm` rząd się zawija), wskaźniki się nie pokazują.
 */
export function ScrollRow({
  children,
  activeKey,
  className = "",
  outerClassName = "flex-1",
  label
}: {
  children: ReactNode;
  /** Zmiana klucza przewija rząd tak, żeby aktywny element był na środku. */
  activeKey?: string | null;
  /** Klasy rzędu, np. zawijanie od `sm`: „sm:flex-wrap sm:overflow-visible”. */
  className?: string;
  /** Klasy kontenera rzędu (szerokość w układzie rodzica). */
  outerClassName?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges>({
    left: false,
    right: false,
    thumbLeft: 0,
    thumbWidth: 100
  });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const scrollable = el.scrollWidth > el.clientWidth + 1;
    const thumbWidth = scrollable ? (el.clientWidth / el.scrollWidth) * 100 : 100;
    const thumbLeft = scrollable ? (el.scrollLeft / el.scrollWidth) * 100 : 0;
    setEdges({
      left: scrollable && el.scrollLeft > 4,
      right: scrollable && el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      thumbLeft,
      thumbWidth
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [update]);

  useEffect(() => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const active = el.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    const target = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [activeKey]);

  const nudge = (direction: -1 | 1) => {
    const el = ref.current;
    if (el)
      el.scrollBy({
        left: direction * el.clientWidth * 0.6,
        behavior: "smooth"
      });
  };

  const scrollable = edges.left || edges.right;

  return (
    <div className={`min-w-0 ${outerClassName}`}>
      <div className="relative min-w-0">
        <div
          ref={ref}
          role={label ? "group" : undefined}
          aria-label={label}
          className={`relative flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${className}`}
        >
          {children}
        </div>
        {edges.left && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => nudge(-1)}
            className="absolute inset-y-0 left-0 flex w-9 items-center justify-start bg-gradient-to-r from-concrete via-concrete/90 to-transparent pl-0.5 text-lg font-bold text-ink/70"
          >
            ‹
          </button>
        )}
        {edges.right && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => nudge(1)}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-end bg-gradient-to-l from-concrete via-concrete/90 to-transparent pr-0.5 text-lg font-bold text-ink/70"
          >
            ›
          </button>
        )}
      </div>
      {scrollable && (
        <div className="mt-1.5 h-1 rounded-full bg-stone-300/60" aria-hidden>
          <div
            className="h-1 rounded-full bg-stone-500/70 transition-[margin]"
            style={{
              width: `${edges.thumbWidth}%`,
              marginLeft: `${edges.thumbLeft}%`
            }}
          />
        </div>
      )}
    </div>
  );
}
