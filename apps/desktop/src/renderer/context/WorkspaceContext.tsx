import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  initialActiveThreadId,
  messages as initialMessages,
  projects as initialProjects,
  type ChangedFilesMessage,
  type Message,
  type MessagePart,
  type ProjectRecord,
  type ThreadRecord,
} from "../mock/uiShellData";
import {
  deleteChatThread,
  deleteThreadInProjects,
  createChatThread,
  createProjectInProjects,
  createThreadInProjects,
  findCurrentChatThread,
  findCurrentProject,
  findCurrentThread,
  markChatThreadActivity,
  markThreadActivityInProjects,
  renameProjectInProjects,
  renameThreadInProjects,
  resolveChatThreadRouteData,
  setChatThreadRuntimeMode,
  setChatThreadPlanMode,
  setChatThreadRuntimeModelId,
  setChatThreadRuntimeId,
  setThreadRuntimeIdInProjects,
  setThreadRuntimeModeInProjects,
  setThreadPlanModeInProjects,
  setThreadRuntimeModelIdInProjects,
  toggleChatThreadPin,
  toggleThreadPinInProjects,
  upsertChatThread,
  upsertThreadInProjects,
} from "../lib/workspaceState";
import {
  buildWorkspaceSnapshot,
  useDebouncedWorkspaceSave,
} from "../hooks/useDebouncedWorkspaceSave";
import {
  getThreadWorkSnapshot,
  getThreadWorkVersion,
  hydrateThreadWork,
  removeThreadWork,
  subscribeToThreadWork,
} from "../hooks/chatMessageQueue";
import type { RuntimeId } from "../../shared/runtimes";
import { reconcileInterruptedRuns } from "../lib/interruptedRuns";
import type { DeleteThreadDataRequest, AttachmentMetadata } from "../../shared/chat";
import type { ThreadWorkSnapshot } from "../../shared/workspacePersistence";
import type { GitWorkspaceDiffResult } from "../../../electron/git/gitIpc";

type MessageRunStatus = NonNullable<Message["runStatus"]>;

export type WorkspaceContextValue = {
  projects: ProjectRecord[];
  chats: ThreadRecord[];
  messages: Message[];
  activeThreadId: string | null;
  hasHydrated: boolean;
  currentThread: ThreadRecord | null;
  currentProject: ProjectRecord | null;
  getThreadRouteData: (
    projectId: string,
    threadId: string,
  ) => {
    project: ProjectRecord;
    thread: ThreadRecord;
    messages: Message[];
  } | null;
  getChatRouteData: (threadId: string) => {
    thread: ThreadRecord;
    messages: Message[];
  } | null;
  setActiveThreadId: (id: string | null) => void;
  createProject: (folderPath: string) => ProjectRecord | null;
  removeProject: (projectId: string) => Promise<void>;
  renameProject: (projectId: string, newName: string) => boolean;
  renameThread: (projectId: string, threadId: string, newTitle: string) => boolean;
  markThreadActivity: (threadId: string, at?: number) => void;
  createThread: (
    projectId: string,
    title: string,
    runtimeId?: RuntimeId,
    runtimeModelId?: string,
  ) => ThreadRecord | null;
  upsertThread: (projectId: string, thread: ThreadRecord) => void;
  promoteDraftThread: (projectId: string, threadId: string) => void;
  toggleThreadPin: (projectId: string, threadId: string) => void;
  deleteThread: (projectId: string, threadId: string) => Promise<string | null>;
  createChat: (
    title: string,
    runtimeId?: RuntimeId,
    runtimeModelId?: string,
  ) => ThreadRecord | null;
  upsertChat: (thread: ThreadRecord) => void;
  toggleChatPin: (threadId: string) => void;
  deleteChat: (threadId: string) => Promise<void>;
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
  updateMessageParts: (id: string, update: MessagePartUpdate) => void;
  setThreadRuntimeMode: (
    projectId: string,
    threadId: string,
    runtimeMode: import("../../shared/runtimeMode").RuntimeMode,
  ) => void;
  setThreadPlanMode: (projectId: string, threadId: string, planMode: boolean) => void;
  setThreadRuntimeId: (projectId: string, threadId: string, runtimeId: RuntimeId) => void;
  setThreadRuntimeModelId: (
    projectId: string,
    threadId: string,
    runtimeModelId: string | undefined,
  ) => void;
  setChatRuntimeMode: (
    threadId: string,
    runtimeMode: import("../../shared/runtimeMode").RuntimeMode,
  ) => void;
  setChatPlanMode: (threadId: string, planMode: boolean) => void;
  setChatRuntimeId: (threadId: string, runtimeId: RuntimeId) => void;
  setChatRuntimeModelId: (threadId: string, runtimeModelId: string | undefined) => void;
};

