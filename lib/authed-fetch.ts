import { supabase } from "@/lib/supabase";

/** POST JSON do chronionego API z tokenem Bearer (działa też gdy cookies nie dochodzą). */
export async function postAuthenticatedJson<T = unknown>(
  apiPath: string,
  body: unknown
): Promise<{ ok: true; data: T } | { ok: false; error: string; body?: unknown }> {
  await supabase.auth.getUser();
  let {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data } = await supabase.auth.refreshSession();
    session = data.session ?? null;
  }
  if (!session?.access_token) {
    return { ok: false, error: "Sesja wygasła — odśwież stronę i zaloguj się ponownie." };
  }

  let res: Response;
  try {
    res = await fetch(apiPath, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(body)
    });
  } catch {
    return { ok: false, error: "Brak połączenia z serwerem." };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* brak JSON */
  }

  if (!res.ok) {
    const error = (json as { error?: string })?.error || `Błąd ${res.status}`;
    // Ciało zwracamy dalej — część tras rozróżnia powód błędu przez pole `reason`.
    return { ok: false, error, body: json };
  }
  return { ok: true, data: json as T };
}

/** GET JSON z chronionego API z tokenem Bearer (odczyt danych spoza Supabase, np. poczty). */
export async function getAuthenticatedJson<T = unknown>(
  apiPath: string
): Promise<{ ok: true; data: T } | { ok: false; error: string; body?: unknown }> {
  await supabase.auth.getUser();
  let {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data } = await supabase.auth.refreshSession();
    session = data.session ?? null;
  }
  if (!session?.access_token) {
    return { ok: false, error: "Sesja wygasła — odśwież stronę i zaloguj się ponownie." };
  }

  let res: Response;
  try {
    res = await fetch(apiPath, {
      method: "GET",
      credentials: "include",
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
  } catch {
    return { ok: false, error: "Brak połączenia z serwerem." };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* brak JSON */
  }

  if (!res.ok) {
    const error = (json as { error?: string })?.error || `Błąd ${res.status}`;
    // Ciało zwracamy dalej — trasy poczty rozróżniają powody błędu przez pole `reason`.
    return { ok: false, error, body: json };
  }
  return { ok: true, data: json as T };
}

/** POST FormData do chronionego API z tokenem Bearer, używane przy uploadzie plików. */
export async function postAuthenticatedForm<T = unknown>(
  apiPath: string,
  form: FormData
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  await supabase.auth.getUser();
  let {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data } = await supabase.auth.refreshSession();
    session = data.session ?? null;
  }
  if (!session?.access_token) {
    return { ok: false, error: "Sesja wygasła — odśwież stronę i zaloguj się ponownie." };
  }

  let res: Response;
  try {
    res = await fetch(apiPath, {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${session.access_token}`
      },
      body: form
    });
  } catch {
    return { ok: false, error: "Brak połączenia z serwerem." };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* brak JSON */
  }

  if (!res.ok) {
    const error = (json as { error?: string })?.error || `Błąd ${res.status}`;
    return { ok: false, error };
  }
  return { ok: true, data: json as T };
}

/** POST JSON do chronionego API zwracającego plik binarny (np. PDF). */
export async function postAuthenticatedBlob(
  apiPath: string,
  body: unknown
): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  await supabase.auth.getUser();
  let {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data } = await supabase.auth.refreshSession();
    session = data.session ?? null;
  }
  if (!session?.access_token) {
    return { ok: false, error: "Sesja wygasła — odśwież stronę i zaloguj się ponownie." };
  }

  let res: Response;
  try {
    res = await fetch(apiPath, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(body)
    });
  } catch {
    return { ok: false, error: "Brak połączenia z serwerem." };
  }

  if (!res.ok) {
    let error = `Błąd ${res.status}`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json?.error) error = json.error;
    } catch {
      /* brak JSON */
    }
    return { ok: false, error };
  }
  return { ok: true, blob: await res.blob() };
}
