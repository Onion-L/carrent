import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  type ChangedFilesMessage,
  type Message,
  type MessagePart,
} from "../../shared/threadContent";
import {
  getThreadWorkSnapshot,
  getThreadWorkVersion,
  hydrateThreadWork,
  removeThreadWork,
  subscribeToThreadWork,
  syncThreadWorkFromSnapshot,
} from "../hooks/chatMessageQueue";
import type { RuntimeId } from "../../shared/runtimes";
import { reconcileInterruptedRuns } from "../lib/interruptedRuns";
import type {
  DeleteThreadDataRequest,
  AttachmentMetadata,
  ThreadDeletionAppStateSnapshots,
} from "../../shared/chat";
import type {
  AppThreadMessageRecord,
  AppProjectRecord,
  AppThreadRecord,
  ThreadWorkSnapshot,
} from "../../shared/workspacePersistence";
import type { GitWorkspaceDiffResult } from "../../../electron/git/gitIpc";
import type { RunChecklistEntry, RunChecklistOutcome } from "../../shared/runChecklist";
import { useAppState } from "./AppStateContext";

type MessageRunStatus = NonNullable<Message["runStatus"]>;

export type RunChecklistUpdate =
  | { kind: "started"; runId: string }
  | {
      kind: "snapshot";
      runId: string;
      runtimeId: RuntimeId;
      entries: RunChecklistEntry[];
    }
  | { kind: "outcome"; runId: string; outcome: Exclude<RunChecklistOutcome, "running"> }
  | { kind: "expanded"; expanded: boolean };

export function applyRunChecklistUpdate(
  thread: AppThreadRecord,
  update: RunChecklistUpdate,
): AppThreadRecord {
  if (update.kind === "started" || (update.kind === "snapshot" && update.entries.length === 0)) {
    const { runChecklist: _runChecklist, ...threadWithoutChecklist } = thread;
    return threadWithoutChecklist;
  }

  if (update.kind === "snapshot") {
    return {
      ...thread,
      runChecklist: {
        runId: update.runId,
        runtimeId: update.runtimeId,
        entries: update.entries,
        outcome: "running",
        expanded: thread.runChecklist?.runId === update.runId ? thread.runChecklist.expanded : true,
      },
    };
  }

  if (!thread.runChecklist) {
    return thread;
  }

  if (update.kind === "outcome") {
    if (thread.runChecklist.runId !== update.runId) {
      return thread;
    }
    return {
      ...thread,
      runChecklist: { ...thread.runChecklist, outcome: update.outcome },
    };
  }

  return {
    ...thread,
    runChecklist: { ...thread.runChecklist, expanded: update.expanded },
  };
}

export type ThreadContentContextValue = {
  messages: Message[];
  selectedThreadId: string | null;
  hasHydrated: boolean;
  currentThread: AppThreadRecord | null;
  currentProject: AppProjectRecord | null;
  getThreadRouteData: (
    projectId: string,
    threadId: string,
  ) => {
    project: AppProjectRecord;
    thread: AppThreadRecord;
    messages: Message[];
  } | null;
  setSelectedThreadId: (id: string | null) => void;
  renameThread: (projectId: string, threadId: string, newTitle: string) => boolean;
  markThreadActivity: (threadId: string, at?: number) => void;
  upsertThread: (projectId: string, thread: AppThreadRecord) => void;
  removeThreadFromState: (threadId: string) => void;
  removeMessages: (messageIds: string[]) => void;
  toggleThreadPin: (projectId: string, threadId: string) => void;
  deleteThread: (
    threadId: string,
    appStateSnapshots?: ThreadDeletionAppStateSnapshots,
  ) => Promise<string | null>;
  deleteThreads: (
    threadIds: string[],
    appStateSnapshots: ThreadDeletionAppStateSnapshots,
  ) => Promise<void>;
  upsertMessages: (messages: Message[]) => void;
  appendMessage: (message: {
    threadId: string;
    role: "user" | "assistant";
    content: string;
    attachments?: AttachmentMetadata[];
    runStatus?: MessageRunStatus;
  }) => Message;
  appendWorkspaceDiffMessage: (
    threadId: string,
    result: Extract<GitWorkspaceDiffResult, { state: "ready" }>,
  ) => ChangedFilesMessage;
  updateMessage: (id: string, content: string) => void;
  updateMessageAndPruneAfter: (id: string, content: string) => void;
  updateMessageRunStatus: (id: string, status: MessageRunStatus) => void;
  updateMessageRunEventCount: (id: string, count: number) => void;
  updateMessageParts: (id: string, update: MessagePartUpdate) => void;
  updateRunChecklist: (threadId: string, update: RunChecklistUpdate) => void;
};

