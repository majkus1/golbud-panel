import { supabase } from "@/lib/supabase";

type NotifyPayload =
  | { type: "new_case"; caseId: string }
  | { type: "case_assigned"; caseId: string; userId: string }
  | { type: "task_created"; taskId: string }
  | { type: "task_comment"; commentId: string }
  | { type: "financial_alert"; organizationId: string; title: string; body: string; href?: string; entityId?: string };

/**
 * Wysyła powiadomienie e-mail z poziomu klienta.
 * Nie blokuje UI — błędy logujemy tylko do konsoli (powiadomienie to "best-effort").
 */
export async function notify(payload: NotifyPayload): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    await fetch("/api/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.warn("[notify] failed", e);
  }
}
