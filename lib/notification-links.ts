import { supabase } from "@/lib/supabase";
import type { UserNotification } from "@/lib/types";

export function taskDiscussionHref(taskId: string): string {
  return `/tasks?task=${encodeURIComponent(taskId)}&discussion=1`;
}

/** Adres docelowy powiadomienia o komentarzu — obsługuje stare wpisy (entity_id = comment id). */
export async function resolveTaskCommentNotificationHref(
  item: Pick<UserNotification, "href" | "entity_id">
): Promise<string> {
  if (item.href.includes("task=")) return item.href;
  const entityId = item.entity_id;
  if (!entityId) return "/tasks";

  const { data: comment } = await supabase
    .from("case_task_comments")
    .select("task_id")
    .eq("id", entityId)
    .maybeSingle();

  const taskId = (comment?.task_id as string | undefined) ?? entityId;
  return taskDiscussionHref(taskId);
}