export type MessagePartUpdate =
  | { kind: "append-text"; content: string }
  | { kind: "replace-text"; content: string }
  | {
      kind: "upsert-kimi-timeline";
      item: import("../../shared/chat").KimiTimelineItem;
    }
  | {
      kind: "upsert-reasoning";
      reasoning: Extract<MessagePart, { type: "reasoning" }>;
    }
  | {
      kind: "upsert-shell";
      shell: Extract<MessagePart, { type: "shell" }>;
    }
  | {
      kind: "upsert-plan-review";
      review: Extract<MessagePart, { type: "plan_review" }>;
    }
  | {
      kind: "resolve-plan-review";
      permissionId: string;
      status: Extract<MessagePart, { type: "plan_review" }>["status"];
      selectedOptionId?: string;
      selectedOptionName?: string;
    }
  | { kind: "interrupt-plan-reviews" }
  | {
      kind: "upsert-question";
      question: Extract<MessagePart, { type: "question" }>;
    }
  | {
      kind: "resolve-question";
      questionId: string;
      status: "answered" | "skipped";
      answers?: Extract<MessagePart, { type: "question" }>["answers"];
    }
  | { kind: "interrupt-questions" }
  | {
      kind: "upsert-subagent-task";
      task: Extract<MessagePart, { type: "subagent_task" }>;
    }
  | { kind: "interrupt-subagent-tasks" }
  | {
      kind: "upsert-error";
      error: Extract<MessagePart, { type: "error" }>;
    };

const ThreadContentContext = createContext<ThreadContentContextValue>({
  messages: [],
  selectedThreadId: null,
  hasHydrated: false,
  currentThread: null,
  currentProject: null,
  getThreadRouteData: () => null,
  setSelectedThreadId: () => {},
  renameThread: () => false,
  markThreadActivity: () => {},
  upsertThread: () => {},
  removeThreadFromState: () => {},
  removeMessages: () => {},
  toggleThreadPin: () => {},
  deleteThread: async () => null,
  deleteThreads: async () => {},
  upsertMessages: () => {},
  appendMessage: () => ({
    id: "",
    role: "user",
    threadId: "",
    content: "",
    timestamp: "",
    type: "text",
  }),
  appendWorkspaceDiffMessage: () =>
    ({
      id: "",
      role: "assistant",
      threadId: "",
      timestamp: "",
      type: "changed_files",
      changedFiles: [],
    }) as ChangedFilesMessage,
  updateMessage: () => {},
  updateMessageAndPruneAfter: () => {},
  updateMessageRunStatus: () => {},
  updateMessageRunEventCount: () => {},
  updateMessageParts: () => {},
  updateRunChecklist: () => {},
});

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Compares Thread work ignoring requiresConfirmation: the persisted form
// forces it for crash recovery while the live store tracks steerability.
function threadWorkCompareKey(work: Record<string, ThreadWorkSnapshot>): string {
  return JSON.stringify(work, (key, value) => (key === "requiresConfirmation" ? undefined : value));
}

