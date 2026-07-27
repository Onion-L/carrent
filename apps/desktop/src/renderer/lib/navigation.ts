import type {
  AppProjectRecord,
  AppThreadRecord,
  WorkspaceProjectAssociationRecord,
  WorkspaceRecord,
} from "../../shared/workspacePersistence";

export function buildWorkspacePath(workspaceId: string) {
  return `/workspace/${workspaceId}`;
}

export function buildProjectPath(workspaceId: string, projectId: string) {
  return `${buildWorkspacePath(workspaceId)}/project/${projectId}`;
}

export function buildThreadPath(workspaceId: string, projectId: string, threadId: string) {
  return `${buildProjectPath(workspaceId, projectId)}/thread/${threadId}`;
}

export function getProjectIdFromPathname(pathname: string) {
  const parts = pathname.split("/");
  return parts[1] === "workspace" && parts[3] === "project" ? parts[4] || null : null;
}

export function getWorkspaceRestorePath(
  workspaceId: string,
  threads: AppThreadRecord[],
  lastThreadIdByWorkspace: Record<string, string>,
) {
  const thread = threads.find(
    (item) =>
      item.id === lastThreadIdByWorkspace[workspaceId] &&
      item.workspaceId === workspaceId &&
      !item.archived,
  );
  return thread
    ? buildThreadPath(workspaceId, thread.projectId, thread.id)
    : buildWorkspacePath(workspaceId);
}

type NavigationState = {
  workspaces: WorkspaceRecord[];
  projects: AppProjectRecord[];
  associations: WorkspaceProjectAssociationRecord[];
  threads: AppThreadRecord[];
};

export type ThreeLevelRouteResolution =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "project"; workspaceId: string; projectId: string }
  | { kind: "thread"; workspaceId: string; projectId: string; threadId: string }
  | { kind: "fallback"; to: string; notice: string }
  | { kind: "other" };

export function resolveThreeLevelRoute(
  state: NavigationState,
  pathname: string,
): ThreeLevelRouteResolution {
  const parts = pathname.split("/");
  if (parts[1] !== "workspace") return { kind: "other" };

  const workspaceId = parts[2];
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  if (!workspaceId || !workspace) {
    return { kind: "fallback", to: "/", notice: "Workspace could not be found." };
  }
  if (parts.length === 3) return { kind: "workspace", workspaceId };

  const projectId = parts[3] === "project" ? parts[4] : undefined;
  const project = state.projects.find((item) => item.id === projectId);
  const association = state.associations.find(
    (item) => item.workspaceId === workspaceId && item.projectId === projectId,
  );
  if (!projectId || !project || !association) {
    return {
      kind: "fallback",
      to: buildWorkspacePath(workspaceId),
      notice: "Project is not available in this Workspace.",
    };
  }
  if (parts.length === 5) return { kind: "project", workspaceId, projectId };

  const threadId = parts[5] === "thread" ? parts[6] : undefined;
  const thread = state.threads.find(
    (item) =>
      item.id === threadId &&
      item.workspaceId === workspaceId &&
      item.projectId === projectId &&
      !item.archived,
  );
  if (parts.length !== 7 || !threadId || !thread) {
    return {
      kind: "fallback",
      to: buildProjectPath(workspaceId, projectId),
      notice: "Thread could not be found.",
    };
  }

  return { kind: "thread", workspaceId, projectId, threadId };
}
