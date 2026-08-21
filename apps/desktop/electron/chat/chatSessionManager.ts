import {
  createAgentCore,
  loadAgentAuth,
  writeUserPermissionRule,
  type AgentApprovalRequest,
} from "@carrent/core";

import type {
  AgentTimelineItem,
  ChatRunEvent,
  ChatTurnRequest,
  DeleteThreadDataRequest,
  ThreadDataDeletionOptions,
  ThreadDataDeletionReceipt,
} from "../../src/shared/chat";
import type { ChatPermissionResponse } from "../../src/shared/chatPermissions";
import type { ChatQuestionResponse } from "../../src/shared/chatQuestions";
import type { AttachmentStore } from "../attachments/attachmentStore";
import type { AgentDebugStore } from "./agentDebugStore";
import { buildChatPrompt } from "./chatPrompt";

export type SpawnFn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeout?: number;
    windowsHide?: boolean;
    env?: NodeJS.ProcessEnv;
    stdio?: ["ignore" | "pipe", "pipe", "pipe"];
  },
) => import("node:child_process").ChildProcess;

export interface ChatSessionManager {
  start: (runId: string, request: ChatTurnRequest) => void;
  stop: (runId: string) => void;
  shutdown: () => Promise<void>;
  hasLiveRuns?: () => boolean;
  deleteThreadData: (
    request: DeleteThreadDataRequest,
    options?: ThreadDataDeletionOptions,
  ) => Promise<ThreadDataDeletionReceipt | void>;
  rollbackThreadDataDeletion?: (receipt: ThreadDataDeletionReceipt) => Promise<void>;
  hasLiveRunForThreads?: (threadIds: string[]) => boolean;
  setThreadsRelocating?: (threadIds: string[], relocating: boolean) => void;
  resetThreadState?: () => void;
  respondToPermission: (response: ChatPermissionResponse) => void;
  respondToQuestion: (response: ChatQuestionResponse) => void;
}

type ChatRunEventInput = ChatRunEvent extends infer Event
  ? Event extends ChatRunEvent
    ? Omit<Event, "runId" | "requestKey">
    : never
  : never;

type LiveRun = { threadId: string; requestKey?: string; cancel: () => void };
type PendingApproval = {
  runId: string;
  threadId: string;
  request: AgentApprovalRequest;
  workingDirectory: string;
  resolve: (decision: "allow_once" | "allow_session" | "allow_always" | "reject") => void;
};

function permissionOptions() {
  return [
    { optionId: "allow_once", name: "Allow once", kind: "allow_once" as const },
    { optionId: "allow_session", name: "Allow for session", kind: "allow_session" as const },
    { optionId: "allow_always", name: "Always allow", kind: "allow_always" as const },
    { optionId: "reject", name: "Reject", kind: "reject_once" as const },
    { optionId: "reject_explain", name: "Reject and explain", kind: "reject_once" as const },
  ];
}

function modeOf(request: ChatTurnRequest) {
  if (request.agentMode === "auto-edit") return "auto-edit" as const;
  if (request.agentMode === "full-project") return "full-project" as const;
  return "ask" as const;
}

function stringifyToolResult(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "");
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return JSON.stringify(result);
  return content
    .flatMap((item) =>
      item && typeof item === "object" && "text" in item && typeof item.text === "string"
        ? [item.text]
        : [],
    )
    .join("\n");
}

