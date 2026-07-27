import type { Message, MessagePart } from "../mock/uiShellData";

function reconcileRunningParts(parts: MessagePart[] | undefined): MessagePart[] | undefined {
  return parts?.map((part) => {
    if ((part.type === "reasoning" || part.type === "shell") && part.status === "running") {
      return { ...part, status: "cancelled" as const };
    }
    if ((part.type === "plan_review" || part.type === "question") && part.status === "pending") {
      return { ...part, status: "interrupted" as const };
    }
    if (part.type === "subagent_task" && part.status === "running") {
      return { ...part, status: "interrupted" as const };
    }
    return part;
  });
}

// A run that dies mid-flight (app quit, stop, error) can leave persisted
// state claiming it is still in progress. On load, downgrade stale running
// state so the UI does not show perpetual Thinking indicators or spinners:
// - a message still marked "running" becomes "cancelled";
// - activity parts stuck at "running" become "cancelled", even when the
//   message itself already reached a terminal status (stop/error paths only
//   update runStatus, not the parts).
export function reconcileInterruptedRuns(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.type === "changed_files") {
      return message;
    }

    if (message.runStatus === "running") {
      return {
        ...message,
        runStatus: "cancelled",
        runFinishedAt: message.runFinishedAt ?? Date.now(),
        parts: reconcileRunningParts(message.parts),
      };
    }

    if (message.runStatus === "cancelled" || message.runStatus === "failed") {
      const parts = reconcileRunningParts(message.parts);
      return { ...message, parts };
    }

    const parts = reconcileRunningParts(message.parts);
    return parts === message.parts ? message : { ...message, parts };
  });
}
