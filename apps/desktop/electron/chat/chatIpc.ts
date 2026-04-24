import type { ChatTurnRequest, ChatRunEvent } from "../../src/shared/chat";
import type { ChatRunner } from "./chatRunner";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

export interface ChatIpcServices {
  chatRunner: ChatRunner;
  emit: (event: ChatRunEvent) => void;
}

export function registerChatIpc(
  ipcMainLike: IpcMainLike,
  services: ChatIpcServices,
) {
  ipcMainLike.handle("chat:send", async (_event, request) => {
    const req = request as ChatTurnRequest;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    services.emit({
      type: "started",
      runId,
      threadId: req.threadId,
      agentId: req.agent.id,
    });

    const result = await services.chatRunner.run(req);

    if (result.ok) {
      services.emit({
        type: "completed",
        runId,
        text: result.text ?? "",
        finishedAt: new Date().toISOString(),
      });
    } else {
      services.emit({
        type: "failed",
        runId,
        error: result.error ?? "Unknown error",
      });
    }

    return { runId };
  });

  ipcMainLike.handle("chat:stop", async (_event, runId) => {
    // No-op for one-shot mode; streaming stop handled in Task 5
    void runId;
    return undefined;
  });
}
