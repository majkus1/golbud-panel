import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { mergeNotificationPrefs } from "@/lib/notification-prefs";
import { taskDiscussionHref } from "@/lib/notification-links";
import {
  appHref,
  insertInAppNotifications,
  loadMemberMaps,
  sendPushToRecipients,
  type InstantNotificationPayload
} from "@/lib/notify-dispatch";
import { getSupabaseUserClient } from "@/lib/supabase-api-route";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import {
  sendCaseAssignedEmail,
  sendNewCaseEmail,
  sendNewTaskEmail,
  sendTaskCommentEmail
} from "@/lib/send-notification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NewCaseBody = { type: "new_case"; caseId: string };
type CaseAssignedBody = { type: "case_assigned"; caseId: string; userId: string };
type TaskCreatedBody = { type: "task_created"; taskId: string };
type TaskCommentBody = { type: "task_comment"; commentId: string };
type FinancialAlertBody = {
  type: "financial_alert";
  organizationId: string;
  title: string;
  body: string;
  href?: string;
  entityId?: string;
};
type NotifyBody = NewCaseBody | CaseAssignedBody | TaskCreatedBody | TaskCommentBody | FinancialAlertBody;

const MANAGEMENT_ROLES = new Set(["owner", "office", "manager"]);
const CASE_MANAGEMENT_ROLES = new Set(["owner", "office", "manager", "sales"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DISPATCHES_PER_MINUTE = 50;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

async function fetchEmail(service: ReturnType<typeof createSupabaseServiceClient>, userId: string): Promise<string | null> {
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error || !data.user?.email) return null;
  return data.user.email.trim();
}

async function claimRecipients(
  service: ReturnType<typeof createSupabaseServiceClient>,
  senderUserId: string,
  recipientUserIds: string[],
  payload: InstantNotificationPayload
): Promise<string[]> {
  const claimed: string[] = [];
  const eventIdentity =
    payload.entityId ??
    createHash("sha256")
      .update(`${new Date().toISOString().slice(0, 13)}:${payload.type}:${payload.title}:${payload.body}:${payload.href}`)
      .digest("hex")
      .slice(0, 32);

  for (const recipientUserId of recipientUserIds) {
    const dedupeKey = `${payload.organizationId}:${payload.type}:${eventIdentity}:${recipientUserId}`;
    const { error } = await service.from("notification_dispatch_events").insert({
      dedupe_key: dedupeKey,
      organization_id: payload.organizationId,
      sender_user_id: senderUserId,
      recipient_user_id: recipientUserId,
      type: payload.type,
      entity_id: payload.entityId ?? null
    });
    if (!error) {
      claimed.push(recipientUserId);
      continue;
    }
    if (error.code !== "23505") {
      throw new Error(`Nie udało się zarejestrować powiadomienia: ${error.message}`);
    }
  }
  return claimed;
}

async function deliver(
  service: ReturnType<typeof createSupabaseServiceClient>,
  senderUserId: string,
  senderEmail: string | null,
  recipientUserIds: string[],
  payload: InstantNotificationPayload,
  emailSend: (emails: string[]) => Promise<unknown>,
  emailPref: (merged: ReturnType<typeof mergeNotificationPrefs>) => boolean,
  pushPref: (merged: ReturnType<typeof mergeNotificationPrefs>) => boolean
) {
  const orgId = payload.organizationId;
  const { prefByUser, membersByUser } = await loadMemberMaps(service, orgId);
  const validRecipients = Array.from(new Set(recipientUserIds)).filter(
    (recipientUserId) => recipientUserId !== senderUserId && membersByUser.has(recipientUserId)
  );
  const claimedRecipients = await claimRecipients(service, senderUserId, validRecipients, payload);

  await insertInAppNotifications(service, claimedRecipients, senderUserId, payload);

  const pushSent = await sendPushToRecipients(
    service,
    claimedRecipients,
    senderUserId,
    { ...payload, href: appHref(payload.href) },
    prefByUser,
    membersByUser,
    pushPref
  );

  const emailSet = new Set<string>();
  for (const uid of claimedRecipients) {
    const role = membersByUser.get(uid) ?? "member";
    const merged = mergeNotificationPrefs(role, prefByUser.get(uid));
    if (!emailPref(merged)) continue;
    const e = await fetchEmail(service, uid);
    if (e && e !== senderEmail) emailSet.add(e);
  }
  const emails = Array.from(emailSet);
  let emailResult: { messageId?: string } | null = null;
  if (emails.length > 0) {
    emailResult = (await emailSend(emails)) as { messageId?: string } | null;
  }

  return {
    recipients: claimedRecipients.length,
    emailSent: emails.length,
    pushSent,
    messageId: emailResult?.messageId
  };
}

export async function POST(request: Request) {
  const auth = await getSupabaseUserClient(request);
  if (!auth) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });
  const { supabase: userClient } = auth;

  const {
    data: { user }
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak sesji" }, { status: 401 });

  let body: NotifyBody;
  try {
    body = (await request.json()) as NotifyBody;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || typeof body.type !== "string") {
    return NextResponse.json({ error: "Nieprawidłowe dane powiadomienia" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const senderEmail = user.email ?? null;
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: recentDispatchCount, error: rateLimitError } = await service
    .from("notification_dispatch_events")
    .select("id", { count: "exact", head: true })
    .eq("sender_user_id", user.id)
    .gte("created_at", oneMinuteAgo);
  if (rateLimitError) {
    console.error("[notify] rate limit lookup", rateLimitError);
    return NextResponse.json({ error: "Powiadomienia są chwilowo niedostępne" }, { status: 503 });
  }
  if ((recentDispatchCount ?? 0) >= MAX_DISPATCHES_PER_MINUTE) {
    return NextResponse.json({ error: "Zbyt wiele powiadomień. Spróbuj ponownie za minutę." }, { status: 429 });
  }

  try {
    if (body.type === "new_case") {
      if (!isUuid(body.caseId)) {
        return NextResponse.json({ error: "Nieprawidłowy identyfikator sprawy" }, { status: 400 });
      }
      const { data: caseRow } = await userClient
        .from("cases")
        .select("id, client_name, location, source, work_description, organization_id, created_by")
        .eq("id", body.caseId)
        .maybeSingle();
      if (!caseRow) return NextResponse.json({ error: "Sprawa nie znaleziona" }, { status: 404 });
      const { data: senderMember } = await userClient
        .from("organization_members")
        .select("role")
        .eq("organization_id", caseRow.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!senderMember?.role || !CASE_MANAGEMENT_ROLES.has(senderMember.role as string)) {
        return NextResponse.json({ error: "Brak uprawnień do powiadomienia o nowej sprawie" }, { status: 403 });
      }

      const { data: members } = await service
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", caseRow.organization_id);

      const { prefByUser } = await loadMemberMaps(service, caseRow.organization_id as string);
      const recipientIds: string[] = [];
      for (const m of (members || []) as { user_id: string; role: import("@/lib/types").MemberRole }[]) {
        const merged = mergeNotificationPrefs(m.role, prefByUser.get(m.user_id));
        if (merged.notify_new_case) recipientIds.push(m.user_id);
      }

      const payload: InstantNotificationPayload = {
        organizationId: caseRow.organization_id as string,
        type: "new_case",
        title: `Nowe zapytanie: ${caseRow.client_name}`,
        body: (caseRow.location as string) || "Nowa sprawa w panelu",
        href: `/cases/${caseRow.id}`,
        entityId: caseRow.id as string
      };

      const result = await deliver(
        service,
        user.id,
        senderEmail,
        recipientIds,
        payload,
        (emails) =>
          sendNewCaseEmail({
            to: emails,
            clientName: caseRow.client_name as string,
            location: (caseRow.location as string | null) ?? null,
            source: caseRow.source as string,
            workDescription: caseRow.work_description as string,
            caseId: caseRow.id as string,
            createdByEmail: senderEmail
          }),
        (m) => m.notify_new_case,
        (m) => m.notify_new_case
      );

      return NextResponse.json({ ok: true, ...result });
    }

    if (body.type === "case_assigned") {
      if (!isUuid(body.caseId) || !isUuid(body.userId)) {
        return NextResponse.json({ error: "Nieprawidłowy identyfikator przypisania" }, { status: 400 });
      }
      const { data: caseRow } = await userClient
        .from("cases")
        .select("id, client_name, location, organization_id, created_by")
        .eq("id", body.caseId)
        .maybeSingle();
      if (!caseRow) return NextResponse.json({ error: "Sprawa nie znaleziona" }, { status: 404 });
      const [{ data: senderMember }, { data: recipientMember }, { data: assignment }] = await Promise.all([
        service
          .from("organization_members")
          .select("role")
          .eq("organization_id", caseRow.organization_id)
          .eq("user_id", user.id)
          .maybeSingle(),
        service
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", caseRow.organization_id)
          .eq("user_id", body.userId)
          .maybeSingle(),
        service
          .from("case_assignees")
          .select("user_id")
          .eq("case_id", body.caseId)
          .eq("user_id", body.userId)
          .maybeSingle()
      ]);
      if (!senderMember?.role || !CASE_MANAGEMENT_ROLES.has(senderMember.role as string)) {
        return NextResponse.json({ error: "Brak uprawnień do wysyłania przypisań" }, { status: 403 });
      }
      if (!recipientMember || !assignment) {
        return NextResponse.json({ error: "Odbiorca nie jest przypisany do tej sprawy w organizacji" }, { status: 409 });
      }

      const payload: InstantNotificationPayload = {
        organizationId: caseRow.organization_id as string,
        type: "case_assigned",
        title: `Przypisano Cię do sprawy`,
        body: caseRow.client_name as string,
        href: `/cases/${caseRow.id}`,
        entityId: caseRow.id as string
      };

      const result = await deliver(
        service,
        user.id,
        senderEmail,
        [body.userId],
        payload,
        async (emails) => {
          if (emails.length === 0) return null;
          return sendCaseAssignedEmail({
            to: emails[0],
            clientName: caseRow.client_name as string,
            location: (caseRow.location as string | null) ?? null,
            caseId: caseRow.id as string,
            assignedByEmail: senderEmail
          });
        },
        () => true,
        () => true
      );

      return NextResponse.json({ ok: true, ...result });
    }

    if (body.type === "task_created") {
      if (!isUuid(body.taskId)) {
        return NextResponse.json({ error: "Nieprawidłowy identyfikator zadania" }, { status: 400 });
      }
      const { data: task } = await userClient
        .from("case_tasks")
        .select("id, title, description, due_date, priority, case_id, organization_id, created_by")
        .eq("id", body.taskId)
        .maybeSingle();
      if (!task) return NextResponse.json({ error: "Zadanie nie znalezione" }, { status: 404 });
      if (task.created_by !== user.id) {
        const { data: senderMember } = await userClient
          .from("organization_members")
          .select("role")
          .eq("organization_id", task.organization_id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!senderMember?.role || !MANAGEMENT_ROLES.has(senderMember.role as string)) {
          return NextResponse.json({ error: "Możesz wysłać powiadomienie tylko o utworzonym przez siebie zadaniu" }, { status: 403 });
        }
      }

      const { data: ta } = await userClient.from("case_task_assignees").select("user_id").eq("task_id", body.taskId);
      const assigneeIds = ((ta || []) as { user_id: string }[]).map((x) => x.user_id);
      if (assigneeIds.length === 0) {
        return NextResponse.json({ ok: true, sent: 0, reason: "no_assignees" });
      }

      let caseClientName: string | null = null;
      if (task.case_id) {
        const { data: c } = await userClient.from("cases").select("client_name").eq("id", task.case_id).maybeSingle();
        caseClientName = (c?.client_name as string | undefined) ?? null;
      }

      const payload: InstantNotificationPayload = {
        organizationId: task.organization_id as string,
        type: "task_created",
        title: `Nowe zadanie: ${task.title}`,
        body: caseClientName || "Zadanie w panelu",
        href: task.case_id ? `/cases/${task.case_id}` : "/tasks",
        entityId: task.id as string
      };

      const result = await deliver(
        service,
        user.id,
        senderEmail,
        assigneeIds,
        payload,
        (emails) =>
          sendNewTaskEmail({
            to: emails,
            taskTitle: task.title as string,
            taskDescription: (task.description as string | null) ?? null,
            dueDate: (task.due_date as string | null) ?? null,
            priority: task.priority as string,
            caseClientName,
            caseId: (task.case_id as string | null) ?? null,
            createdByEmail: senderEmail
          }),
        () => true,
        () => true
      );

      return NextResponse.json({ ok: true, ...result });
    }

    if (body.type === "task_comment") {
      if (!isUuid(body.commentId)) {
        return NextResponse.json({ error: "Nieprawidłowy identyfikator komentarza" }, { status: 400 });
      }
      const { data: comment } = await userClient
        .from("case_task_comments")
        .select("id, task_id, body, user_id, organization_id")
        .eq("id", body.commentId)
        .maybeSingle();
      if (!comment) return NextResponse.json({ error: "Komentarz nie znaleziony" }, { status: 404 });
      if (comment.user_id !== user.id) {
        return NextResponse.json({ error: "Możesz wysłać powiadomienie tylko o własnym komentarzu" }, { status: 403 });
      }

      const { data: task } = await userClient
        .from("case_tasks")
        .select("id, title, case_id")
        .eq("id", comment.task_id)
        .maybeSingle();
      if (!task) return NextResponse.json({ error: "Zadanie nie znalezione" }, { status: 404 });

      const { data: ta } = await userClient.from("case_task_assignees").select("user_id").eq("task_id", task.id);
      const assigneeIds = ((ta || []) as { user_id: string }[]).map((x) => x.user_id);

      const { count: attachmentCount } = await service
        .from("case_task_comment_attachments")
        .select("id", { count: "exact", head: true })
        .eq("comment_id", comment.id);

      const preview = (comment.body as string | null)?.trim() || ((attachmentCount ?? 0) > 0 ? "Załącznik w dyskusji" : "Nowa wiadomość");

      const payload: InstantNotificationPayload = {
        organizationId: comment.organization_id as string,
        type: "task_comment",
        title: `Komentarz: ${task.title}`,
        body: preview,
        href: taskDiscussionHref(task.id as string),
        entityId: comment.id as string
      };

      const result = await deliver(
        service,
        user.id,
        senderEmail,
        assigneeIds,
        payload,
        async (emails) => {
          if (emails.length === 0) return null;
          let caseClientName: string | null = null;
          if (task.case_id) {
            const { data: c } = await userClient.from("cases").select("client_name").eq("id", task.case_id).maybeSingle();
            caseClientName = (c?.client_name as string | undefined) ?? null;
          }
          return sendTaskCommentEmail({
            to: emails,
            taskTitle: task.title as string,
            commentBody: (comment.body as string | null) ?? "",
            attachmentCount: attachmentCount ?? 0,
            authorEmail: senderEmail,
            caseClientName,
            taskId: task.id as string,
            caseId: (task.case_id as string | null) ?? null
          });
        },
        (m) => m.notify_task_comment,
        (m) => m.notify_task_comment
      );

      return NextResponse.json({ ok: true, ...result });
    }

    if (body.type === "financial_alert") {
      const title = body.title.trim().slice(0, 120);
      const text = body.body.trim().slice(0, 240);
      if (!isUuid(body.organizationId) || !title || !text || (body.entityId && !isUuid(body.entityId))) {
        return NextResponse.json({ error: "Brak danych alertu finansowego" }, { status: 400 });
      }

      const { data: senderMember } = await userClient
        .from("organization_members")
        .select("role")
        .eq("organization_id", body.organizationId)
        .eq("user_id", user.id)
        .maybeSingle();
      const senderRole = senderMember?.role as string | undefined;
      if (!senderRole || !MANAGEMENT_ROLES.has(senderRole)) {
        return NextResponse.json({ error: "Brak dostępu do alertów finansowych" }, { status: 403 });
      }

      const { data: members } = await service
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", body.organizationId)
        .in("role", ["owner", "office", "manager"]);

      const { prefByUser } = await loadMemberMaps(service, body.organizationId);
      const recipientIds: string[] = [];
      for (const m of (members || []) as { user_id: string; role: import("@/lib/types").MemberRole }[]) {
        const merged = mergeNotificationPrefs(m.role, prefByUser.get(m.user_id));
        if (merged.notify_financial_alerts) recipientIds.push(m.user_id);
      }

      const href = body.href?.startsWith("/") ? body.href : "/reports/profitability";
      const payload: InstantNotificationPayload = {
        organizationId: body.organizationId,
        type: "financial_alert",
        title,
        body: text,
        href,
        entityId: body.entityId
      };

      const result = await deliver(
        service,
        user.id,
        senderEmail,
        recipientIds,
        payload,
        async () => null,
        () => false,
        (m) => m.notify_financial_alerts
      );

      return NextResponse.json({ ok: true, ...result, inApp: recipientIds.filter((id) => id !== user.id).length });
    }

    return NextResponse.json({ error: "Nieznany typ powiadomienia" }, { status: 400 });
  } catch (e) {
    console.error("[notify] error", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
