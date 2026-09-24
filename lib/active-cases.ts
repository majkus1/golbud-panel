import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sprawy w koszu (cases.deleted_at) nie mogą pojawiać się nigdzie w programie: na listach,
 * w wybierakach (magazyn, czas pracy, sprzęt), w kalendarzu, zadaniach, raportach,
 * powiadomieniach i porannym podsumowaniu.
 *
 * Widok `case_records` odcina je sam. Bezpośrednie odczyty tabeli `cases` i złączenia
 * `cases!inner(...)` muszą dodać filtr — pilnuje tego test lib/active-cases.test.ts,
 * który przegląda kod i zatrzymuje nowe odczyty bez filtra.
 */

type FilterableQuery<Q> = { is: (column: string, value: null) => Q };

/** Zapytanie o tabelę `cases` tylko o sprawy spoza kosza. */
export function onlyActiveCases<Q extends FilterableQuery<Q>>(query: Q): Q {
  return query.is("deleted_at", null);
}

/** Zapytanie ze złączeniem `cases!inner(...)` — odcina wiersze spraw z kosza. */
export function onlyActiveCaseJoin<Q extends FilterableQuery<Q>>(query: Q, relation = "cases"): Q {
  return query.is(`${relation}.deleted_at`, null);
}

/**
 * Identyfikatory spraw w koszu danej firmy (funkcja trashed_case_ids — tylko identyfikatory,
 * dostępne dla każdego członka firmy). Błąd odczytu = pusty zbiór, czyli nic nie ukrywamy.
 */
export async function loadTrashedCaseIds(client: SupabaseClient, organizationId: string): Promise<Set<string>> {
  const { data, error } = await client.rpc("trashed_case_ids", { p_organization_id: organizationId });
  if (error || !Array.isArray(data)) return new Set();
  return new Set(data.map((row: unknown) => (typeof row === "string" ? row : String((row as { trashed_case_ids?: string }).trashed_case_ids ?? row))));
}

/**
 * Wiersze podrzędne (płatności, zadania, przypomnienia, faktury) bez spraw z kosza.
 * Wiersz bez sprawy (np. zadanie ogólne firmy) zostaje.
 *
 * Odfiltrowujemy sprawy z kosza, a nie „wszystko spoza listy widocznych spraw” — brygadzista
 * widzi zadania przypisane mu także w sprawach, których karty nie ma na swojej liście.
 */
export function dropTrashedCaseRows<T extends { case_id?: string | null }>(rows: T[], trashedCaseIds: ReadonlySet<string>): T[] {
  if (trashedCaseIds.size === 0) return rows;
  return rows.filter((row) => !row.case_id || !trashedCaseIds.has(row.case_id));
}
