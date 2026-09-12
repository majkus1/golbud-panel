"use client";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
  variant?: "default" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Potwierdź",
  cancelLabel = "Anuluj",
  showCancel = true,
  variant = "default",
  loading = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  if (!open) return null;

  const confirmClass =
    variant === "danger"
      ? "bg-rose-700 text-white hover:bg-rose-800"
      : "bg-ink text-white hover:bg-moss";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 px-4 py-6">
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-panel">
        <h2 id="confirm-dialog-title" className="text-lg font-bold text-ink">
          {title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-steel">{message}</p>
        <div className="mt-6 grid gap-2 sm:flex sm:justify-end">
          {showCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="rounded-md border border-stone-300 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-100 disabled:opacity-60"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${confirmClass}`}
          >
            {loading ? "Proszę czekać..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
