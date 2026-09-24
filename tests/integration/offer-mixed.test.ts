import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UNITS } from "@/lib/domain";
import { SERVICE_KEY, SUPABASE_URL, TEST_PASSWORD, detectStack, requireStack } from "./local-stack";

/**
 * Migracja 20260924140000: pozycja „materiał i robocizna” i nowe jednostki.
 * Lista jednostek w programie (UNITS) musi się zgadzać z ograniczeniami w bazie —
 * test zapisuje każdą jednostkę, więc rozjazd wyjdzie od razu.
 */
describe("pozycje kosztorysu: materiał i robocizna, nowe jednostki", () => {
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const suffix = String(Date.now());
  let userId = "";
  let organizationId = "";
  let variantId = "";
  let templateId = "";

  beforeAll(async () => {
    if (!(await detectStack())) return;
    const { data } = await service.auth.admin.createUser({ email: `mixed-${suffix}@local.test`, password: TEST_PASSWORD, email_confirm: true });
    userId = data.user?.id ?? "";
    const { data: m } = await service.from("organization_members").select("organization_id").eq("user_id", userId).single();
    organizationId = m?.organization_id as string;
    const { data: c } = await service
      .from("cases")
      .insert({ organization_id: organizationId, created_by: userId, client_name: "Test mixed", work_description: "x", status: "do wyceny", source: "telefon" })
      .select("id")
      .single();
    const { data: v } = await service.from("offer_variants").insert({ organization_id: organizationId, case_id: c?.id, name: "Wariant" }).select("id").single();
    variantId = v?.id as string;
    const { data: t } = await service.from("estimate_templates").insert({ organization_id: organizationId, name: `Szablon ${suffix}` }).select("id").single();
    templateId = t?.id as string;
  });

  afterAll(async () => {
    if (organizationId) await service.from("organizations").delete().eq("id", organizationId);
    if (userId) await service.auth.admin.deleteUser(userId);
  });

  it("pozycja oferty „materiał i robocizna” w m³ zapisuje się z poprawną wartością", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { data, error } = await service
      .from("offer_lines")
      .insert({ organization_id: organizationId, variant_id: variantId, section: "mixed", label: "Beton z pompą", unit: "m³", quantity: 2.5, unit_rate: 480 })
      .select("section, unit, line_total")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ section: "mixed", unit: "m³", line_total: 1200 });
  });

  it("szablon kosztorysu przyjmuje pozycję „materiał i robocizna”", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { error } = await service
      .from("estimate_template_lines")
      .insert({ organization_id: organizationId, template_id: templateId, section: "mixed", label: "Docieplenie EPS 15 cm", unit: "m²", quantity: 1, unit_rate: 210 });
    expect(error).toBeNull();
  });

  it("każda jednostka z programu przechodzi przez ograniczenia w bazie", async (ctx) => {
    if (!requireStack(ctx)) return;
    for (const unit of UNITS) {
      const { error } = await service
        .from("offer_lines")
        .insert({ organization_id: organizationId, variant_id: variantId, section: "labor", label: `j. ${unit}`, unit, quantity: 1, unit_rate: 1 });
      expect(error, unit).toBeNull();
    }
  });

  it("nieznany rodzaj pozycji jest odrzucany", async (ctx) => {
    if (!requireStack(ctx)) return;
    const { error } = await service
      .from("offer_lines")
      .insert({ organization_id: organizationId, variant_id: variantId, section: "inne", label: "x", unit: "m²", quantity: 1, unit_rate: 1 });
    expect(error?.message).toMatch(/section_check/);
  });
});
