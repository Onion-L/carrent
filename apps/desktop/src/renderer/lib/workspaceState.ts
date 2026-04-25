import { basename } from "node:path";
import type { ProjectRecord, ThreadRecord } from "../mock/uiShellData";
import { splitProjectThreads } from "./projectThreads";

export function createProjectInProjects(
  projects: ProjectRecord[],
  folderPath: string,
) {
  const name = basename(folderPath);
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
    updatedAt: "now",
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
