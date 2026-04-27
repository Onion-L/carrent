import type { Message, ProjectRecord, ThreadRecord } from "../mock/uiShellData";
import { splitProjectThreads } from "./projectThreads";

export function createProjectInProjects(
  projects: ProjectRecord[],
  folderPath: string,
) {
  const name = folderPath.replace(/\\/g, "/").split("/").pop() || "";
  const project: ProjectRecord = {
    id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    path: folderPath,
    threads: [],
  };

  return {
    projects: [...projects, project],
    project,
  };
}

export function renameProjectInProjects(
  projects: ProjectRecord[],
  projectId: string,
  newName: string,
) {
  const trimmed = newName.trim();
  if (!trimmed) return { projects, renamed: false as boolean };

  return {
    projects: projects.map((p) =>
      p.id === projectId ? { ...p, name: trimmed } : p,
    ),
    renamed: true,
  };
}

export function findCurrentThread(
  projects: ProjectRecord[],
  activeThreadId: string | null,
) {
  if (!activeThreadId) {
    return null;
  }

  for (const project of projects) {
    const thread = project.threads.find((item) => item.id === activeThreadId);
    if (thread) {
      return thread;
    }
  }

  return null;
}

export function findCurrentChatThread(
  chats: ThreadRecord[],
  activeThreadId: string | null,
) {
  if (!activeThreadId) {
    return null;
  }

  return chats.find((chat) => chat.id === activeThreadId) ?? null;
}

export function findCurrentProject(
  projects: ProjectRecord[],
  activeThreadId: string | null,
) {
  if (!activeThreadId) {
    return null;
  }

  return (
    projects.find((project) =>
      project.threads.some((thread) => thread.id === activeThreadId),
    ) ?? null
  );
}

export function createThreadInProjects(
  projects: ProjectRecord[],
  projectId: string,
  title: string,
) {
  const nextTitle = title.trim();
  if (!nextTitle) {
    return { projects, thread: null as ThreadRecord | null };
  }

  const thread: ThreadRecord = {
    id: `thread-${Date.now()}`,
    title: nextTitle,
    updatedAt: new Date().toISOString(),
  };

  let foundProject = false;
  const nextProjects = projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    foundProject = true;
    return {
      ...project,
      threads: [thread, ...project.threads],
    };
  });

  return {
    projects: nextProjects,
    thread: foundProject ? thread : null,
  };
}

export function upsertThreadInProjects(
  projects: ProjectRecord[],
  projectId: string,
  thread: ThreadRecord,
) {
  return projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    const existingThread = project.threads.find((item) => item.id === thread.id);
    const nextThread = existingThread ? { ...existingThread, ...thread } : thread;
    const nextThreads =
      existingThread === undefined
        ? [nextThread, ...project.threads]
        : [
            nextThread,
            ...project.threads.filter((item) => item.id !== thread.id),
          ];

    return {
      ...project,
      threads: nextThreads,
    };
  });
}

export function toggleThreadPinInProjects(
  projects: ProjectRecord[],
  projectId: string,
  threadId: string,
) {
  return projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    return {
      ...project,
      threads: project.threads.map((thread) =>
        thread.id === threadId ? { ...thread, pinned: !thread.pinned } : thread,
      ),
    };
  });
}

export function archiveThreadInProjects(
  projects: ProjectRecord[],
  projectId: string,
  threadId: string,
) {
  const nextProjects = projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    return {
      ...project,
      threads: project.threads.map((thread) =>
        thread.id === threadId ? { ...thread, archived: true } : thread,
      ),
    };
  });

  return {
    projects: nextProjects,
    nextActiveThreadId: findNextVisibleThreadId(nextProjects, projectId),
  };
}

export function createChatThread(title: string): ThreadRecord | null {
  const nextTitle = title.trim();
  if (!nextTitle) {
    return null;
  }

  return {
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: nextTitle,
    updatedAt: new Date().toISOString(),
  };
}

export function upsertChatThread(existingChats: ThreadRecord[], thread: ThreadRecord) {
  const existing = existingChats.find((item) => item.id === thread.id);
  if (existing) {
    return existingChats.map((item) =>
      item.id === thread.id ? { ...existing, ...thread } : item,
    );
  }
  return [thread, ...existingChats];
}

export function toggleChatThreadPin(existingChats: ThreadRecord[], threadId: string) {
  return existingChats.map((thread) =>
    thread.id === threadId ? { ...thread, pinned: !thread.pinned } : thread,
  );
}

export function archiveChatThread(existingChats: ThreadRecord[], threadId: string) {
  return existingChats.map((thread) =>
    thread.id === threadId ? { ...thread, archived: true } : thread,
  );
}

export function resolveChatThreadRouteData(
  chats: ThreadRecord[],
  messages: Message[],
  threadId: string,
) {
  const thread = chats.find((item) => item.id === threadId);
  if (!thread) {
    return null;
  }

  return {
    thread,
    messages: messages.filter((message) => message.threadId === threadId),
  };
}

function findNextVisibleThreadId(
  projects: ProjectRecord[],
  preferredProjectId: string,
) {
  const preferredProject = projects.find((project) => project.id === preferredProjectId);
  const preferredThreadId = splitProjectThreads(preferredProject?.threads ?? []).active[0]?.id;
  if (preferredThreadId) {
    return preferredThreadId;
  }

  for (const project of projects) {
    const threadId = splitProjectThreads(project.threads).active[0]?.id;
    if (threadId) {
      return threadId;
    }
  }

  return null;
}
