import type { Message, MessagePart } from "../mock/uiShellData";

function cancelRunningParts(parts: MessagePart[] | undefined): MessagePart[] | undefined {
  return parts?.map((part) =>
    (part.type === "reasoning" || part.type === "shell") && part.status === "running"
      ? { ...part, status: "cancelled" as const }
      : part,
  );
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
        parts: cancelRunningParts(message.parts),
      };
    }

    if (message.runStatus === "cancelled" || message.runStatus === "failed") {
      const parts = cancelRunningParts(message.parts);
      return { ...message, parts };
    }

    return message;
  });
}
