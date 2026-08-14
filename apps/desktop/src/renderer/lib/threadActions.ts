import type { AppThreadActionRecord, AppThreadRunRecord } from "../../shared/workspacePersistence";
import type { KimiTelemetryStatus } from "../../shared/chat";
import type { Message } from "../../shared/threadContent";
import type { RuntimeId } from "../../shared/runtimes";

export type CompactAvailability =
  | { available: true }
  | {
      available: false;
      reason:
        | "unsupported-runtime"
        | "missing-session"
        | "unsupported-capability"
        | "running"
        | "compacting"
        | "status-loading"
        | "missing-exchange";
    };

export function parseLeadingCompactCommand(input: string): { draft: string } | null {
  const match = /^\s*\/compact(?=\s|$)/u.exec(input);
  if (!match) return null;
  return { draft: input.slice(match[0].length).replace(/^[ \t]+/u, "") };
}

export function parseLeadingStatusCommand(input: string): { draft: string } | null {
  const match = /^\s*\/status(?=\s|$)/u.exec(input);
  if (!match) return null;
  return { draft: input.slice(match[0].length).replace(/^[ \t]+/u, "") };
}

function hasEffectiveAgentReply(message: Message) {
  if (message.role !== "assistant" || message.type === "changed_files") return false;
  if (message.runStatus !== "completed") return false;
  if (message.content.trim()) return true;
  return !!message.parts?.some(
    (part) =>
      (part.type === "text" || part.type === "plan_review") && part.content.trim().length > 0,
  );
}

export function hasCompleteExchangeAfterLatestCompact(input: {
  runtimeId: RuntimeId;
  messages: Message[];
  runs: AppThreadRunRecord[];
  actions: AppThreadActionRecord[];
}) {
  const latestCompactAt = input.actions
    .filter((action) => action.action === "compact" && action.runtimeId === input.runtimeId)
    .reduce((latest, action) => Math.max(latest, Date.parse(action.completedAt)), 0);

  return input.runs.some((run) => {
    if (run.runtimeId !== input.runtimeId || Date.parse(run.startedAt) <= latestCompactAt) {
      return false;
    }
    const userIndex = input.messages.findIndex(
      (message) => message.id === run.messageId && message.role === "user",
    );
    if (userIndex < 0) return false;
    for (let index = userIndex + 1; index < input.messages.length; index += 1) {
      const message = input.messages[index]!;
      if (message.role === "user") return false;
      if (hasEffectiveAgentReply(message)) return true;
    }
    return false;
  });
}

export function getCompactAvailability(input: {
  runtimeId: RuntimeId;
  status: KimiTelemetryStatus | null;
  running: boolean;
  compacting: boolean;
  statusLoading?: boolean;
  messages: Message[];
  runs: AppThreadRunRecord[];
  actions: AppThreadActionRecord[];
}): CompactAvailability {
  if (input.runtimeId !== "kimi") return { available: false, reason: "unsupported-runtime" };
  if (input.running) return { available: false, reason: "running" };
  if (input.compacting) return { available: false, reason: "compacting" };
  if (input.statusLoading) return { available: false, reason: "status-loading" };
  if (!input.status) return { available: false, reason: "missing-session" };
  if (!input.status.threadActions?.includes("compact")) {
    return { available: false, reason: "unsupported-capability" };
  }
  if (!hasCompleteExchangeAfterLatestCompact(input)) {
    return { available: false, reason: "missing-exchange" };
  }
  return { available: true };
}

export function getCompactUnavailableMessage(
  reason: Exclude<CompactAvailability, { available: true }>["reason"],
) {
  switch (reason) {
    case "running":
      return "Compact is unavailable while the Thread has a live Run.";
    case "compacting":
      return "This Thread is already compacting.";
    case "status-loading":
      return "Compact is unavailable while Session Status is loading.";
    case "missing-session":
      return "Compact requires a resumable Runtime Session.";
    case "missing-exchange":
      return "Compact requires a completed user and Agent exchange.";
    case "unsupported-capability":
      return "The current Runtime Session does not support Compact.";
    case "unsupported-runtime":
      return "The selected Runtime does not support Compact.";
  }
}