export function createChatSessionManager(options: {
  emit: (event: ChatRunEvent) => void;
  spawn?: SpawnFn;
  attachmentStore?: AttachmentStore;
  agentCore?: ReturnType<typeof createAgentCore>;
  loadAuth?: typeof loadAgentAuth;
  debugStore?: AgentDebugStore;
  clientVersion?: string;
  persistPermissionRule?: (rule: {
    prefix: string[];
    decision: "allow";
    domain?: string;
  }) => Promise<void>;
}): ChatSessionManager {
  const core = options.agentCore ?? createAgentCore({ clientVersion: options.clientVersion });
  const liveRuns = new Map<string, LiveRun>();
  const pendingApprovals = new Map<string, PendingApproval>();
  const approvalGrantsByRun = new Map<string, Set<string>>();
  const deletedThreadIds = new Set<string>();
  const relocatingThreadIds = new Set<string>();

  function emit(runId: string, request: ChatTurnRequest, event: ChatRunEventInput) {
    options.emit({
      ...event,
      runId,
      ...(request.requestKey ? { requestKey: request.requestKey } : {}),
    } as ChatRunEvent);
  }

  function start(runId: string, request: ChatTurnRequest) {
    if (!request.context.workingDirectory) {
      emit(runId, request, { type: "failed", error: "Select a Project before starting a Run." });
      return;
    }
    if (deletedThreadIds.has(request.threadId) || relocatingThreadIds.has(request.threadId)) {
      emit(runId, request, { type: "failed", error: "This Thread is temporarily unavailable." });
      return;
    }

    let cancelled = false;
    let handle: ReturnType<typeof core.run> | null = null;
    liveRuns.set(runId, {
      threadId: request.threadId,
      requestKey: request.requestKey,
      cancel: () => {
        cancelled = true;
        handle?.cancel();
        for (const [id, approval] of pendingApprovals) {
          if (approval.runId === runId) {
            pendingApprovals.delete(id);
            approval.resolve("reject");
          }
        }
      },
    });
    emit(runId, request, { type: "started", threadId: request.threadId });
    options.debugStore?.append(request.threadId, {
      runId,
      type: "run.requested",
      raw: {
        type: "run.requested",
        runId,
        threadId: request.threadId,
        providerProfileId: request.providerProfileId,
        agentMode: request.agentMode,
        workingDirectory: request.context.workingDirectory,
        historyMode: request.historyMode ?? "append",
        transcript: request.transcript,
        prompt: request.message,
      },
    });

    void (async () => {
      const auth = await (options.loadAuth ?? loadAgentAuth)();
      if (!auth) {
        throw new Error("Configure a Provider Profile in ~/.carrent/agent/auth.json first.");
      }
      const profile = auth.profiles[request.providerProfileId];
      if (!profile) {
        throw new Error(`Provider Profile ${request.providerProfileId} does not exist.`);
      }

      const timeline = new Map<string, AgentTimelineItem>();
      const writtenFiles = new Set<string>();
      let order = 0;
      let thinking = "";
      handle = core.run({
        id: runId,
        workingDirectory: request.context.workingDirectory,
        profile,
        mode: modeOf(request),
        transcript: request.historyMode === "replace" ? [] : request.transcript,
        prompt: buildChatPrompt(request, { includeTranscript: false }),
        trustedProject: request.context.trustedProject,
        requestApproval: async (approvalRequest) => {
          const grants = approvalGrantsByRun.get(runId);
          const grantKey = `${request.context.workingDirectory}\n${approvalRequest.normalizedCommand ?? approvalRequest.allowAlwaysKey}`;
          if (grants?.has(grantKey)) {
            options.debugStore?.append(request.threadId, {
              runId,
              type: "approval.resolved",
              raw: {
                type: "approval.resolved",
                request: approvalRequest,
                decision: "allow_always",
                source: "stored-grant",
              },
            });
            return "allow_always";
          }
          options.debugStore?.append(request.threadId, {
            runId,
            type: "approval.requested",
            raw: { type: "approval.requested", request: approvalRequest },
          });
          return new Promise((resolve) => {
            pendingApprovals.set(approvalRequest.id, {
              runId,
              threadId: request.threadId,
              request: approvalRequest,
              workingDirectory: request.context.workingDirectory,
              resolve,
            });
            emit(runId, request, {
              type: "permission-requested",
              permission: {
                id: approvalRequest.id,
                runId,
                requestKey: request.requestKey,
                threadId: request.threadId,
                provider: "core",
                action: approvalRequest.action === "dangerous" ? "shell" : approvalRequest.action,
                title: approvalRequest.title,
                description: approvalRequest.description,
                command: approvalRequest.command,
                warning: approvalRequest.warning,
                filePath: approvalRequest.path,
                toolName: approvalRequest.toolName,
                options: permissionOptions(),
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
              },
            });
          });
        },
        onEvent: (event) => {
          if (event.type === "run-context") {
            options.debugStore?.append(request.threadId, {
              runId,
              type: "core.context",
              raw: { ...event, type: "core.context" },
            });
          } else if (event.type === "agent-event") {
            options.debugStore?.append(request.threadId, {
              runId,
              type: event.event.type,
              raw: event.event as unknown as Record<string, unknown>,
            });
          } else if (event.type === "text-delta") {
            emit(runId, request, { type: "delta", text: event.delta });
          } else if (event.type === "thinking_delta") {
            thinking += event.delta;
            emit(runId, request, {
              type: "reasoning",
              reasoning: { id: `${runId}:reasoning`, content: thinking, status: "running" },
            });
          } else if (event.type === "tool-start") {
            const args =
              event.args && typeof event.args === "object"
                ? (event.args as Record<string, unknown>)
                : {};
            const item: AgentTimelineItem = {
              type: "tool",
              id: event.toolCallId,
              order: order++,
              toolCallId: event.toolCallId,
              title: event.toolName,
              kind: event.toolName,
              command: typeof args.command === "string" ? args.command : "",
              filePath: typeof args.path === "string" ? args.path : "",
              input: JSON.stringify(event.args, null, 2),
              output: "",
              error: "",
              status: "running",
            };
            timeline.set(event.toolCallId, item);
            emit(runId, request, { type: "agent-timeline", item });
          } else if (event.type === "tool-end") {
            const previous = timeline.get(event.toolCallId);
            if (!previous || previous.type !== "tool") return;
            const details =
              event.result && typeof event.result === "object"
                ? (event.result as { details?: { path?: unknown } }).details
                : undefined;
            if (
              (event.toolName === "write" || event.toolName === "edit") &&
              typeof details?.path === "string"
            ) {
              writtenFiles.add(details.path);
            }
            const output = stringifyToolResult(event.result);
            const item: AgentTimelineItem = {
              ...previous,
              output: event.isError ? "" : output,
              error: event.isError ? output : "",
              status: event.isError ? "failed" : "completed",
            };
            timeline.set(event.toolCallId, item);
            emit(runId, request, { type: "agent-timeline", item });
          }
        },
      });
      const result = await handle.result;
      if (thinking) {
        emit(runId, request, {
          type: "reasoning",
          reasoning: { id: `${runId}:reasoning`, content: thinking, status: "completed" },
        });
      }
      emit(runId, request, {
        type: "completed",
        text: result.text,
        finishedAt: new Date().toISOString(),
        writtenFiles: [...writtenFiles],
      });
      options.debugStore?.append(request.threadId, {
        runId,
        type: "run.completed",
        raw: {
          type: "run.completed",
          text: result.text,
          writtenFiles: [...writtenFiles],
        },
      });
    })()
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Agent Core failed.";
        options.debugStore?.append(request.threadId, {
          runId,
          type: cancelled ? "run.stopped" : "run.failed",
          raw: {
            type: cancelled ? "run.stopped" : "run.failed",
            ...(cancelled ? {} : { error: message }),
          },
        });
        emit(
          runId,
          request,
          cancelled
            ? { type: "stopped" }
            : {
                type: "failed",
                error: message,
              },
        );
      })
      .finally(() => {
        liveRuns.delete(runId);
        approvalGrantsByRun.delete(runId);
        for (const [id, approval] of pendingApprovals) {
          if (approval.runId === runId) pendingApprovals.delete(id);
        }
      });
  }

  function stop(runId: string) {
    liveRuns.get(runId)?.cancel();
  }

  function respondToPermission(response: ChatPermissionResponse) {
    const pending = pendingApprovals.get(response.permissionId);
    if (!pending || pending.runId !== response.runId) return;
    const explainRejection = response.optionId === "reject_explain";
    const decision =
      response.optionId === "allow_once" ||
      response.optionId === "allow_session" ||
      response.optionId === "allow_always"
        ? response.optionId
        : "reject";
    pendingApprovals.delete(response.permissionId);
    const grantKey = `${pending.workingDirectory}\n${pending.request.normalizedCommand ?? pending.request.allowAlwaysKey}`;
    if (decision === "allow_session") {
      const grants = approvalGrantsByRun.get(pending.runId) ?? new Set<string>();
      grants.add(grantKey);
      approvalGrantsByRun.set(pending.runId, grants);
    }
    if (decision === "allow_always") {
      const prefix = (
        pending.request.normalizedCommand ??
        pending.request.command ??
        (pending.request.path ? `${pending.request.action} ${pending.request.path}` : "")
      )
        .split(" ")
        .filter(Boolean);
      if (prefix.length > 0) {
        const rule = pending.request.networkHost
          ? { prefix: [], domain: pending.request.networkHost, decision: "allow" as const }
          : { prefix, decision: "allow" as const };
        void (
          options.persistPermissionRule
            ? options.persistPermissionRule(rule)
            : writeUserPermissionRule({ rule })
        ).catch(() => undefined);
      }
    }
    options.debugStore?.append(pending.threadId, {
      runId: response.runId,
      type: "approval.resolved",
      raw: {
        type: "approval.resolved",
        request: pending.request,
        decision,
      },
    });
    options.emit({
      type: "permission-resolved",
      runId: response.runId,
      permissionId: response.permissionId,
      optionId: response.optionId,
      optionName:
        decision === "allow_once"
          ? "Allow once"
          : decision === "allow_session"
            ? "Allow for session"
            : decision === "allow_always"
              ? "Always allow"
              : "Reject",
      optionKind:
        decision === "allow_once"
          ? "allow_once"
          : decision === "allow_session"
            ? "allow_session"
            : decision === "allow_always"
              ? "allow_always"
              : "reject_once",
    });
    pending.resolve(decision);
    if (explainRejection) liveRuns.get(response.runId)?.cancel();
  }

  const hasLiveRunForThreads = (threadIds: string[]) => {
    const ids = new Set(threadIds);
    return [...liveRuns.values()].some((run) => ids.has(run.threadId));
  };

  return {
    start,
    stop,
    hasLiveRuns: () => liveRuns.size > 0,
    shutdown: async () => {
      for (const run of liveRuns.values()) run.cancel();
      liveRuns.clear();
    },
    deleteThreadData: async (request) => {
      options.debugStore?.deleteThreads(request.threadIds);
      request.threadIds.forEach((threadId) => {
        deletedThreadIds.add(threadId);
        for (const runId of approvalGrantsByRun.keys()) {
          if (!liveRuns.has(runId)) approvalGrantsByRun.delete(runId);
        }
      });
      for (const [runId, run] of liveRuns) {
        if (request.threadIds.includes(run.threadId)) stop(runId);
      }
      return {
        threadIds: request.threadIds,
      };
    },
    rollbackThreadDataDeletion: async (receipt) => {
      receipt.threadIds.forEach((threadId) => deletedThreadIds.delete(threadId));
    },
    hasLiveRunForThreads,
    setThreadsRelocating: (threadIds, relocating) => {
      threadIds.forEach((threadId) => {
        if (relocating) relocatingThreadIds.add(threadId);
        else relocatingThreadIds.delete(threadId);
      });
    },
    resetThreadState: () => approvalGrantsByRun.clear(),
    respondToPermission,
    respondToQuestion: (_response) => {},
  };
}
