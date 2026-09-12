"use client";

import { useEffect, useState } from "react";

type ToastItem = { id: number; message: string; type: "success" | "error" };

const listeners = new Set<(t: ToastItem) => void>();
let counter = 0;

export function showToast(message: string, type: "success" | "error" = "success") {
  const item: ToastItem = { id: ++counter, message, type };
  listeners.forEach((fn) => fn(item));
}

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, 2500);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 grid gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-lg ${
            t.type === "success" ? "bg-emerald-600" : "bg-rose-600"
          }`}
        >
          <span>{t.type === "success" ? "✓" : "✗"}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