export type MessagePartUpdate =
  | { kind: "append-text"; content: string }
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
  | { kind: "interrupt-plan-reviews" };

const WorkspaceContext = createContext<WorkspaceContextValue>({
  projects: [],
  chats: [],
  messages: [],
  activeThreadId: null,
  hasHydrated: false,
  currentThread: null,
  currentProject: null,
  getThreadRouteData: () => null,
  getChatRouteData: () => null,
  setActiveThreadId: () => {},
  createProject: () => null,
  removeProject: async () => {},
  renameProject: () => false,
  renameThread: () => false,
  markThreadActivity: () => {},
  createThread: () => null,
  upsertThread: () => {},
  promoteDraftThread: () => {},
  toggleThreadPin: () => {},
  deleteThread: async () => null,
  createChat: () => null,
  upsertChat: () => {},
  toggleChatPin: () => {},
  deleteChat: async () => {},
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
  updateMessageParts: () => {},
  setThreadRuntimeMode: () => {},
  setThreadPlanMode: () => {},
  setThreadRuntimeId: () => {},
  setThreadRuntimeModelId: () => {},
  setChatRuntimeMode: () => {},
  setChatPlanMode: () => {},
  setChatRuntimeId: () => {},
  setChatRuntimeModelId: () => {},
});

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function resolveWorkspaceThreadRouteData(
  projects: ProjectRecord[],
  messages: Message[],
  projectId: string,
  threadId: string,
) {
  const project = projects.find((item) => item.id === projectId);
  const thread = project?.threads.find((item) => item.id === threadId);
  if (!project || !thread) {
    return null;
  }

  return {
    project,
    thread,
    messages: messages.filter((message) => message.threadId === threadId),
  };
}

