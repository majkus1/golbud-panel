"use client";

import { DateInput } from "@/components/date-input";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { showToast } from "@/components/toast";
import { useOrg } from "@/components/org-context";
import { formatDate, formatMoney } from "@/lib/format";
import { fleetAlertLabel, fleetAlertLevel } from "@/lib/ops-alerts";
import { warsawTodayIso } from "@/lib/warsaw-today";
import { supabase } from "@/lib/supabase";
import type { Vehicle, VehicleServiceEntry } from "@/lib/types";

export default function VehicleDetailPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <VehicleDetail />
        </AppShell>
      )}
    </AuthGate>
  );
}

function VehicleDetail() {
  const { id } = useParams<{ id: string }>();
  const { organizationId } = useOrg();
  const today = warsawTodayIso();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [services, setServices] = useState<VehicleServiceEntry[]>([]);
  const [svcTitle, setSvcTitle] = useState("");
  const [svcDate, setSvcDate] = useState(today);
  const [svcCost, setSvcCost] = useState("");
  const [svcVendor, setSvcVendor] = useState("");
  const [svcNote, setSvcNote] = useState("");

  const load = useCallback(async () => {
    if (!organizationId || !id) return;
    const [{ data: v }, { data: s }] = await Promise.all([
      supabase.from("vehicles").select("*").eq("id", id).eq("organization_id", organizationId).maybeSingle(),
      supabase
        .from("vehicle_service_entries")
        .select("*")
        .eq("vehicle_id", id)
        .order("service_date", { ascending: false })
    ]);
    setVehicle((v as Vehicle) || null);
    setServices((s || []) as VehicleServiceEntry[]);
  }, [organizationId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveField = async (patch: Partial<Vehicle>) => {
    if (!vehicle) return;
    const { error } = await supabase.from("vehicles").update(patch).eq("id", vehicle.id);
    if (error) {
      showToast("Nie udało się zapisać", "error");
      return;
    }
    showToast("Zapisano");
    await load();
  };

  const addService = async () => {
    if (!organizationId || !vehicle || !svcTitle.trim()) return;
    const { error } = await supabase.from("vehicle_service_entries").insert({
      organization_id: organizationId,
      vehicle_id: vehicle.id,
      service_date: svcDate,
      title: svcTitle.trim(),
      description: svcNote.trim() || null,
      cost: svcCost ? Number(svcCost) : null,
      vendor: svcVendor.trim() || null
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setSvcTitle("");
    setSvcCost("");
    setSvcVendor("");
    setSvcNote("");
    showToast("Dodano wpis serwisu");
    await load();
  };

  const removeService = async (sid: string) => {
    const { error } = await supabase.from("vehicle_service_entries").delete().eq("id", sid);
    if (error) {
      showToast("Nie udało się usunąć", "error");
      return;
    }
    showToast("Usunięto");
    await load();
  };

  if (!vehicle) {
    return (
      <div>
        <Link href="/vehicles" className="text-sm text-moss hover:underline">
          ← Samochody
        </Link>
        <p className="mt-4 text-steel">Nie znaleziono pojazdu.</p>
      </div>
    );
  }

  const ocLevel = fleetAlertLevel(vehicle.insurance_oc_expires, today);
  const acLevel = fleetAlertLevel(vehicle.insurance_ac_expires, today);
  const inspLevel = fleetAlertLevel(vehicle.inspection_expires, today);

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <Link href="/vehicles" className="text-sm text-moss hover:underline">
          ← Samochody
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-ink">{vehicle.name}</h1>
      </div>

      <section className="grid gap-4 rounded-lg bg-white p-5 shadow-panel">
        <h2 className="text-lg font-bold text-ink">Dane pojazdu</h2>
        <label className="grid gap-1 text-sm">
          Nazwa
          <input
            key={`name-${vehicle.name}`}
            className="input"
            defaultValue={vehicle.name}
            onBlur={(e) => {
              if (e.target.value.trim() !== vehicle.name) void saveField({ name: e.target.value.trim() });
            }}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Nr rejestracyjny
            <input
              key={`reg-${vehicle.registration_number}`}
              className="input"
              defaultValue={vehicle.registration_number || ""}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== (vehicle.registration_number || null)) void saveField({ registration_number: v });
              }}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Marka / model
            <input
              key={`mm-${vehicle.make_model}`}
              className="input"
              defaultValue={vehicle.make_model || ""}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== (vehicle.make_model || null)) void saveField({ make_model: v });
              }}
            />
          </label>
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <label className="grid min-w-0 gap-1 text-sm">
            OC ważne do
            <span className="text-xs text-steel">({fleetAlertLabel(ocLevel)})</span>
            <DateInput
              value={vehicle.insurance_oc_expires || ""}
              onChange={(e) => void saveField({ insurance_oc_expires: e.target.value || null })}
            />
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            AC ważne do
            <span className="text-xs text-steel">({fleetAlertLabel(acLevel)})</span>
            <DateInput
              value={vehicle.insurance_ac_expires || ""}
              onChange={(e) => void saveField({ insurance_ac_expires: e.target.value || null })}
            />
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            Przegląd techniczny do
            <span className="text-xs text-steel">({fleetAlertLabel(inspLevel)})</span>
            <DateInput
              value={vehicle.inspection_expires || ""}
              onChange={(e) => void saveField({ inspection_expires: e.target.value || null })}
            />
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          Notatki
          <textarea
            key={`notes-${vehicle.notes}`}
            className="input min-h-[72px]"
            defaultValue={vehicle.notes || ""}
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== (vehicle.notes || null)) void saveField({ notes: v });
            }}
          />
        </label>
      </section>

      <section className="rounded-lg bg-white p-5 shadow-panel">
        <h2 className="text-lg font-bold text-ink">Serwis i naprawy</h2>
        <div className="mt-4 grid gap-2 rounded-md border border-stone-200 p-3">
          <input className="input" placeholder="Opis, np. Wymiana oleju" value={svcTitle} onChange={(e) => setSvcTitle(e.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2">
            <DateInput value={svcDate} onChange={(e) => setSvcDate(e.target.value)} />
            <input className="input" placeholder="Mechanik / warsztat" value={svcVendor} onChange={(e) => setSvcVendor(e.target.value)} />
          </div>
          <input type="number" min={0} className="input" placeholder="Koszt (zł)" value={svcCost} onChange={(e) => setSvcCost(e.target.value)} />
          <textarea className="input min-h-[60px]" placeholder="Szczegóły (opcjonalnie)" value={svcNote} onChange={(e) => setSvcNote(e.target.value)} />
          <button type="button" onClick={() => void addService()} className="rounded-md bg-moss px-3 py-2 text-sm font-semibold text-white hover:bg-ink">
            Dodaj wpis
          </button>
        </div>
        <ul className="mt-4 divide-y divide-stone-100 text-sm">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div>
                <p className="font-semibold text-ink">{s.title}</p>
                <p className="text-xs text-steel">{formatDate(s.service_date)}</p>
                {s.vendor ? <p className="text-xs text-steel">{s.vendor}</p> : null}
                {s.description ? <p className="mt-1 text-xs">{s.description}</p> : null}
                {s.cost != null && Number(s.cost) > 0 ? <p className="mt-1 text-xs font-medium">{formatMoney(Number(s.cost))}</p> : null}
              </div>
              <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => void removeService(s.id)}>
                Usuń
              </button>
            </li>
          ))}
          {services.length === 0 ? <li className="py-4 text-steel">Brak wpisów serwisu.</li> : null}
        </ul>
      </section>
    </div>
  );
}
