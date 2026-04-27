import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { DraftThreadRecord } from "../lib/draftThreads";
import {
  agents as initialAgents,
  initialActiveThreadId,
  messages as initialMessages,
  projects as initialProjects,
  type AgentRecord,
  type Message,
  type MessagePart,
  type ProjectRecord,
  type ThreadRecord,
} from "../mock/uiShellData";
import {
  archiveChatThread,
  archiveThreadInProjects,
  createChatThread,
  createProjectInProjects,
  createThreadInProjects,
  findCurrentChatThread,
  findCurrentProject,
  findCurrentThread,
  renameProjectInProjects,
  resolveChatThreadRouteData,
  toggleChatThreadPin,
  toggleThreadPinInProjects,
  upsertChatThread,
  upsertThreadInProjects,
} from "../lib/workspaceState";
import {
  buildWorkspaceSnapshot,
  useDebouncedWorkspaceSave,
} from "../hooks/useDebouncedWorkspaceSave";

export type WorkspaceContextValue = {
  projects: ProjectRecord[];
  chats: ThreadRecord[];
  messages: Message[];
  activeThreadId: string | null;
  hasHydrated: boolean;
  drafts: DraftThreadRecord[];
  agents: AgentRecord[];
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
  setDrafts: (drafts: DraftThreadRecord[] | ((prev: DraftThreadRecord[]) => DraftThreadRecord[])) => void;
  setAgents: (agents: AgentRecord[] | ((prev: AgentRecord[]) => AgentRecord[])) => void;
  createProject: (folderPath: string) => ProjectRecord | null;
  removeProject: (projectId: string) => void;
  renameProject: (projectId: string, newName: string) => boolean;
  createThread: (projectId: string, title: string) => ThreadRecord | null;
  upsertThread: (projectId: string, thread: ThreadRecord) => void;
  toggleThreadPin: (projectId: string, threadId: string) => void;
  archiveThread: (projectId: string, threadId: string) => string | null;
  createChat: (title: string) => ThreadRecord | null;
  upsertChat: (thread: ThreadRecord) => void;
  toggleChatPin: (threadId: string) => void;
  archiveChat: (threadId: string) => void;
  upsertMessages: (messages: Message[]) => void;
  appendMessage: (message: {
    threadId: string;
    role: "user" | "assistant";
    agentId: string;
    content: string;
  }) => Message;
  updateMessage: (id: string, content: string) => void;
  updateMessageParts: (id: string, update: MessagePartUpdate) => void;
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
  drafts: [],
  agents: [],
  currentThread: null,
  currentProject: null,
  getThreadRouteData: () => null,
  getChatRouteData: () => null,
  setActiveThreadId: () => {},
  setDrafts: () => {},
  setAgents: () => {},
  createProject: () => null,
  removeProject: () => {},
  renameProject: () => false,
  createThread: () => null,
  upsertThread: () => {},
  toggleThreadPin: () => {},
  archiveThread: () => null,
  createChat: () => null,
  upsertChat: () => {},
  toggleChatPin: () => {},
  archiveChat: () => {},
  upsertMessages: () => {},
  appendMessage: () => ({
    id: "",
    role: "user",
    agentId: "",
    threadId: "",
    content: "",
    timestamp: "",
  }),
  updateMessage: () => {},
  updateMessageParts: () => {},
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
  const [drafts, setDrafts] = useState<DraftThreadRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
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
          setDrafts(snapshot.drafts);
          setAgents(snapshot.agents?.length ? snapshot.agents : initialAgents);
        } else {
          setProjects(initialProjects);
          setChats([]);
          setMessages(initialMessages);
          setActiveThreadId(initialActiveThreadId);
          setDrafts([]);
          setAgents(initialAgents);
        }
      })
      .catch((error) => {
        console.error("[workspace] failed to load", error);
        if (!cancelled) {
          setProjects(initialProjects);
          setChats([]);
          setMessages(initialMessages);
          setActiveThreadId(initialActiveThreadId);
          setDrafts([]);
          setAgents(initialAgents);
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
    buildWorkspaceSnapshot({ projects, chats, messages, activeThreadId, drafts, agents }),
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

  const createThread = (projectId: string, title: string) => {
    const result = createThreadInProjects(projects, projectId, title);
    if (!result.thread) {
      return null;
    }

    setProjects(result.projects);
    setActiveThreadId(result.thread.id);
    return result.thread;
  };

  const upsertThread = (projectId: string, thread: ThreadRecord) => {
    setProjects((prev) => upsertThreadInProjects(prev, projectId, thread));
  };

  const toggleThreadPin = (projectId: string, threadId: string) => {
    setProjects(toggleThreadPinInProjects(projects, projectId, threadId));
  };

  const createChat = (title: string) => {
    const thread = createChatThread(title);
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

  const archiveChat = (threadId: string) => {
    setChats((prev) => archiveChatThread(prev, threadId));
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
    }
  };

  const archiveThread = (projectId: string, threadId: string) => {
    const result = archiveThreadInProjects(projects, projectId, threadId);
    setProjects(result.projects);
    if (activeThreadId === threadId) {
      setActiveThreadId(result.nextActiveThreadId);
    }
    return result.nextActiveThreadId;
  };

  const upsertMessages = (incomingMessages: Message[]) => {
    setMessages((prev) => mergeMessagesIntoWorkspace(prev, incomingMessages));
  };

  const appendMessage = (message: {
    threadId: string;
    role: "user" | "assistant";
    agentId: string;
    content: string;
  }): Message => {
    const newMessage: Message = {
      ...message,
      type: "text",
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: formatTime(new Date()),
    };
    setMessages((prev) => [...prev, newMessage]);
    return newMessage;
  };

  const updateMessage = (id: string, content: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id && msg.type !== "changed_files"
          ? { ...msg, content, parts: undefined }
          : msg,
      ),
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
        drafts,
        agents,
        currentThread,
        currentProject,
        getThreadRouteData,
        getChatRouteData,
        setActiveThreadId,
        setDrafts,
        setAgents,
        createProject,
        removeProject,
        renameProject,
        createThread,
        upsertThread,
        toggleThreadPin,
        archiveThread,
        createChat,
        upsertChat,
        toggleChatPin,
        archiveChat,
        upsertMessages,
        appendMessage,
        updateMessage,
        updateMessageParts,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
