"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  IconClearFormat,
  IconLink,
  IconListBullet,
  IconListNumber,
  IconPaperclip
} from "@/components/case/mail-icons";
import { showToast } from "@/components/toast";

/**
 * Prosty edytor wiadomości: pogrubienie, kursywa, listy i odnośnik, plus załączniki.
 *
 * Świadomie bez zewnętrznej biblioteki edytora — potrzebujemy czterech opcji formatowania,
 * a nie procesora tekstu. HTML z tego pola i tak jest ponownie czyszczony na serwerze,
 * więc nie jest źródłem zaufanej treści.
 */

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;

export type ComposerPayload = {
  html: string;
  files: File[];
};

type Props = {
  placeholder?: string;
  submitLabel: string;
  sending: boolean;
  onSend: (payload: ComposerPayload) => Promise<void>;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ToolbarButton({
  label,
  title,
  onClick,
  className = ""
}: {
  label: ReactNode;
  title: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // `onMouseDown` z blokadą domyślnego zachowania — inaczej kliknięcie zabrałoby
      // zaznaczenie z pola i formatowanie nie miałoby na czym zadziałać.
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-sm text-steel transition hover:bg-stone-200 hover:text-ink ${className}`}
    >
      {label}
    </button>
  );
}

export function MailComposer({ placeholder, submitLabel, sending, onSend }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [empty, setEmpty] = useState(true);

  const exec = useCallback((command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setEmpty(!editorRef.current?.textContent?.trim());
  }, []);

  const addLink = () => {
    const url = window.prompt("Adres odnośnika (https://…)");
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      showToast("Adres musi zaczynać się od http:// lub https://", "error");
      return;
    }
    exec("createLink", url);
  };

  const pickFiles = (selected: FileList | null) => {
    if (!selected?.length) return;
    const next = [...files, ...Array.from(selected)];
    if (next.length > MAX_FILES) {
      showToast(`Maksymalnie ${MAX_FILES} załączników`, "error");
      return;
    }
    if (next.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
      showToast("Załączniki nie mogą przekraczać 10 MB", "error");
      return;
    }
    setFiles(next);
  };

  const send = async () => {
    const html = editorRef.current?.innerHTML ?? "";
    if (!editorRef.current?.textContent?.trim()) {
      showToast("Wpisz treść wiadomości", "error");
      return;
    }
    await onSend({ html, files });
    if (editorRef.current) editorRef.current.innerHTML = "";
    setFiles([]);
    setEmpty(true);
  };

  return (
    <div className="grid gap-2 rounded-xl2 border border-stone-200 bg-white p-2">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-stone-100 pb-2">
        <ToolbarButton label="B" title="Pogrubienie" onClick={() => exec("bold")} className="font-bold" />
        <ToolbarButton label="I" title="Kursywa" onClick={() => exec("italic")} className="italic" />
        <ToolbarButton label="U" title="Podkreślenie" onClick={() => exec("underline")} className="underline" />
        <span className="mx-1 h-5 w-px bg-stone-200" aria-hidden />
        <ToolbarButton label={<IconListBullet />} title="Lista punktowana" onClick={() => exec("insertUnorderedList")} />
        <ToolbarButton label={<IconListNumber />} title="Lista numerowana" onClick={() => exec("insertOrderedList")} />
        <span className="mx-1 h-5 w-px bg-stone-200" aria-hidden />
        <ToolbarButton label={<IconLink />} title="Wstaw odnośnik" onClick={addLink} />
        <ToolbarButton label={<IconClearFormat />} title="Usuń formatowanie" onClick={() => exec("removeFormat")} />
        <span className="mx-1 h-5 w-px bg-stone-200" aria-hidden />
        <ToolbarButton label={<IconPaperclip />} title="Dodaj załącznik" onClick={() => fileRef.current?.click()} />
      </div>

      <div className="relative">
        {empty && placeholder && (
          <span className="pointer-events-none absolute left-2 top-2 text-sm text-stone-400">{placeholder}</span>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Treść wiadomości"
          onInput={() => setEmpty(!editorRef.current?.textContent?.trim())}
          // Wklejanie jako czysty tekst — inaczej do wiadomości trafiłby obcy HTML
          // ze stylami i znacznikami skopiowanymi ze strony internetowej.
          onPaste={(event) => {
            event.preventDefault();
            const plain = event.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, plain);
          }}
          className="min-h-28 w-full rounded-lg px-2 py-2 text-sm text-ink outline-none [&_a]:text-moss [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc"
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          pickFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs"
            >
              <span className="truncate text-ink">{file.name}</span>
              <span className="shrink-0 text-stone-400">{formatBytes(file.size)}</span>
              <button
                type="button"
                aria-label={`Usuń załącznik ${file.name}`}
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                className="shrink-0 text-stone-400 hover:text-rose-500"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={sending}
          onClick={() => void send()}
          className="rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white hover:bg-moss disabled:opacity-50"
        >
          {sending ? "Wysyłam…" : submitLabel}
        </button>
        {files.length > 0 && (
          <span className="text-xs text-stone-400">
            {files.length} {files.length === 1 ? "plik" : "plików"} ·{" "}
            {formatBytes(files.reduce((sum, file) => sum + file.size, 0))}
          </span>
        )}
      </div>
    </div>
  );
}
