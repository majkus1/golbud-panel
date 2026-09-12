import webpush from "web-push";
import type { createSupabaseServiceClient } from "@/lib/supabase-service";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
};

function configureVapid(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || process.env.SMTP_GMAIL_USER || "mailto:powiadomienia@golbud.pl";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject.startsWith("mailto:") ? subject : `mailto:${subject}`, publicKey, privateKey);
  return true;
}

export function isWebPushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<void> {
  if (!configureVapid()) return;
  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    },
    JSON.stringify(payload)
  );
}

export async function sendPushToUser(
  service: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
  payload: PushPayload
): Promise<number> {
  if (!isWebPushConfigured()) return 0;
  const { data: subs } = await service.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId);
  let sent = 0;
  for (const sub of subs || []) {
    try {
      await sendWebPush(sub as { endpoint: string; p256dh: string; auth: string }, payload);
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await service.from("push_subscriptions").delete().eq("endpoint", (sub as { endpoint: string }).endpoint);
      } else {
        console.warn("[push] send failed", userId, e);
      }
    }
  }
  return sent;
}