export function mergeMessagesIntoWorkspace(
  existingMessages: Message[],
  incomingMessages: Message[],
) {
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
    createdAt: now,
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

export function collectProjectThreadIds(projects: ProjectRecord[], projectId: string) {
  return (
    projects.find((project) => project.id === projectId)?.threads.map((thread) => thread.id) ?? []
  );
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
    if (owners.size > 1) {
      throw new Error("An attachment is shared by multiple threads and cannot be deleted safely.");
    }
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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [chats, setChats] = useState<ThreadRecord[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);

  const currentThread =
    findCurrentThread(projects, activeThreadId) ?? findCurrentChatThread(chats, activeThreadId);
  const currentProject = findCurrentProject(projects, activeThreadId);
  const getThreadRouteData = (projectId: string, threadId: string) =>
    resolveWorkspaceThreadRouteData(projects, messages, projectId, threadId);
  const getChatRouteData = (threadId: string) =>
    resolveChatThreadRouteData(chats, messages, threadId);

  useEffect(() => {
    let cancelled = false;

    window.carrent.workspace
      .load()
      .then((snapshot) => {
        if (cancelled) return;
        // Apply persisted work-in-progress before the hydrated UI mounts so a
        // Composer never initializes from an empty queue/draft store.
        hydrateThreadWork(snapshot?.threadWork);
        if (snapshot) {
          setProjects(snapshot.projects);
          setChats(snapshot.chats ?? []);
          setMessages(reconcileInterruptedRuns(snapshot.messages));
          setActiveThreadId(snapshot.activeThreadId);
        } else {
          setProjects(initialProjects);
          setChats([]);
          setMessages(initialMessages);
          setActiveThreadId(initialActiveThreadId);
        }
      })
      .catch((error) => {
        console.error("[workspace] failed to load", error);
        if (!cancelled) {
          hydrateThreadWork(undefined);
          setProjects(initialProjects);
          setChats([]);
          setMessages(initialMessages);
          setActiveThreadId(initialActiveThreadId);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHasHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const allThreadIds = useMemo(
    () => [
      ...projects.flatMap((project) => project.threads.map((thread) => thread.id)),
      ...chats.map((chat) => chat.id),
    ],
    [projects, chats],
  );
  const threadWorkVersion = useSyncExternalStore(subscribeToThreadWork, getThreadWorkVersion);
  const threadWork = useMemo(
    () => getThreadWorkSnapshot(allThreadIds),
    // threadWorkVersion re-runs this memo whenever a draft or queue changes.
    [allThreadIds, threadWorkVersion],
  );

  useDebouncedWorkspaceSave(
    buildWorkspaceSnapshot({ projects, chats, messages, activeThreadId, threadWork }),
    hasHydrated,
  );

  const createProject = (folderPath: string) => {
    const result = createProjectInProjects(projects, folderPath);
    setProjects(result.projects);
    return result.project;
  };

  const removeProject = async (projectId: string) => {
    const threadIds = collectProjectThreadIds(projects, projectId);
    if (threadIds.length > 0) {
      await deleteThreadMessagesAfterCleanup(
        messages,
        threadIds,
        window.carrent.chat.deleteThreadData,
        getThreadWorkSnapshot(allThreadIds),
      );
      removeThreadWork(threadIds);
    }
    setProjects((prev) => prev.filter((project) => project.id !== projectId));
    if (threadIds.length > 0) {
      setMessages((prev) => removeMessagesForThreads(prev, threadIds));
    }
    setActiveThreadId((prev) => (prev && threadIds.includes(prev) ? null : prev));
  };

  const renameProject = (projectId: string, newName: string) => {
    const result = renameProjectInProjects(projects, projectId, newName);
    if (result.renamed) {
      setProjects(result.projects);
    }
    return result.renamed;
  };

  const renameThread = (projectId: string, threadId: string, newTitle: string) => {
    const title = newTitle.trim();
    if (!title) {
      return false;
    }
    setProjects((prev) => renameThreadInProjects(prev, projectId, threadId, title).projects);
    return true;
  };

  const markThreadActivity = (threadId: string, at = Date.now()) => {
    if (!Number.isFinite(at)) {
      return;
    }
    const lastActivityAt = new Date(at).toISOString();
    setProjects((prev) => markThreadActivityInProjects(prev, threadId, lastActivityAt));
    setChats((prev) => markChatThreadActivity(prev, threadId, lastActivityAt));
  };

  const createThread = (
    projectId: string,
    title: string,
    runtimeId?: RuntimeId,
    runtimeModelId?: string,
  ) => {
    const project = projects.find((p) => p.id === projectId);
    const existingDraft = project?.threads.find((t) => t.draft);
    if (existingDraft) {
      setActiveThreadId(existingDraft.id);
      return existingDraft;
    }

    const result = createThreadInProjects(
      projects,
      projectId,
      title,
      runtimeId,
      runtimeModelId,
      true,
    );
    if (!result.thread) {
      return null;
    }

    setProjects(result.projects);
    setActiveThreadId(result.thread.id);
    return result.thread;
  };

  const promoteDraftThread = (projectId: string, threadId: string) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) {
          return project;
        }

        return {
          ...project,
          threads: project.threads.map((thread) =>
            thread.id === threadId ? { ...thread, draft: undefined } : thread,
          ),
        };
      }),
    );
  };

  const upsertThread = (projectId: string, thread: ThreadRecord) => {
    setProjects((prev) => upsertThreadInProjects(prev, projectId, thread));
  };

  const toggleThreadPin = (projectId: string, threadId: string) => {
    setProjects((prev) => toggleThreadPinInProjects(prev, projectId, threadId));
  };

  const createChat = (title: string, runtimeId?: RuntimeId, runtimeModelId?: string) => {
    const thread = createChatThread(title, runtimeId, runtimeModelId);
    if (!thread) {
      return null;
    }
    setChats((prev) => [thread, ...prev]);
    setActiveThreadId(thread.id);
    return thread;
  };

  const upsertChat = (thread: ThreadRecord) => {
    setChats((prev) => upsertChatThread(prev, thread));
  };

  const toggleChatPin = (threadId: string) => {
    setChats((prev) => toggleChatThreadPin(prev, threadId));
  };

  const deleteChat = async (threadId: string) => {
    await deleteThreadMessagesAfterCleanup(
      messages,
      [threadId],
      window.carrent.chat.deleteThreadData,
      getThreadWorkSnapshot(allThreadIds),
    );
    removeThreadWork([threadId]);
    setChats((prev) => deleteChatThread(prev, threadId));
    setMessages((prev) => removeMessagesForThreads(prev, [threadId]));
    setActiveThreadId((prev) => (prev === threadId ? null : prev));
  };

  const deleteThread = async (projectId: string, threadId: string) => {
    const result = deleteThreadInProjects(projects, projectId, threadId);
    await deleteThreadMessagesAfterCleanup(
      messages,
      [threadId],
      window.carrent.chat.deleteThreadData,
      getThreadWorkSnapshot(allThreadIds),
    );
    removeThreadWork([threadId]);
    setProjects((prev) => deleteThreadInProjects(prev, projectId, threadId).projects);
    setMessages((prev) => removeMessagesForThreads(prev, [threadId]));
    setActiveThreadId((prev) => (prev === threadId ? result.nextActiveThreadId : prev));
    return result.nextActiveThreadId;
  };

  const setThreadRuntimeMode = (
    projectId: string,
    threadId: string,
    runtimeMode: import("../../shared/runtimeMode").RuntimeMode,
  ) => {
    setProjects((prev) => setThreadRuntimeModeInProjects(prev, projectId, threadId, runtimeMode));
  };

  const setThreadPlanMode = (projectId: string, threadId: string, planMode: boolean) => {
    setProjects((prev) => setThreadPlanModeInProjects(prev, projectId, threadId, planMode));
  };

  const setThreadRuntimeId = (projectId: string, threadId: string, runtimeId: RuntimeId) => {
    setProjects((prev) => setThreadRuntimeIdInProjects(prev, projectId, threadId, runtimeId));
  };

  const setThreadRuntimeModelId = (
    projectId: string,
    threadId: string,
    runtimeModelId: string | undefined,
  ) => {
    setProjects((prev) =>
      setThreadRuntimeModelIdInProjects(prev, projectId, threadId, runtimeModelId),
    );
  };

  const setChatRuntimeMode = (
    threadId: string,
    runtimeMode: import("../../shared/runtimeMode").RuntimeMode,
  ) => {
    setChats((prev) => setChatThreadRuntimeMode(prev, threadId, runtimeMode));
  };

  const setChatPlanMode = (threadId: string, planMode: boolean) => {
    setChats((prev) => setChatThreadPlanMode(prev, threadId, planMode));
  };

  const setChatRuntimeId = (threadId: string, runtimeId: RuntimeId) => {
    setChats((prev) => setChatThreadRuntimeId(prev, threadId, runtimeId));
  };

  const setChatRuntimeModelId = (threadId: string, runtimeModelId: string | undefined) => {
    setChats((prev) => setChatThreadRuntimeModelId(prev, threadId, runtimeModelId));
  };

  const upsertMessages = (incomingMessages: Message[]) => {
    setMessages((prev) => mergeMessagesIntoWorkspace(prev, incomingMessages));
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
      type: "text",
      id: `msg-${now}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: formatTime(new Date(now)),
      createdAt: now,
    };
    setMessages((prev) => [...prev, newMessage]);
    return newMessage;
  };

  const appendWorkspaceDiffMessage = (
    threadId: string,
    result: Extract<GitWorkspaceDiffResult, { state: "ready" }>,
  ): ChangedFilesMessage => {
    const now = Date.now();
    const message = buildChangedFilesMessage({ threadId, result, now, formatTime });
    setMessages((prev) => [...prev, message]);
    return message;
  };

  const updateMessage = (id: string, content: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id && msg.type !== "changed_files" ? { ...msg, content, parts: undefined } : msg,
      ),
    );
  };

  const updateMessageAndPruneAfter = (id: string, content: string) => {
    setMessages((prev) => updateMessageAndPruneThreadAfter(prev, id, content));
  };

  const updateMessageRunStatus = (id: string, status: MessageRunStatus) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== id || msg.type === "changed_files") {
          return msg;
        }

        return {
          ...msg,
          runStatus: status,
          runFinishedAt: status === "running" ? undefined : Date.now(),
        };
      }),
    );
  };

  const updateMessageParts = (id: string, update: MessagePartUpdate) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? applyMessagePartUpdate(msg, update) : msg)),
    );
  };

  return (
    <WorkspaceContext.Provider
      value={{
        projects,
        chats,
        messages,
        activeThreadId,
        hasHydrated,
        currentThread,
        currentProject,
        getThreadRouteData,
        getChatRouteData,
        setActiveThreadId,
        createProject,
        removeProject,
        renameProject,
        renameThread,
        markThreadActivity,
        createThread,
        upsertThread,
        promoteDraftThread,
        toggleThreadPin,
        deleteThread,
        createChat,
        upsertChat,
        toggleChatPin,
        deleteChat,
        upsertMessages,
        appendMessage,
        appendWorkspaceDiffMessage,
        updateMessage,
        updateMessageAndPruneAfter,
        updateMessageRunStatus,
        updateMessageParts,
        setThreadRuntimeMode,
        setThreadPlanMode,
        setThreadRuntimeId,
        setThreadRuntimeModelId,
        setChatRuntimeMode,
        setChatPlanMode,
        setChatRuntimeId,
        setChatRuntimeModelId,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