export function resolveWorkspaceThreadRouteData(
  projects: AppProjectRecord[],
  threads: AppThreadRecord[],
  messages: Message[],
  projectId: string,
  threadId: string,
) {
  const project = projects.find((item) => item.id === projectId);
  const thread = threads.find((item) => item.id === threadId && item.projectId === projectId);
  if (!project || !thread) {
    return null;
  }

  return {
    project,
    thread,
    messages: messages.filter((message) => message.threadId === threadId),
  };
}

export function mergeThreadMessages(existingMessages: Message[], incomingMessages: Message[]) {
  const incomingById = new Map(incomingMessages.map((message) => [message.id, message]));
  const merged = existingMessages.map((message) => incomingById.get(message.id) ?? message);
  const knownIds = new Set(existingMessages.map((message) => message.id));

  incomingMessages.forEach((message) => {
    if (!knownIds.has(message.id)) {
      merged.push(message);
    }
  });

  return merged;
}

export function buildChangedFilesMessage({
  threadId,
  result,
  now,
  formatTime: formatTimeFn,
}: {
  threadId: string;
  result: Extract<GitWorkspaceDiffResult, { state: "ready" }>;
  now: number;
  formatTime: (date: Date) => string;
}): ChangedFilesMessage {
  return {
    id: `msg-${now}-${Math.random().toString(36).slice(2, 7)}`,
    role: "assistant",
    threadId,
    timestamp: formatTimeFn(new Date(now)),
    createdAt: new Date(now).toISOString(),
    type: "changed_files",
    content: "Workspace changes",
    changedFiles: result.files.map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      binary: file.binary,
      untracked: file.untracked,
      ...(file.omitted ? { omitted: true } : {}),
    })),
    snapshot: {
      baseRevision: result.baseRevision,
      capturedAt: result.capturedAt,
      patch: result.patch,
      truncated: result.truncated,
    },
  };
}

export function removeMessagesForThreads(messages: Message[], requestedThreadIds: string[]) {
  const threadIds = new Set(requestedThreadIds);
  return messages.filter((message) => !threadIds.has(message.threadId));
}

export function prepareThreadDataDeletion(
  messages: Message[],
  requestedThreadIds: string[],
  threadWork?: Record<string, ThreadWorkSnapshot>,
): { request: DeleteThreadDataRequest; remainingMessages: Message[] } {
  const threadIds = [...new Set(requestedThreadIds)];
  const deletedThreadIds = new Set(threadIds);
  const attachmentOwners = new Map<string, Set<string>>();

  for (const message of messages) {
    if (message.type === "changed_files") {
      continue;
    }
    for (const attachment of message.attachments ?? []) {
      const owners = attachmentOwners.get(attachment.storageKey) ?? new Set<string>();
      owners.add(message.threadId);
      attachmentOwners.set(attachment.storageKey, owners);
    }
  }

  // Drafts and queued messages own their attachments exactly like sent
  // Messages; deleting a Thread must not drop a storage key still referenced
  // by a surviving draft or queue.
  for (const [threadId, work] of Object.entries(threadWork ?? {})) {
    const wipAttachments = [
      ...(work.draft?.attachments ?? []),
      ...(work.queuedMessages ?? []).flatMap((item) => item.attachments ?? []),
    ];
    for (const attachment of wipAttachments) {
      const owners = attachmentOwners.get(attachment.storageKey) ?? new Set<string>();
      owners.add(threadId);
      attachmentOwners.set(attachment.storageKey, owners);
    }
  }

  const attachmentStorageKeys: string[] = [];
  for (const [storageKey, owners] of attachmentOwners) {
    if (![...owners].some((threadId) => deletedThreadIds.has(threadId))) {
      continue;
    }
    if ([...owners].some((threadId) => !deletedThreadIds.has(threadId))) continue;
    attachmentStorageKeys.push(storageKey);
  }

  return {
    request: { threadIds, attachmentStorageKeys },
    remainingMessages: removeMessagesForThreads(messages, threadIds),
  };
}

