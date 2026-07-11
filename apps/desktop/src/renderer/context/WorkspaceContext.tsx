import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  initialActiveThreadId,
  messages as initialMessages,
  projects as initialProjects,
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
  renameProjectInProjects,
  resolveChatThreadRouteData,
  setChatThreadRuntimeMode,
  setChatThreadRuntimeModelId,
  setChatThreadRuntimeId,
  setThreadRuntimeIdInProjects,
  setThreadRuntimeModeInProjects,
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
import type { RuntimeId } from "../../shared/runtimes";
import type { ImageAttachmentMetadata } from "../../shared/chat";

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
  removeProject: (projectId: string) => void;
  renameProject: (projectId: string, newName: string) => boolean;
  createThread: (
    projectId: string,
    title: string,
    runtimeId?: RuntimeId,
    runtimeModelId?: string,
  ) => ThreadRecord | null;
  upsertThread: (projectId: string, thread: ThreadRecord) => void;
  promoteDraftThread: (projectId: string, threadId: string) => void;
  toggleThreadPin: (projectId: string, threadId: string) => void;
  deleteThread: (projectId: string, threadId: string) => string | null;
  createChat: (
    title: string,
    runtimeId?: RuntimeId,
    runtimeModelId?: string,
  ) => ThreadRecord | null;
  upsertChat: (thread: ThreadRecord) => void;
  toggleChatPin: (threadId: string) => void;
  deleteChat: (threadId: string) => void;
  upsertMessages: (messages: Message[]) => void;
  appendMessage: (message: {
    threadId: string;
    role: "user" | "assistant";
    content: string;
    attachments?: ImageAttachmentMetadata[];
    runStatus?: MessageRunStatus;
  }) => Message;
  updateMessage: (id: string, content: string) => void;
  updateMessageAndPruneAfter: (id: string, content: string) => void;
  updateMessageRunStatus: (id: string, status: MessageRunStatus) => void;
  updateMessageParts: (id: string, update: MessagePartUpdate) => void;
  setThreadRuntimeMode: (
    projectId: string,
    threadId: string,
    runtimeMode: import("../../shared/runtimeMode").RuntimeMode,
  ) => void;
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
    };

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
  removeProject: () => {},
  renameProject: () => false,
  createThread: () => null,
  upsertThread: () => {},
  promoteDraftThread: () => {},
  toggleThreadPin: () => {},
  deleteThread: () => null,
  createChat: () => null,
  upsertChat: () => {},
  toggleChatPin: () => {},
  deleteChat: () => {},
  upsertMessages: () => {},
  appendMessage: () => ({
    id: "",
    role: "user",
    threadId: "",
    content: "",
    timestamp: "",
    type: "text",
  }),
  updateMessage: () => {},
  updateMessageAndPruneAfter: () => {},
  updateMessageRunStatus: () => {},
  updateMessageParts: () => {},
  setThreadRuntimeMode: () => {},
  setThreadRuntimeId: () => {},
  setThreadRuntimeModelId: () => {},
  setChatRuntimeMode: () => {},
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
        if (snapshot) {
          setProjects(snapshot.projects);
          setChats(snapshot.chats ?? []);
          setMessages(snapshot.messages);
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

  useDebouncedWorkspaceSave(
    buildWorkspaceSnapshot({ projects, chats, messages, activeThreadId }),
    hasHydrated,
  );

  const createProject = (folderPath: string) => {
    const result = createProjectInProjects(projects, folderPath);
    setProjects(result.projects);
    return result.project;
  };

  const removeProject = (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  };

  const renameProject = (projectId: string, newName: string) => {
    const result = renameProjectInProjects(projects, projectId, newName);
    if (result.renamed) {
      setProjects(result.projects);
    }
    return result.renamed;
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
    setProjects(toggleThreadPinInProjects(projects, projectId, threadId));
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

  const deleteChat = (threadId: string) => {
    setChats((prev) => deleteChatThread(prev, threadId));
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
    }
  };

  const deleteThread = (projectId: string, threadId: string) => {
    const result = deleteThreadInProjects(projects, projectId, threadId);
    setProjects(result.projects);
    if (activeThreadId === threadId) {
      setActiveThreadId(result.nextActiveThreadId);
    }
    return result.nextActiveThreadId;
  };

  const setThreadRuntimeMode = (
    projectId: string,
    threadId: string,
    runtimeMode: import("../../shared/runtimeMode").RuntimeMode,
  ) => {
    setProjects((prev) => setThreadRuntimeModeInProjects(prev, projectId, threadId, runtimeMode));
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
    attachments?: ImageAttachmentMetadata[];
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
        updateMessage,
        updateMessageAndPruneAfter,
        updateMessageRunStatus,
        updateMessageParts,
        setThreadRuntimeMode,
        setThreadRuntimeId,
        setThreadRuntimeModelId,
        setChatRuntimeMode,
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
