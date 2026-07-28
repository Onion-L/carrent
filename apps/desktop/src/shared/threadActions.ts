import type { RuntimeId } from "./runtimes";

export type ThreadActionKind = "compact";

export type ThreadActionRequest = {
  action: ThreadActionKind;
  threadId: string;
  runtimeId: RuntimeId;
  workingDirectory: string;
};

export type ThreadActionResult = {
  action: ThreadActionKind;
  threadId: string;
  runtimeId: RuntimeId;
  completedAt: string;
};
