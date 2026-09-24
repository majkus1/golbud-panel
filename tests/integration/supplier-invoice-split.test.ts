import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVICE_KEY, SUPABASE_URL, TEST_PASSWORD, detectStack, requireStack } from "./local-stack";

/**
 * Faktura kosztowa „materiały i robocizna” (migracja 20260924180000_supplier_invoice_material_labor):
 * baza przyjmuje nową kategorię i pilnuje, żeby podział sumował się do kwoty brutto.
 */
describe("faktura „materiały i robocizna”", () => {
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let userId = "";
  let organizationId = "";

  beforeAll(async () => {
    if (!(await detectStack())) return;
    const { data } = await service.auth.admin.createUser({ email: `split-${Date.now()}@local.test`, password: TEST_PASSWORD, email_confirm: true });
    userId = data.user!.id;
    const { data: membership } = await service.from("organization_members").select("organization_id").eq("user_id", userId).single();
    organizationId = membership!.organization_id as string;
  });

  afterAll(async () => {
    if (organizationId) await service.from("supplier_invoices").delete().eq("organization_id", organizationId);
    if (userId) await service.auth.admin.deleteUser(userId);
    if (organizationId) await service.from("organizations").delete().eq("id", organizationId);
  });

  const invoice = (material: number | null, labor: number | null) => ({
    organization_id: organizationId,
    supplier_name: "Ekipa z materiałem",
    invoice_date: "2026-09-24",
    category: "materialy_robocizna",
    gross_total: 12300,
    material_gross: material,
    labor_gross: labor,
    paid_amount: 0,
    status: "nieoplacona",
    created_by: userId
  });

  it("zapisuje podział, który daje kwotę brutto", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { error } = await service.from("supplier_invoices").insert(invoice(8000, 4300));
    expect(error).toBeNull();
  });

  it("odrzuca podział, który nie sumuje się do brutto, i ujemne kwoty", async (ctx) => {
    if (!requireStack(ctx)) return;
    const mismatch = await service.from("supplier_invoices").insert(invoice(8000, 1000));
    expect(mismatch.error?.message).toMatch(/cost_split/);
    const negative = await service.from("supplier_invoices").insert(invoice(-1, null));
    expect(negative.error?.message).toMatch(/cost_split/);
  });
});
