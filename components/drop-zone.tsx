"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * Pole „przeciągnij plik albo kliknij”. Na telefonie działa jak zwykły wybór pliku
 * (aparat albo galeria), na komputerze przyjmuje plik upuszczony z pulpitu lub maila.
 */
export function DropZone({
  onFile,
  accept,
  busy = false,
  disabled = false,
  label = "Przeciągnij plik tutaj albo kliknij, żeby wybrać",
  hint,
  children
}: {
  onFile: (file: File) => void | Promise<void>;
  accept?: string;
  busy?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const inactive = busy || disabled;

  const take = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file && !inactive) void onFile(file);
  };

  return (
    <div
      role="button"
      tabIndex={inactive ? -1 : 0}
      aria-disabled={inactive}
      onClick={() => !inactive && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !inactive) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!inactive) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer?.files);
      }}
      className={`flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl2 border-2 border-dashed px-4 py-4 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
        over ? "border-moss bg-moss/10" : "border-stone-300 bg-stone-50 hover:border-moss/60 hover:bg-moss/5"
      } ${inactive ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span className="text-sm font-semibold text-ink">{busy ? "Wysyłanie…" : label}</span>
      {hint ? <span className="text-xs text-steel">{hint}</span> : null}
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={inactive}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