export async function deleteThreadMessagesAfterCleanup(
  messages: Message[],
  threadIds: string[],
  cleanup: (request: DeleteThreadDataRequest) => Promise<void>,
  threadWork?: Record<string, ThreadWorkSnapshot>,
) {
  const deletion = prepareThreadDataDeletion(messages, threadIds, threadWork);
  await cleanup(deletion.request);
  return deletion.remainingMessages;
}

export function updateMessageAndPruneThreadAfter(
  messages: Message[],
  messageId: string,
  content: string,
) {
  const targetIndex = messages.findIndex((message) => message.id === messageId);
  const target = messages[targetIndex];

  if (!target || target.type === "changed_files") {
    return messages;
  }

  return messages
    .slice(0, targetIndex + 1)
    .map((message) =>
      message.id === messageId ? { ...message, content, parts: undefined } : message,
    )
    .concat(
      messages.slice(targetIndex + 1).filter((message) => message.threadId !== target.threadId),
    );
}

function getTextMessageParts(message: Message) {
  if (message.type === "changed_files") {
    return [];
  }

  if (message.parts) {
    return [...message.parts];
  }

  return message.content ? [{ type: "text" as const, content: message.content }] : [];
}

export function applyMessagePartUpdate(message: Message, update: MessagePartUpdate): Message {
  if (message.type === "changed_files") {
    return message;
  }

  const parts = getTextMessageParts(message);

  if (update.kind === "append-text") {
    if (!update.content) {
      return message;
    }

    const lastPart = parts.at(-1);
    if (lastPart?.type === "text") {
      parts[parts.length - 1] = {
        ...lastPart,
        content: lastPart.content + update.content,
      };
    } else {
      parts.push({ type: "text", content: update.content });
    }

    return {
      ...message,
      content: message.content + update.content,
      parts,
    };
  }

  if (update.kind === "replace-text") {
    if (message.content === update.content) return message;
    const textIndex = parts.findIndex((part) => part.type === "text");
    const withoutText: MessagePart[] = parts.filter((part) => part.type !== "text");
    if (update.content) {
      withoutText.splice(
        Math.min(textIndex < 0 ? withoutText.length : textIndex, withoutText.length),
        0,
        {
          type: "text",
          content: update.content,
        },
      );
    }
    return { ...message, content: update.content, parts: withoutText };
  }

  if (update.kind === "upsert-reasoning") {
    const reasoningIndex = parts.findIndex(
      (part) => part.type === "reasoning" && part.id === update.reasoning.id,
    );
    if (reasoningIndex >= 0) {
      parts[reasoningIndex] = update.reasoning;
    } else {
      parts.push(update.reasoning);
    }

    return {
      ...message,
      parts,
    };
  }

  if (update.kind === "upsert-kimi-timeline") {
    const timelineIndex = parts.findIndex(
      (part) => part.type === "kimi_timeline" && part.item.id === update.item.id,
    );
    const nextPart = { type: "kimi_timeline" as const, item: update.item };
    if (timelineIndex >= 0) {
      const existing = parts[timelineIndex] as Extract<MessagePart, { type: "kimi_timeline" }>;
      const item = { ...update.item, order: existing.item.order };
      if (
        existing.item.type === "tool" &&
        item.type === "tool" &&
        (existing.item.status === "completed" ||
          existing.item.status === "failed" ||
          existing.item.status === "cancelled") &&
        (item.status === "pending" || item.status === "running")
      ) {
        item.status = existing.item.status;
      }
      parts[timelineIndex] = {
        ...nextPart,
        item,
      };
    } else {
      parts.push(nextPart);
    }

    return { ...message, parts };
  }

  if (update.kind === "upsert-plan-review") {
    const reviewIndex = parts.findIndex(
      (part) =>
        part.type === "plan_review" &&
        (part.id === update.review.id || part.permissionId === update.review.permissionId),
    );
    if (reviewIndex >= 0) {
      parts[reviewIndex] = update.review;
    } else {
      parts.push(update.review);
    }

    return {
      ...message,
      parts,
    };
  }

  if (update.kind === "resolve-plan-review") {
    return {
      ...message,
      parts: parts.map((part) =>
        part.type === "plan_review" && part.permissionId === update.permissionId
          ? {
              ...part,
              status: update.status,
              selectedOptionId: update.selectedOptionId,
              selectedOptionName: update.selectedOptionName,
            }
          : part,
      ),
    };
  }

  if (update.kind === "interrupt-plan-reviews") {
    return {
      ...message,
      parts: parts.map((part) =>
        part.type === "plan_review" && part.status === "pending"
          ? { ...part, status: "interrupted" }
          : part,
      ),
    };
  }

  if (update.kind === "upsert-question") {
    const questionIndex = parts.findIndex(
      (part) =>
        part.type === "question" &&
        (part.id === update.question.id || part.questionId === update.question.questionId),
    );
    if (questionIndex >= 0) {
      parts[questionIndex] = update.question;
    } else {
      parts.push(update.question);
    }

    return {
      ...message,
      parts,
    };
  }

  if (update.kind === "resolve-question") {
    return {
      ...message,
      parts: parts.map((part) =>
        part.type === "question" && part.questionId === update.questionId
          ? {
              ...part,
              status: update.status,
              ...(update.answers ? { answers: update.answers } : {}),
            }
          : part,
      ),
    };
  }

  if (update.kind === "interrupt-questions") {
    return {
      ...message,
      parts: parts.map((part) =>
        part.type === "question" && part.status === "pending"
          ? { ...part, status: "interrupted" }
          : part,
      ),
    };
  }

  if (update.kind === "upsert-subagent-task") {
    const taskIndex = parts.findIndex(
      (part) => part.type === "subagent_task" && part.id === update.task.id,
    );
    if (taskIndex >= 0) {
      parts[taskIndex] = update.task;
    } else {
      parts.push(update.task);
    }

    return {
      ...message,
      parts,
    };
  }

  if (update.kind === "interrupt-subagent-tasks") {
    return {
      ...message,
      parts: parts.map((part) =>
        part.type === "subagent_task" && part.status === "running"
          ? { ...part, status: "interrupted" }
          : part,
      ),
    };
  }

  if (update.kind === "upsert-error") {
    const errorIndex = parts.findIndex(
      (part) => part.type === "error" && part.id === update.error.id,
    );
    if (errorIndex >= 0) {
      parts[errorIndex] = update.error;
    } else {
      parts.push(update.error);
    }

    return {
      ...message,
      parts,
    };
  }

  const shellIndex = parts.findIndex(
    (part) => part.type === "shell" && part.id === update.shell.id,
  );
  if (shellIndex >= 0) {
    parts[shellIndex] = update.shell;
  } else {
    parts.push(update.shell);
  }

  return {
    ...message,
    parts,
  };
}

