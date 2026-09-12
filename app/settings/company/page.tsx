"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { showToast } from "@/components/toast";
import { AuthGate } from "@/components/auth-gate";
import { useOrg } from "@/components/org-context";
import {
  formFromOrganizationRow,
  organizationUpdateFromForm,
  type OrganizationOfferForm
} from "@/lib/organization-offer-profile";
import { supabase } from "@/lib/supabase";

const VAT_OPTIONS = [0, 5, 8, 23];

export default function CompanySettingsPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <CompanySettingsInner />
        </AppShell>
      )}
    </AuthGate>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-ink">{label}</span>
      {hint ? <span className="text-xs text-steel">{hint}</span> : null}
      {children}
    </label>
  );
}

function FormSection({
  step,
  title,
  desc,
  children
}: {
  step: string;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl2 border border-stone-200/80 bg-white p-4 shadow-card sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-moss/10 text-sm font-bold text-moss-dark">{step}</span>
        <div>
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <p className="text-xs text-steel">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function CompanySettingsInner() {
  const { organizationId, role } = useOrg();
  const isOwner = role === "owner";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<OrganizationOfferForm | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("organizations")
      .select(
        "name, offer_legal_name, offer_nip, offer_address_line, offer_postal_city, offer_phone, offer_email, offer_website, offer_bank_account, offer_bank_name, offer_payment_terms, offer_default_vat_rate, offer_validity_days, accountant_email, invoice_email_subject, invoice_email_body"
      )
      .eq("id", organizationId)
      .maybeSingle();

    if (error) {
      const missing =
        error.message.includes("offer_legal_name") ||
        error.message.includes("column") ||
        error.code === "42703";
      setLoadError(
        missing
          ? "Brak kolumn w bazie — uruchom migrację 0010_organization_offer_profile.sql w Supabase (SQL Editor)."
          : error.message
      );
      setForm(null);
    } else if (data) {
      setForm(formFromOrganizationRow({ ...data, name: data.name || "GolBud" }));
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (key: keyof OrganizationOfferForm, value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async () => {
    if (!organizationId || !form || !isOwner) return;
    setSaving(true);
    const payload = organizationUpdateFromForm(form);
    const { error } = await supabase.from("organizations").update(payload).eq("id", organizationId);
    setSaving(false);
    if (error) {
      showToast(error.message.includes("policy") ? "Brak uprawnień — tylko właściciel może zapisać" : error.message, "error");
      return;
    }
    showToast("Zapisano dane firmy");
    await load();
  };

  if (!organizationId) return null;

  return (
    <div className="grid max-w-2xl gap-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Ustawienia</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Firma</h1>
        <p className="mt-2 text-sm text-steel">
          Dane widoczne na PDF oferty / kosztorysu (nagłówek, sprzedawca, płatności, VAT). Po zapisie kolejne PDF biorą te wartości.
        </p>
      </div>

      {loadError ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{loadError}</section>
      ) : null}

      {!isOwner && !loadError ? (
        <p className="rounded-lg bg-stone-100 px-4 py-3 text-sm text-steel">
          Podgląd dla zespołu. Zmiany może zapisać tylko <strong className="font-semibold text-ink">właściciel</strong> konta firmy.
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-steel">Wczytywanie…</p>
      ) : form ? (
        <>
          <FormSection step="1" title="Identyfikacja firmy" desc="Nazwa i NIP widoczne jako sprzedawca na dokumentach.">
            <div className="grid gap-4">
              <Field label="Nazwa w panelu" hint="Krótka nazwa organizacji w systemie">
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => patch("name", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
              <Field label="Pełna nazwa na ofercie (sprzedawca)">
                <input
                  className="input"
                  value={form.offer_legal_name}
                  onChange={(e) => patch("offer_legal_name", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
              <Field label="NIP">
                <input
                  className="input"
                  value={form.offer_nip}
                  onChange={(e) => patch("offer_nip", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection step="2" title="Kontakt i adres" desc="Dane kontaktowe i adres na nagłówku oferty.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Telefon">
                <input
                  className="input"
                  value={form.offer_phone}
                  onChange={(e) => patch("offer_phone", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
              <Field label="E-mail">
                <input
                  type="email"
                  className="input"
                  value={form.offer_email}
                  onChange={(e) => patch("offer_email", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
              <Field label="Strona www">
                <input
                  className="input"
                  value={form.offer_website}
                  onChange={(e) => patch("offer_website", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
              <Field label="Adres (ulica i numer)">
                <input
                  className="input"
                  value={form.offer_address_line}
                  onChange={(e) => patch("offer_address_line", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
              <Field label="Kod i miejscowość">
                <input
                  className="input"
                  value={form.offer_postal_city}
                  onChange={(e) => patch("offer_postal_city", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection step="3" title="Płatności" desc="Dane do przelewu i warunki płatności na PDF.">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Numer konta bankowego">
                  <input
                    className="input font-mono text-sm"
                    value={form.offer_bank_account}
                    onChange={(e) => patch("offer_bank_account", e.target.value)}
                    placeholder="26 cyfr IBAN lub nr rachunku"
                    disabled={!isOwner}
                  />
                </Field>
                <Field label="Bank">
                  <input
                    className="input"
                    value={form.offer_bank_name}
                    onChange={(e) => patch("offer_bank_name", e.target.value)}
                    disabled={!isOwner}
                  />
                </Field>
              </div>
              <Field label="Warunki płatności (strona 2 PDF)">
                <textarea
                  className="input min-h-[88px]"
                  value={form.offer_payment_terms}
                  onChange={(e) => patch("offer_payment_terms", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection step="4" title="Domyślne ustawienia oferty" desc="Wartości podpowiadane przy nowych ofertach.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Domyślna stawka VAT na pozycjach (%)">
                <select
                  className="input"
                  value={form.offer_default_vat_rate}
                  onChange={(e) => patch("offer_default_vat_rate", e.target.value)}
                  disabled={!isOwner}
                >
                  {VAT_OPTIONS.map((v) => (
                    <option key={v} value={String(v)}>
                      {v}%
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ważność oferty (dni)">
                <input
                  type="number"
                  min={1}
                  max={365}
                  className="input"
                  value={form.offer_validity_days}
                  onChange={(e) => patch("offer_validity_days", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection step="5" title="Faktury — wysyłka e-mail" desc="Adres księgowej i domyślna treść maila z fakturą (przycisk „Wyślij mailem” w sprawie).">
            <div className="grid gap-4">
              <Field label="E-mail księgowej" hint="Podpowiadany jako odbiorca przy wysyłce faktury">
                <input
                  type="email"
                  className="input"
                  value={form.accountant_email}
                  onChange={(e) => patch("accountant_email", e.target.value)}
                  placeholder="np. biuro@ksiegowosc.pl"
                  disabled={!isOwner}
                />
              </Field>
              <Field label="Domyślny temat" hint="Znaczniki: {numer}, {kwota}, {termin}, {firma}">
                <input
                  className="input"
                  value={form.invoice_email_subject}
                  onChange={(e) => patch("invoice_email_subject", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
              <Field label="Domyślna treść wiadomości" hint="Znaczniki: {numer}, {kwota}, {termin}, {firma}">
                <textarea
                  className="input min-h-[140px]"
                  value={form.invoice_email_body}
                  onChange={(e) => patch("invoice_email_body", e.target.value)}
                  disabled={!isOwner}
                />
              </Field>
            </div>
          </FormSection>

          {isOwner ? (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="w-full rounded-lg bg-ink px-4 py-3 text-sm font-semibold text-white hover:bg-moss disabled:opacity-50 sm:w-auto"
            >
              {saving ? "Zapisywanie…" : "Zapisz dane firmy"}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
