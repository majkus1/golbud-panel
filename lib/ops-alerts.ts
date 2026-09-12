/** Terminy floty i stany magazynowe — wspólna logika UI + digest. */

export const FLEET_ALERT_DAYS = 30;

export type FleetDocKind = "insurance" | "inspection";

export type FleetAlertLevel = "ok" | "soon" | "overdue" | "none";

export function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso?.trim()) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function daysUntil(iso: string | null | undefined, todayIso: string): number | null {
  const d = parseIsoDate(iso);
  const t = parseIsoDate(todayIso);
  if (!d || !t) return null;
  const ms = d.getTime() - t.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export function fleetAlertLevel(iso: string | null | undefined, todayIso: string): FleetAlertLevel {
  if (!iso?.trim()) return "none";
  const left = daysUntil(iso, todayIso);
  if (left === null) return "none";
  if (left < 0) return "overdue";
  if (left <= FLEET_ALERT_DAYS) return "soon";
  return "ok";
}

export function worstLevelOf(isos: (string | null | undefined)[], todayIso: string): FleetAlertLevel {
  const levels = isos.map((iso) => fleetAlertLevel(iso, todayIso));
  if (levels.includes("overdue")) return "overdue";
  if (levels.includes("soon")) return "soon";
  if (levels.includes("ok")) return "ok";
  return "none";
}

export function worstFleetLevel(
  insurance: string | null | undefined,
  inspection: string | null | undefined,
  todayIso: string
): FleetAlertLevel {
  return worstLevelOf([insurance, inspection], todayIso);
}

/** Najgorszy status dla pojazdu z rozdziałem OC / AC + przegląd. */
export function worstVehicleLevel(
  oc: string | null | undefined,
  ac: string | null | undefined,
  inspection: string | null | undefined,
  todayIso: string
): FleetAlertLevel {
  return worstLevelOf([oc, ac, inspection], todayIso);
}

export function fleetAlertLabel(level: FleetAlertLevel): string {
  switch (level) {
    case "overdue":
      return "Po terminie";
    case "soon":
      return "Wkrótce kończy";
    case "ok":
      return "OK";
    default:
      return "Brak dat";
  }
}

export function fleetDocLabel(kind: FleetDocKind): string {
  return kind === "insurance" ? "Ubezpieczenie OC/AC" : "Przegląd techniczny";
}

export function isLowStock(quantity: number, minQuantity: number): boolean {
  return minQuantity > 0 && quantity <= minQuantity;
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
