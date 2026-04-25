import { createContext, useContext, useState, type ReactNode } from "react";
import {
  initialActiveThreadId,
  messages as initialMessages,
  projects as initialProjects,
  type Message,
  type ProjectRecord,
  type ThreadRecord,
} from "../mock/uiShellData";
import {
  archiveThreadInProjects,
  createProjectInProjects,
  createThreadInProjects,
  findCurrentProject,
  findCurrentThread,
  toggleThreadPinInProjects,
  upsertThreadInProjects,
} from "../lib/workspaceState";

export type WorkspaceContextValue = {
  projects: ProjectRecord[];
  messages: Message[];
  activeThreadId: string | null;
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
  setActiveThreadId: (id: string | null) => void;
  createProject: (folderPath: string) => ProjectRecord | null;
  removeProject: (projectId: string) => void;
  createThread: (projectId: string, title: string) => ThreadRecord | null;
  upsertThread: (projectId: string, thread: ThreadRecord) => void;
  toggleThreadPin: (projectId: string, threadId: string) => void;
  archiveThread: (projectId: string, threadId: string) => void;
  upsertMessages: (messages: Message[]) => void;
  appendMessage: (message: {
    threadId: string;
    role: "user" | "assistant";
    agentId: string;
    content: string;
  }) => Message;
  updateMessage: (id: string, content: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue>({
  projects: [],
  messages: [],
  activeThreadId: null,
  currentThread: null,
  currentProject: null,
  getThreadRouteData: () => null,
  setActiveThreadId: () => {},
  createProject: () => null,
  removeProject: () => {},
  createThread: () => null,
  upsertThread: () => {},
  toggleThreadPin: () => {},
  archiveThread: () => {},
  upsertMessages: () => {},
  appendMessage: () => ({ id: "", role: "user", agentId: "", threadId: "", content: "", timestamp: "" }),
  updateMessage: () => {},
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
  const incomingById = new Map(
    incomingMessages.map((message) => [message.id, message]),
  );
  const merged = existingMessages.map(
    (message) => incomingById.get(message.id) ?? message,
  );
  const knownIds = new Set(existingMessages.map((message) => message.id));

  incomingMessages.forEach((message) => {
    if (!knownIds.has(message.id)) {
      merged.push(message);
    }
  });

  return merged;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState(initialProjects);
  const [messages, setMessages] = useState(initialMessages);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialActiveThreadId,
  );

  const currentThread = findCurrentThread(projects, activeThreadId);
  const currentProject = findCurrentProject(projects, activeThreadId);
  const getThreadRouteData = (projectId: string, threadId: string) =>
    resolveWorkspaceThreadRouteData(projects, messages, projectId, threadId);

  const createProject = (folderPath: string) => {
    const result = createProjectInProjects(projects, folderPath);
    setProjects(result.projects);
    return result.project;
  };

  const removeProject = (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
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

  const archiveThread = (projectId: string, threadId: string) => {
    const result = archiveThreadInProjects(projects, projectId, threadId);
    setProjects(result.projects);
    if (activeThreadId === threadId) {
      setActiveThreadId(result.nextActiveThreadId);
    }
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
      prev.map((msg) => (msg.id === id ? { ...msg, content } : msg)),
    );
  };

  return (
    <WorkspaceContext.Provider
      value={{
        projects,
        messages,
        activeThreadId,
        currentThread,
        currentProject,
        getThreadRouteData,
        setActiveThreadId,
        createProject,
        removeProject,
        createThread,
        upsertThread,
        toggleThreadPin,
        archiveThread,
        upsertMessages,
        appendMessage,
        updateMessage,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
