import type { CaseStatus } from "@/lib/types";

const styles: Record<CaseStatus, string> = {
  "nowe zapytanie": "bg-sky-50 text-sky-800 ring-sky-200",
  "do kontaktu": "bg-amber-50 text-amber-800 ring-amber-200",
  "wysłano pytania": "bg-amber-50 text-amber-900 ring-amber-200",
  "oczekujemy na zdjęcia/projekt": "bg-violet-50 text-violet-800 ring-violet-200",
  "do wyceny": "bg-orange-50 text-orange-900 ring-orange-200",
  "wycena wysłana": "bg-orange-50 text-orange-800 ring-orange-200",
  "do decyzji klienta": "bg-indigo-50 text-indigo-900 ring-indigo-200",
  "umowa do podpisu": "bg-teal-50 text-teal-900 ring-teal-200",
  "zaliczka do wpłaty": "bg-lime-50 text-lime-900 ring-lime-200",
  "termin zarezerwowany": "bg-cyan-50 text-cyan-900 ring-cyan-200",
  realizacja: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  odbiór: "bg-green-50 text-green-900 ring-green-200",
  rozliczone: "bg-stone-100 text-stone-800 ring-stone-200",
  utracone: "bg-rose-50 text-rose-800 ring-rose-200"
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  const cls = styles[status] || "bg-stone-50 text-stone-700 ring-stone-200";
  return (
    <span className={`inline-flex max-w-full items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${cls}`}>
      <span className="truncate">{status}</span>
    </span>
  );
}
