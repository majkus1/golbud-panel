"use client";

import { useEffect, useMemo, useState } from "react";
import { ATTACHMENT_CATEGORIES } from "@/lib/domain";
import { supabase } from "@/lib/supabase";
import type { Attachment, AttachmentCategory } from "@/lib/types";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export function AttachmentsSection({
  caseId,
  organizationId,
  userId,
  items,
  onChange
}: {
  caseId: string;
  organizationId: string;
  userId: string;
  items: Attachment[];
  onChange: () => Promise<void>;
}) {
  const [cat, setCat] = useState<AttachmentCategory>("w trakcie");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"lista" | "galeria">("lista");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{ url: string; caption: string } | null>(null);

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

  const saveDescription = async (a: Attachment, value: string) => {
    const next = value.trim() || null;
    if (next === (a.description || null)) return;
    const { error } = await supabase.from("attachments").update({ description: next }).eq("id", a.id);
    if (error) {
      setErr(error.message);
      return;
    }
    await onChange();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    if (file.size > MAX_UPLOAD_BYTES) {
      setErr("Plik za duży (max 15 MB).");
      return;
    }
    if (!ALLOWED_MIME.has(file.type)) {
      setErr("Dozwolone: JPG, PNG, WebP, PDF.");
      return;
    }
    setUploading(true);
    const safe = file.name.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]+/g, "_").slice(0, 120);
    const path = `${organizationId}/${caseId}/${crypto.randomUUID()}_${safe}`;
    const { error: upErr } = await supabase.storage.from("case-attachments").upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setErr(upErr.message);
      setUploading(false);
      return;
    }
    const { error: dbErr } = await supabase.from("attachments").insert({
      organization_id: organizationId,
      case_id: caseId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      category: cat,
      uploaded_by: userId
    });
    if (dbErr) setErr(dbErr.message);
    setUploading(false);
    await onChange();
  };

  const download = async (a: Attachment) => {
    const { data, error } = await supabase.storage.from("case-attachments").createSignedUrl(a.storage_path, 3600);
    if (error || !data?.signedUrl) return;
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const remove = async (a: Attachment) => {
    await supabase.storage.from("case-attachments").remove([a.storage_path]);
    await supabase.from("attachments").delete().eq("id", a.id);
    await onChange();
  };

  return (
    <section className="min-w-0 rounded-lg bg-white p-4 shadow-panel sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Załączniki i zdjęcia</h2>
        <div className="inline-flex overflow-hidden rounded-lg border border-stone-300 text-xs font-semibold">
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
      </div>
      <p className="mt-1 text-xs text-steel">Kategorie zgodnie z procesem: przed / w trakcie / po, usterki, materiały, projekt, inspiracje. Max 15 MB, JPG/PNG/WebP/PDF.</p>
      {err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
      <div className="mt-4 flex flex-col gap-2 rounded-xl2 bg-stone-50 p-3 sm:flex-row sm:items-center">
        <select value={cat} onChange={(e) => setCat(e.target.value as AttachmentCategory)} className="input sm:w-auto">
          {ATTACHMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="cursor-pointer rounded-lg bg-moss px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-ink">
          {uploading ? "Wysyłanie…" : "Wybierz plik"}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={uploading} onChange={onFile} />
        </label>
      </div>

      {view === "galeria" ? (
        images.length === 0 ? (
          <p className="mt-5 rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-steel">Brak zdjęć do pokazania w galerii.</p>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
                    key={`desc-${a.id}`}
                    className="input mt-1.5 min-h-[40px] w-full py-1 text-xs font-normal"
                    placeholder="Opis zdjęcia…"
                    defaultValue={a.description || ""}
                    onBlur={(e) => void saveDescription(a, e.target.value)}
                  />
                </figcaption>
              </figure>
            ))}
          </div>
        )
      ) : (
        <ul className="mt-5 grid gap-2.5 text-sm">
          {items.map((a) => {
            const isPdf = a.mime_type === "application/pdf";
            const img = isImage(a);
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
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-lg ${isPdf ? "bg-red-50 text-red-500" : "bg-sky-50 text-sky-500"}`}>
                      {isPdf ? "📄" : "🖼"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{a.file_name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-steel">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium">{a.category}</span>
                      <span>{a.size_bytes ? `${(a.size_bytes / 1024).toFixed(0)} KB` : "?"}</span>
                      <span className="text-stone-400">{new Date(a.created_at).toLocaleDateString("pl-PL")}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:gap-2">
                    <button type="button" onClick={() => download(a)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-moss hover:bg-moss/10">
                      Pobierz
                    </button>
                    <button type="button" onClick={() => remove(a)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50">
                      Usuń
                    </button>
                  </div>
                </div>
                <textarea
                  key={`ldesc-${a.id}`}
                  className="input mt-2 min-h-[38px] w-full py-1 text-xs font-normal"
                  placeholder="Opis (np. co przedstawia zdjęcie / czego dotyczy plik)…"
                  defaultValue={a.description || ""}
                  onBlur={(e) => void saveDescription(a, e.target.value)}
                />
              </li>
            );
          })}
          {items.length === 0 && (
            <li className="rounded-xl2 border border-dashed border-stone-200 p-6 text-center text-steel">Brak załączników.</li>
          )}
        </ul>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
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
    </section>
  );
}
