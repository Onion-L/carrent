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
  createThreadInProjects,
  findCurrentProject,
  findCurrentThread,
  toggleThreadPinInProjects,
} from "../lib/workspaceState";

export type WorkspaceContextValue = {
  projects: ProjectRecord[];
  messages: Message[];
  activeThreadId: string | null;
  currentThread: ThreadRecord | null;
  currentProject: ProjectRecord | null;
  setActiveThreadId: (id: string | null) => void;
  createThread: (projectId: string, title: string) => ThreadRecord | null;
  toggleThreadPin: (projectId: string, threadId: string) => void;
  archiveThread: (projectId: string, threadId: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue>({
  projects: [],
  messages: [],
  activeThreadId: null,
  currentThread: null,
  currentProject: null,
  setActiveThreadId: () => {},
  createThread: () => null,
  toggleThreadPin: () => {},
  archiveThread: () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState(initialProjects);
  const [messages] = useState(initialMessages);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialActiveThreadId,
  );

  const currentThread = findCurrentThread(projects, activeThreadId);
  const currentProject = findCurrentProject(projects, activeThreadId);

  const createThread = (projectId: string, title: string) => {
    const result = createThreadInProjects(projects, projectId, title);
    if (!result.thread) {
      return null;
    }

    setProjects(result.projects);
    setActiveThreadId(result.thread.id);
    return result.thread;
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

  return (
    <WorkspaceContext.Provider
      value={{
        projects,
        messages,
        activeThreadId,
        currentThread,
        currentProject,
        setActiveThreadId,
        createThread,
        toggleThreadPin,
        archiveThread,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
