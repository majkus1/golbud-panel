"use client";

import { useEffect, useMemo, useState } from "react";
import { DropZone } from "@/components/drop-zone";
import { showToast } from "@/components/toast";
import { useConfirm } from "@/components/use-confirm";
import { UPLOAD_ACCEPT, uploadCaseAttachment, validateUpload } from "@/lib/case-attachments";
import { ATTACHMENT_CATEGORIES } from "@/lib/domain";
import { formatDateOfTimestamp } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Attachment, AttachmentCategory } from "@/lib/types";

/**
 * Lista plików sprawy z dodawaniem przez przeciągnięcie. Ta sama w zakładce Umowa
 * i w każdej sekcji Dokumentacji — różnią się tylko kategoriami, które pokazują i przyjmują.
 */
export function AttachmentList({
  caseId,
  organizationId,
  userId,
  items,
  uploadCategories,
  uploadLabel,
  emptyText = "Brak plików.",
  gallery = false,
  onChange
}: {
  caseId: string;
  organizationId: string;
  userId: string;
  items: Attachment[];
  /** Kategorie do wyboru przy dodawaniu; pusta lista = bez dodawania. */
  uploadCategories: AttachmentCategory[];
  uploadLabel?: string;
  emptyText?: string;
  /** Przełącznik lista / galeria dla zdjęć. */
  gallery?: boolean;
  onChange: () => Promise<void>;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [category, setCategory] = useState<AttachmentCategory | "">(uploadCategories[0] ?? "");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"lista" | "galeria">("lista");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{ url: string; caption: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; category: AttachmentCategory } | null>(null);

  useEffect(() => {
    if (category && !uploadCategories.includes(category)) setCategory(uploadCategories[0] ?? "");
  }, [category, uploadCategories]);

  const isImage = (a: Attachment) => !!a.mime_type && a.mime_type.startsWith("image/");
  const images = useMemo(() => items.filter(isImage), [items]);

  useEffect(() => {
    let active = true;
    const paths = images.map((a) => a.storage_path);
    if (paths.length === 0) {
      setUrls({});
      return;
    }
    void supabase.storage
      .from("case-attachments")
      .createSignedUrls(paths, 3600)
      .then(({ data }) => {
        if (!active || !data) return;
        const map: Record<string, string> = {};
        data.forEach((d, i) => {
          if (d.signedUrl) map[images[i].id] = d.signedUrl;
        });
        setUrls(map);
      });
    return () => {
      active = false;
    };
  }, [images]);

  const upload = async (file: File) => {
    setErr("");
    if (!category) return;
    const invalid = validateUpload(file);
    if (invalid) {
      setErr(invalid);
      return;
    }
    setUploading(true);
    const result = await uploadCaseAttachment(supabase, {
      organizationId,
      caseId,
      userId,
      file,
      fileName: file.name,
      mimeType: file.type,
      category
    });
    setUploading(false);
    if (!result.ok) {
      setErr(result.error);
      return;
    }
    showToast(`Dodano: ${file.name}`);
    await onChange();
  };

  const download = async (a: Attachment) => {
    const { data, error } = await supabase.storage.from("case-attachments").createSignedUrl(a.storage_path, 3600);
    if (error || !data?.signedUrl) {
      showToast("Nie udało się otworzyć pliku", "error");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const saveDescription = async (a: Attachment, value: string) => {
    const next = value.trim() || null;
    if (next === (a.description || null)) return;
    const { error } = await supabase.from("attachments").update({ description: next }).eq("id", a.id);
    if (error) {
      showToast("Nie udało się zapisać opisu", "error");
      return;
    }
    await onChange();
  };

  const saveEdit = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      showToast("Nazwa pliku nie może być pusta", "error");
      return;
    }
    const { error } = await supabase.from("attachments").update({ file_name: name, category: editing.category }).eq("id", editing.id);
    if (error) {
      showToast("Nie udało się zapisać — zmieniać może osoba, która dodała plik, albo prowadzący", "error");
      return;
    }
    setEditing(null);
    showToast("Zapisano");
    await onChange();
  };

  // Najpierw wpis w bazie, potem plik: gdy baza odmówi (uprawnienia), plik zostaje na miejscu.
  const remove = async (a: Attachment) => {
    const ok = await confirm({
      title: "Usunąć plik?",
      message: `„${a.file_name}” zostanie usunięty ze sprawy. Tego nie da się cofnąć.`
    });
    if (!ok) return;
    const { error } = await supabase.from("attachments").delete().eq("id", a.id);
    if (error) {
      showToast("Nie udało się usunąć pliku", "error");
      return;
    }
    await supabase.storage.from("case-attachments").remove([a.storage_path]);
    showToast("Usunięto plik");
    await onChange();
  };

  return (
    <div className="grid min-w-0 gap-3">
      {uploadCategories.length > 0 && (
        <div className="grid gap-2">
          {uploadCategories.length > 1 && (
            <label className="flex flex-wrap items-center gap-2 text-xs font-semibold text-steel">
              Rodzaj pliku
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as AttachmentCategory)}
                className="input w-auto py-1.5 text-sm"
              >
                {uploadCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <DropZone
            onFile={upload}
            accept={UPLOAD_ACCEPT}
            busy={uploading}
            label={uploadLabel ?? "Przeciągnij plik tutaj albo kliknij, żeby wybrać"}
            hint="PDF, zdjęcie lub skan · do 15 MB"
          />
          {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
        </div>
      )}

      {gallery && images.length > 0 && (
        <div className="inline-flex w-fit overflow-hidden rounded-lg border border-stone-300 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setView("lista")}
            className={`px-3 py-1.5 ${view === "lista" ? "bg-ink text-white" : "bg-white text-steel hover:bg-stone-50"}`}
          >
            Lista
          </button>
          <button
            type="button"
            onClick={() => setView("galeria")}
            className={`px-3 py-1.5 ${view === "galeria" ? "bg-ink text-white" : "bg-white text-steel hover:bg-stone-50"}`}
          >
            Galeria ({images.length})
          </button>
        </div>
      )}

      {gallery && view === "galeria" && images.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((a) => (
            <figure key={a.id} className="overflow-hidden rounded-xl2 border border-stone-200 bg-white shadow-card">
              <button
                type="button"
                onClick={() => urls[a.id] && setLightbox({ url: urls[a.id], caption: a.description || a.file_name })}
                className="block aspect-square w-full overflow-hidden bg-stone-100"
              >
                {urls[a.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[a.id]} alt={a.description || a.file_name} className="h-full w-full object-cover transition hover:scale-105" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-stone-300">…</span>
                )}
              </button>
              <figcaption className="p-2">
                <span className="inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[0.65rem] font-medium text-steel">{a.category}</span>
                <textarea
                  key={`desc-${a.id}-${a.description ?? ""}`}
                  className="input mt-1.5 min-h-[40px] w-full py-1 text-xs font-normal"
                  placeholder="Opis zdjęcia…"
                  defaultValue={a.description || ""}
                  onBlur={(e) => void saveDescription(a, e.target.value)}
                />
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <ul className="grid gap-2.5 text-sm">
          {items.map((a) => {
            const isPdf = a.mime_type === "application/pdf";
            const img = isImage(a);
            const isEditing = editing?.id === a.id;
            return (
              <li key={a.id} className="rounded-xl2 border border-stone-200 bg-white p-3 shadow-card">
                <div className="flex items-center gap-3">
                  {img && urls[a.id] ? (
                    <button
                      type="button"
                      onClick={() => setLightbox({ url: urls[a.id], caption: a.description || a.file_name })}
                      className="size-10 shrink-0 overflow-hidden rounded-lg bg-stone-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={urls[a.id]} alt={a.description || a.file_name} className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <span
                      className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-[0.65rem] font-bold ${
                        isPdf ? "bg-red-50 text-red-600" : "bg-sky-50 text-sky-600"
                      }`}
                      aria-hidden
                    >
                      {isPdf ? "PDF" : "IMG"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{a.file_name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-steel">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium">{a.category}</span>
                      {a.source === "generated" ? (
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">z wzoru</span>
                      ) : null}
                      <span>{a.size_bytes ? `${Math.max(1, Math.round(a.size_bytes / 1024))} KB` : ""}</span>
                      <span className="text-stone-400">{formatDateOfTimestamp(a.created_at)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:gap-2">
                    <button
                      type="button"
                      onClick={() => void download(a)}
                      className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-moss hover:bg-moss/10"
                    >
                      Otwórz
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(isEditing ? null : { id: a.id, name: a.file_name, category: a.category })}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-steel hover:bg-stone-100 hover:text-ink"
                    >
                      {isEditing ? "Zamknij" : "Zmień"}
                    </button>
                    <button type="button" onClick={() => void remove(a)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50">
                      Usuń
                    </button>
                  </div>
                </div>

                {isEditing && editing && (
                  <div className="mt-2 grid gap-2 rounded-lg bg-stone-50 p-2.5 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                    <label className="grid gap-1 text-xs font-semibold text-steel">
                      Nazwa pliku
                      <input className="input py-1.5 text-sm" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-steel">
                      Rodzaj
                      <select
                        className="input py-1.5 text-sm"
                        value={editing.category}
                        onChange={(e) => setEditing({ ...editing, category: e.target.value as AttachmentCategory })}
                      >
                        {ATTACHMENT_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={() => void saveEdit()} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-moss">
                      Zapisz
                    </button>
                  </div>
                )}

                <textarea
                  key={`ldesc-${a.id}-${a.description ?? ""}`}
                  className="input mt-2 min-h-[38px] w-full py-1 text-xs font-normal"
                  placeholder="Opis (np. co przedstawia zdjęcie / czego dotyczy plik)…"
                  defaultValue={a.description || ""}
                  onBlur={(e) => void saveDescription(a, e.target.value)}
                />
              </li>
            );
          })}
          {items.length === 0 && (
            <li className="rounded-xl2 border border-dashed border-stone-200 p-5 text-center text-sm text-steel">{emptyText}</li>
          )}
        </ul>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <div className="max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.caption} className="max-h-[80vh] w-auto rounded-lg object-contain" />
            <p className="mt-2 text-center text-sm text-white">{lightbox.caption}</p>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="mt-3 block w-full rounded-lg bg-white/90 px-4 py-2 text-sm font-semibold text-ink hover:bg-white"
            >
              Zamknij
            </button>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
