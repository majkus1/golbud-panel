import { mergeNotificationPrefs } from "@/lib/notification-prefs";
import type { createSupabaseServiceClient } from "@/lib/supabase-service";
import { sendPushToUser } from "@/lib/web-push-server";
import type { DigestEmailPref, InstantNotificationType, MemberRole } from "@/lib/types";

export type InstantNotificationPayload = {
  organizationId: string;
  type: InstantNotificationType;
  title: string;
  body: string;
  href: string;
  entityId?: string;
};

type Service = ReturnType<typeof createSupabaseServiceClient>;

/** Zapis w skrzynce dzwonka — jeden wpis na zdarzenie, bez powtarzania jak cron. */
export async function insertInAppNotifications(
  service: Service,
  recipientUserIds: string[],
  senderUserId: string,
  payload: InstantNotificationPayload
): Promise<void> {
  const targets = recipientUserIds.filter((id) => id !== senderUserId);
  if (targets.length === 0) return;

  const rows = targets.map((user_id) => ({
    organization_id: payload.organizationId,
    user_id,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    href: payload.href,
    entity_id: payload.entityId ?? null
  }));

  const { error } = await service.from("user_notifications").insert(rows);
  if (error) console.error("[notify] in-app insert", error);
}

/** Push przeglądarki — tylko gdy push_enabled + zgodne z preferencją zdarzenia. */
export async function sendPushToRecipients(
  service: Service,
  recipientUserIds: string[],
  senderUserId: string,
  payload: InstantNotificationPayload,
  prefByUser: Map<string, DigestEmailPref | undefined>,
  membersByUser: Map<string, MemberRole>,
  eventAllowed: (merged: ReturnType<typeof mergeNotificationPrefs>) => boolean
): Promise<number> {
  let total = 0;
  const tag = payload.entityId ? `${payload.type}-${payload.entityId}` : payload.type;

  for (const uid of recipientUserIds) {
    if (uid === senderUserId) continue;
    const role = membersByUser.get(uid) ?? "member";
    const merged = mergeNotificationPrefs(role, prefByUser.get(uid));
    if (!merged.push_enabled || !eventAllowed(merged)) continue;

    total += await sendPushToUser(service, uid, {
      title: payload.title,
      body: payload.body,
      url: payload.href,
      tag
    });
  }
  return total;
}

export async function loadMemberMaps(
  service: Service,
  organizationId: string,
  userIds?: string[]
): Promise<{ prefByUser: Map<string, DigestEmailPref>; membersByUser: Map<string, MemberRole> }> {
  let membersQuery = service.from("organization_members").select("user_id, role").eq("organization_id", organizationId);
  if (userIds?.length) membersQuery = membersQuery.in("user_id", userIds);

  const [{ data: members }, { data: prefs }] = await Promise.all([
    membersQuery,
    service.from("digest_email_prefs").select("*").eq("organization_id", organizationId)
  ]);

  const prefByUser = new Map(((prefs || []) as DigestEmailPref[]).map((p) => [p.user_id, p]));
  const membersByUser = new Map(
    ((members || []) as { user_id: string; role: MemberRole }[]).map((m) => [m.user_id, m.role])
  );
  return { prefByUser, membersByUser };
}

export function appHref(path: string): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = explicit
    ? explicit.replace(/\/$/, "")
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`
      : "http://localhost:3000";
  return path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
