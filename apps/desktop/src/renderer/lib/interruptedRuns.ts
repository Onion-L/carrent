import { reconcileInterruptedMessage, type Message } from "../../shared/threadContent";

// A run that dies mid-flight (app quit, stop, error) can leave persisted
// state claiming it is still in progress. On load, downgrade stale running
// state so the UI does not show perpetual Thinking indicators or spinners:
// - a message still marked "running" becomes "cancelled";
// - activity parts stuck at "running" become "cancelled", even when the
//   message itself already reached a terminal status (stop/error paths only
//   update runStatus, not the parts).
export function reconcileInterruptedRuns(messages: Message[]): Message[] {
  const finishedAt = Date.now();
  return messages.map((message) => reconcileInterruptedMessage(message, finishedAt));
}
