"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Domyślnie „danger” — hook służy głównie do potwierdzania usuwania. */
  variant?: "default" | "danger";
};

/**
 * Potwierdzenie w oknie programu zamiast `window.confirm`.
 *
 * Dawid zgłaszał, że pozycje kosztorysu, etapy harmonogramu i pliki znikały po jednym
 * kliknięciu. Hook pozwala dopisać pytanie jedną linijką w miejscu usuwania:
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title: "Usunąć pozycję?", message: "…" }))) return;
 *   …
 *   return <>{…}{confirmDialog}</>;
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; confirmDialog: ReactNode } {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    // Poprzednie, niezamknięte pytanie traktujemy jak anulowane.
    resolverRef.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirmDialog = options ? (
    <ConfirmDialog
      open
      title={options.title}
      message={options.message}
      confirmLabel={options.confirmLabel ?? "Usuń"}
      variant={options.variant ?? "danger"}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, confirmDialog };
}
