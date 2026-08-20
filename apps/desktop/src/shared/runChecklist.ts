import type { ProviderProfileId } from "./providerProfiles";

export const MAX_RUN_CHECKLIST_ITEMS = 100;
export const MAX_RUN_CHECKLIST_ITEM_BYTES = 8 * 1024;

export type RunChecklistItemStatus = "pending" | "in_progress" | "completed";

export type RunChecklistEntry = {
  content: string;
  status: RunChecklistItemStatus;
};

export type RunChecklistSnapshot = {
  entries: RunChecklistEntry[];
};

export type RunChecklistOutcome = "running" | "completed" | "failed" | "cancelled";

export type ThreadRunChecklist = RunChecklistSnapshot & {
  runId: string;
  providerProfileId: ProviderProfileId;
  outcome: RunChecklistOutcome;
  expanded: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeRunChecklistEntries(value: unknown): RunChecklistEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_RUN_CHECKLIST_ITEMS) {
    return null;
  }

  const entries: RunChecklistEntry[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.content !== "string" || !item.content.trim()) {
      return null;
    }
    if (new TextEncoder().encode(item.content).length > MAX_RUN_CHECKLIST_ITEM_BYTES) {
      return null;
    }
    if (item.status !== "pending" && item.status !== "in_progress" && item.status !== "completed") {
      return null;
    }
    entries.push({ content: item.content, status: item.status });
  }

  return entries;
}