export function ThreadContentProvider({ children }: { children: ReactNode }) {
  const {
    hasHydrated: appStateHasHydrated,
    projects: appStateProjects,
    threads: appStateThreads,
    threadMessages: appStateThreadMessages,
    threadWork: appStateThreadWork,
    updateThreadContent,
    removeThreadSnapshot,
  } = useAppState();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const hydrationCompleteRef = useRef(false);
  const messages: Message[] = appStateThreadMessages.map((message) => ({
    ...message,
    timestamp: message.timestamp ?? formatTime(new Date(message.createdAt)),
  }));
  const currentThread = appStateThreads.find((thread) => thread.id === selectedThreadId) ?? null;
  const currentProject =
    appStateProjects.find((project) => project.id === currentThread?.projectId) ?? null;
  const getThreadRouteData = (projectId: string, threadId: string) =>
    resolveWorkspaceThreadRouteData(
      appStateProjects,
      appStateThreads,
      messages,
      projectId,
      threadId,
    );

  useEffect(() => {
    if (!appStateHasHydrated || hydrationCompleteRef.current) return;
    hydrationCompleteRef.current = true;
    hydrateThreadWork(appStateThreadWork);
    const reconciledMessages = reconcileInterruptedRuns(messages);
    if (reconciledMessages.some((message, index) => message !== messages[index])) {
      updateThreadContent((content) => ({
        ...content,
        threadMessages: reconciledMessages as AppThreadMessageRecord[],
      }));
    }
  }, [appStateHasHydrated, appStateThreadWork, messages, updateThreadContent]);

  const allThreadIds = useMemo(() => appStateThreads.map((thread) => thread.id), [appStateThreads]);
  const threadWorkVersion = useSyncExternalStore(subscribeToThreadWork, getThreadWorkVersion);

  // Reconciles the live queue store with App State Thread work in both
  // directions, one per commit: a store-originated change (version bump)
  // pushes into App State through a Thread work command; an App
  // State-originated change (a broadcast) syncs into the store. Acting on a
  // single effect with effect-time values keeps the two directions from
  // oscillating against each other's render-lagged props.
  const lastThreadWorkVersionRef = useRef(threadWorkVersion);
  useEffect(() => {
    if (!appStateHasHydrated || !hydrationCompleteRef.current) return;
    const versionChanged = threadWorkVersion !== lastThreadWorkVersionRef.current;
    lastThreadWorkVersionRef.current = threadWorkVersion;
    const current = getThreadWorkSnapshot(allThreadIds);
    if (threadWorkCompareKey(current) === threadWorkCompareKey(appStateThreadWork)) return;
    if (versionChanged) {
      updateThreadContent((content) => ({ ...content, threadWork: current }));
      return;
    }
    syncThreadWorkFromSnapshot(appStateThreadWork);
  }, [
    appStateHasHydrated,
    appStateThreadWork,
    allThreadIds,
    threadWorkVersion,
    updateThreadContent,
  ]);

  const renameThread = (projectId: string, threadId: string, newTitle: string) => {
    const title = newTitle.trim();
    if (
      !title ||
      !appStateThreads.some((thread) => thread.id === threadId && thread.projectId === projectId)
    ) {
      return false;
    }
    updateThreadContent((content) => ({
      ...content,
      threads: content.threads.map((thread) =>
        thread.id === threadId ? { ...thread, title, customTitle: true } : thread,
      ),
    }));
    return true;
  };

  const markThreadActivity = (threadId: string, at = Date.now()) => {
    if (!Number.isFinite(at)) {
      return;
    }
    const lastActivityAt = new Date(at).toISOString();
    updateThreadContent((content) => ({
      ...content,
      threads: content.threads.map((thread) =>
        thread.id === threadId ? { ...thread, lastActivityAt } : thread,
      ),
    }));
  };

  const upsertThread = (projectId: string, thread: AppThreadRecord) => {
    if (thread.projectId !== projectId) return;
    updateThreadContent((content) => ({
      ...content,
      threads: content.threads.some((item) => item.id === thread.id)
        ? content.threads.map((item) => (item.id === thread.id ? thread : item))
        : [...content.threads, thread],
    }));
  };

  const removeThreadFromState = (threadId: string) => {
    // Snapshot removal flows through commands (rollback / thread:remove) and
    // their broadcasts; this only resets local selection.
    setSelectedThreadId((prev) => (prev === threadId ? null : prev));
  };

  const removeMessages = (messageIds: string[]) => {
    const ids = new Set(messageIds);
    updateThreadContent((content) => ({
      ...content,
      threadMessages: content.threadMessages.filter((message) => !ids.has(message.id)),
    }));
  };

  const toggleThreadPin = (projectId: string, threadId: string) => {
    updateThreadContent((content) => ({
      ...content,
      threads: content.threads.map((thread) =>
        thread.id === threadId && thread.projectId === projectId
          ? { ...thread, pinned: !thread.pinned || undefined }
          : thread,
      ),
    }));
  };

  const deleteThread = async (
    threadId: string,
    appStateSnapshots?: ThreadDeletionAppStateSnapshots,
  ) => {
    const currentThreadWork = getThreadWorkSnapshot(allThreadIds);
    const deletion = prepareThreadDataDeletion(messages, [threadId], currentThreadWork);
    if (appStateSnapshots) {
      if (!window.carrent.chat.deleteThreadTransaction) {
        throw new Error("Thread deletion transaction is unavailable.");
      }
      await window.carrent.chat.deleteThreadTransaction({
        ...appStateSnapshots,
        threadData: deletion.request,
      });
    } else {
      await window.carrent.chat.deleteThreadData(deletion.request);
      await removeThreadSnapshot(threadId);
    }

    removeThreadWork([threadId]);
    setSelectedThreadId((prev) => (prev === threadId ? null : prev));
    return null;
  };

  const deleteThreads = async (
    requestedThreadIds: string[],
    appStateSnapshots: ThreadDeletionAppStateSnapshots,
  ) => {
    const threadIds = [...new Set(requestedThreadIds)];
    const deletedThreadIds = new Set(threadIds);
    const currentThreadWork = getThreadWorkSnapshot(allThreadIds);
    const deletion = prepareThreadDataDeletion(messages, threadIds, currentThreadWork);
    const remainingAppStateAttachmentKeys = new Set([
      ...(appStateSnapshots.afterAppState.threadMessages ?? []).flatMap((message) =>
        message.attachments.map((attachment) => attachment.storageKey),
      ),
      ...(appStateSnapshots.afterAppState.threadDrafts ?? []).flatMap((draft) =>
        draft.attachments.map((attachment) => attachment.storageKey),
      ),
      ...(appStateSnapshots.afterAppState.threadPromotionIntents ?? []).flatMap((intent) =>
        intent.attachments.map((attachment) => attachment.storageKey),
      ),
    ]);
    const removedAppStateAttachmentKeys = [
      ...(appStateSnapshots.beforeAppState.threadMessages ?? []).flatMap((message) =>
        message.attachments.map((attachment) => attachment.storageKey),
      ),
      ...(appStateSnapshots.beforeAppState.threadDrafts ?? []).flatMap((draft) =>
        draft.attachments.map((attachment) => attachment.storageKey),
      ),
      ...(appStateSnapshots.beforeAppState.threadPromotionIntents ?? []).flatMap((intent) =>
        intent.attachments.map((attachment) => attachment.storageKey),
      ),
    ].filter((storageKey) => !remainingAppStateAttachmentKeys.has(storageKey));
    const attachmentStorageKeys = [
      ...new Set([...deletion.request.attachmentStorageKeys, ...removedAppStateAttachmentKeys]),
    ].filter((storageKey) => !remainingAppStateAttachmentKeys.has(storageKey));
    const nextActiveThreadId =
      selectedThreadId && deletedThreadIds.has(selectedThreadId) ? null : selectedThreadId;
    if (!window.carrent.chat.deleteThreadTransaction) {
      throw new Error("Thread deletion transaction is unavailable.");
    }
    await window.carrent.chat.deleteThreadTransaction({
      ...appStateSnapshots,
      threadData: { ...deletion.request, attachmentStorageKeys },
    });

    removeThreadWork(threadIds);
    setSelectedThreadId(nextActiveThreadId);
  };

  const upsertMessages = (incomingMessages: Message[]) => {
    updateThreadContent((content) => ({
      ...content,
      threadMessages: mergeThreadMessages(
        content.threadMessages as Message[],
        incomingMessages,
      ) as AppThreadMessageRecord[],
    }));
  };

  const appendMessage = (message: {
    threadId: string;
    role: "user" | "assistant";
    content: string;
    attachments?: AttachmentMetadata[];
    runStatus?: MessageRunStatus;
  }): Message => {
    const now = Date.now();
    const newMessage: Message = {
      ...message,
      attachments: message.attachments ?? [],
      type: "text",
      id: `msg-${now}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: formatTime(new Date(now)),
      createdAt: new Date(now).toISOString(),
    };
    updateThreadContent((content) => ({
      ...content,
      threadMessages: [...content.threadMessages, newMessage as AppThreadMessageRecord],
    }));
    return newMessage;
  };

  const appendWorkspaceDiffMessage = (
    threadId: string,
    result: Extract<GitWorkspaceDiffResult, { state: "ready" }>,
  ): ChangedFilesMessage => {
    const now = Date.now();
    const message = buildChangedFilesMessage({ threadId, result, now, formatTime });
    updateThreadContent((content) => ({
      ...content,
      threadMessages: [
        ...content.threadMessages,
        { ...message, attachments: [] } as AppThreadMessageRecord,
      ],
    }));
    return message;
  };

  const updateMessage = (id: string, content: string) => {
    updateThreadContent((state) => ({
      ...state,
      threadMessages: state.threadMessages.map((msg) =>
        msg.id === id && msg.type !== "changed_files" ? { ...msg, content, parts: undefined } : msg,
      ),
    }));
  };

  const updateMessageAndPruneAfter = (id: string, content: string) => {
    updateThreadContent((state) => ({
      ...state,
      threadMessages: updateMessageAndPruneThreadAfter(
        state.threadMessages as Message[],
        id,
        content,
      ) as AppThreadMessageRecord[],
    }));
  };

  const updateMessageRunStatus = (id: string, status: MessageRunStatus) => {
    updateThreadContent((content) => ({
      ...content,
      threadMessages: content.threadMessages.map((msg) => {
        if (msg.id !== id || msg.type === "changed_files") {
          return msg;
        }

        return {
          ...msg,
          runStatus: status,
          runFinishedAt: status === "running" ? undefined : Date.now(),
        };
      }),
    }));
  };

  const updateMessageRunEventCount = (id: string, count: number) => {
    updateThreadContent((content) => ({
      ...content,
      threadMessages: content.threadMessages.map((message) =>
        message.id === id && message.type !== "changed_files"
          ? { ...message, runEventCount: count }
          : message,
      ),
    }));
  };

  const updateMessageParts = (id: string, update: MessagePartUpdate) => {
    updateThreadContent((content) => ({
      ...content,
      threadMessages: content.threadMessages.map((msg) =>
        msg.id === id
          ? (applyMessagePartUpdate(msg as Message, update) as AppThreadMessageRecord)
          : msg,
      ),
    }));
  };

  const updateRunChecklist = (threadId: string, update: RunChecklistUpdate) => {
    updateThreadContent((content) => ({
      ...content,
      threads: content.threads.map((thread) =>
        thread.id === threadId ? applyRunChecklistUpdate(thread, update) : thread,
      ),
    }));
  };

  return (
    <ThreadContentContext.Provider
      value={{
        messages,
        selectedThreadId,
        hasHydrated: appStateHasHydrated,
        currentThread,
        currentProject,
        getThreadRouteData,
        setSelectedThreadId,
        renameThread,
        markThreadActivity,
        upsertThread,
        removeThreadFromState,
        removeMessages,
        toggleThreadPin,
        deleteThread,
        deleteThreads,
        upsertMessages,
        appendMessage,
        appendWorkspaceDiffMessage,
        updateMessage,
        updateMessageAndPruneAfter,
        updateMessageRunStatus,
        updateMessageRunEventCount,
        updateMessageParts,
        updateRunChecklist,
      }}
    >
      {children}
    </ThreadContentContext.Provider>
  );
}

export function useThreadContent() {
  return useContext(ThreadContentContext);
}
