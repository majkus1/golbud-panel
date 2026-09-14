import { NextResponse } from "next/server";
import { formatSmtpError, getSmtpFrom, getSmtpTransporter } from "@/lib/smtp-transport";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Testowa wysyłka e-maila na adres zalogowanej osoby.
 *
 * Powstało, bo poranny digest przestał przychodzić i nie dało się tego sprawdzić:
 * cron zwracał sukces, a na darmowym planie Vercel logi z 5:00 znikają po godzinie.
 * Ten sam transport SMTP obsługuje digest, powiadomienia i faktury — jeśli testowy mail
 * dojdzie, dojdą też pozostałe; jeśli nie, użytkownik widzi dokładną przyczynę na ekranie.
 *
 * Tylko role zarządcze — to one konfigurują pocztę firmy.
 */
const MANAGEMENT_ROLES = new Set(["owner", "office", "manager"]);

export async function POST(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  const {
    data: { user }
  } = await auth.supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  let body: { organizationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }
  if (!body.organizationId) return NextResponse.json({ error: "Brak organizacji" }, { status: 400 });

  const { data: member } = await auth.supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", body.organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member || !MANAGEMENT_ROLES.has(member.role as string)) {
    return NextResponse.json({ error: "Testową wysyłkę może uruchomić właściciel, biuro lub manager" }, { status: 403 });
  }

  try {
    const transporter = getSmtpTransporter();
    const from = getSmtpFrom();
    const sentAt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Warsaw" }).format(new Date());
    const info = await transporter.sendMail({
      from: `"GolBud Panel" <${from}>`,
      to: user.email,
      subject: "[GolBud] Test wysyłki e-mail",
      text:
        `To jest testowa wiadomość z panelu GolBud, wysłana ${sentAt}.\n\n` +
        `Jeśli ją czytasz, poczta z panelu działa: poranne podsumowanie, powiadomienia o nowych zapytaniach ` +
        `i wysyłka faktur korzystają z tego samego połączenia.\n\n— Panel GolBud`
    });
    return NextResponse.json({ ok: true, to: user.email, from, messageId: info.messageId ?? null });
  } catch (error) {
    // Komunikat idzie na ekran — to jest cały sens tej trasy.
    return NextResponse.json({ error: formatSmtpError(error) }, { status: 502 });
  }
}
