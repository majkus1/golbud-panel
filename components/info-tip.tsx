"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  /** Krótka, przystępna podpowiedź — bez żargonu technicznego. */
  text: string;
  className?: string;
};

const VIEWPORT_MARGIN = 12;
const TIP_MAX_WIDTH = 288;

type TipPosition = { top: number; left: number; width: number };

function computePosition(anchor: DOMRect, tipHeight: number): TipPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(TIP_MAX_WIDTH, vw - VIEWPORT_MARGIN * 2);

  // Na wąskich ekranach wyśrodkuj względem viewportu — zawsze mieści się w ekranie.
  let left =
    vw < 640 ? (vw - width) / 2 : anchor.left + anchor.width / 2 - width / 2;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - width - VIEWPORT_MARGIN));

  let top = anchor.bottom + 8;
  if (top + tipHeight > vh - VIEWPORT_MARGIN) {
    top = anchor.top - tipHeight - 8;
  }
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - tipHeight - VIEWPORT_MARGIN));

  return { top, left, width };
}

export function InfoTip({ text, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TipPosition | null>(null);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();

  useEffect(() => setMounted(true), []);

  const updatePosition = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const tipHeight = tipRef.current?.offsetHeight ?? 96;
    setPos(computePosition(btn.getBoundingClientRect(), tipHeight));
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(raf);
  }, [open, text]);

  useEffect(() => {
    if (!open) return;
    const onReposition = () => updatePosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (tipRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const tooltip =
    open && mounted
      ? createPortal(
          <span
            ref={tipRef}
            id={tipId}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? VIEWPORT_MARGIN,
              width: pos?.width ?? Math.min(TIP_MAX_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2),
              zIndex: 9999,
              visibility: pos ? "visible" : "hidden"
            }}
            className="pointer-events-none rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-left text-xs leading-relaxed text-ink shadow-panel"
          >
            {text}
          </span>,
          document.body
        )
      : null;

  return (
    <>
      <span className={`relative inline-flex align-middle ${className}`}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen(true)}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          aria-expanded={open}
          aria-describedby={open ? tipId : undefined}
          aria-label="Pokaż wyjaśnienie"
          className="flex size-5 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white text-[0.65rem] font-bold leading-none text-steel transition hover:border-moss/50 hover:bg-moss/10 hover:text-moss focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-moss"
        >
          ?
        </button>
      </span>
      {tooltip}
    </>
  );
}
