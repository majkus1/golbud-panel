import { supabase } from "@/lib/supabase";

/** Pobiera plik z API chronionego sesją — Bearer + blob (działa na Vercel mimo problemów z cookies w nowej karcie). */
export async function downloadAuthenticatedFile(apiPath: string, filename: string): Promise<boolean> {
  await supabase.auth.getUser();

  let {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data } = await supabase.auth.refreshSession();
    session = data.session ?? null;
  }
  if (!session?.access_token) {
    window.alert("Sesja wygasła lub brak logowania — odśwież stronę i zaloguj się ponownie.");
    return false;
  }

  const res = await fetch(apiPath, {
    credentials: "include",
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  if (!res.ok) {
    let msg = `Błąd ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* nie JSON */
    }
    window.alert(msg);
    return false;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/** Wygodny wrapper na PDF (dokleja rozszerzenie .pdf, jeśli brakuje). */
export async function downloadAuthenticatedPdf(apiPath: string, filename: string): Promise<boolean> {
  return downloadAuthenticatedFile(apiPath, filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
