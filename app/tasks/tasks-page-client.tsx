"use client";

import { useSearchParams } from "next/navigation";
import { TasksPanel } from "@/components/tasks-panel";

export function TasksPageClient() {
  const searchParams = useSearchParams();
  const raw = searchParams.get("filter");
  const filterPreset = raw === "active" ? "active" : raw === "przeterminowane" ? "overdue" : null;
  const initialTaskId = searchParams.get("task");
  const openDiscussion = searchParams.get("discussion") === "1";

  return (
    <TasksPanel filterPreset={filterPreset} initialTaskId={initialTaskId} openDiscussion={openDiscussion} />
  );
}
