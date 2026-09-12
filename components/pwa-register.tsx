"use client";

import { useEffect } from "react";

/** Rejestracja service workera (PWA + push). */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => {
      console.warn("[pwa] service worker registration failed", e);
    });
  }, []);
  return null;
}
