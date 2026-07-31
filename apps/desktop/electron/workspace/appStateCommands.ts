import { applyThreadDeletionToAppState } from "../../src/shared/chat";
import { isRuntimeMode, type RuntimeMode } from "../../src/shared/runtimeMode";
import { runtimeIds, type RuntimeId } from "../../src/shared/runtimes";
import {
  getProjectWorkingDirectoryIdentity,
  normalizeAppStateSettings,
  normalizeProjectWorkingDirectory,
  type AppProjectRecord,
  type WorkspaceProjectAssociationRecord,
  type WorkspaceRecord,
} from "../../src/shared/workspacePersistence";
import type { AppStateCommandReducer } from "../../src/shared/appStateAuthority";

// Command vocabulary for the shared App State data (workspaces, projects,
// associations, thread metadata, selection, settings). Each reducer mirrors
// the mutation of the same name in the renderer's AppStateContext; renderers
// pre-build new records (ids, derived names) and the reducers validate the
// semantic rules the renderer checks today, returning null for transitions
// that are invalid against the authoritative snapshot. Structural integrity
// (unique orders, referential integrity, contiguity) is re-enforced by
// normalizeAppStateSnapshotForWrite on the reducer output.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Mirrors validateWorkspaceName in AppStateContext: trimmed, non-empty,
// unique case-insensitively.
function validatedWorkspaceName(
  workspaces: WorkspaceRecord[],
  name: unknown,
  currentWorkspaceId?: string,
): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const normalizedName = trimmed.toLocaleLowerCase();
  const duplicate = workspaces.some(
    (workspace) =>
      workspace.id !== currentWorkspaceId && workspace.name.toLocaleLowerCase() === normalizedName,
  );
  return duplicate ? null : trimmed;
}

// Validates a new project record. `seenProjectIds` and
// `seenWorkingDirectories` are seeded with the snapshot's projects and
// updated as records are accepted.
function validatedNewProject(
  value: unknown,
  seenProjectIds: Set<string>,
  seenWorkingDirectories: Set<string>,
): AppProjectRecord | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.trim() !== value.id ||
    seenProjectIds.has(value.id)
  ) {
    return null;
  }
  if (typeof value.name !== "string" || !value.name.trim()) return null;
  if (typeof value.workingDirectory !== "string") return null;

  const workingDirectory = normalizeProjectWorkingDirectory(value.workingDirectory);
  const workingDirectoryIdentity = getProjectWorkingDirectoryIdentity(workingDirectory);
  const isAbsoluteWorkingDirectory =
    workingDirectory.startsWith("/") || /^[A-Za-z]:\//.test(workingDirectory);
  if (
    !workingDirectory ||
    !isAbsoluteWorkingDirectory ||
    seenWorkingDirectories.has(workingDirectoryIdentity)
  ) {
    return null;
  }

  seenProjectIds.add(value.id);
  seenWorkingDirectories.add(workingDirectoryIdentity);
  return { id: value.id, name: value.name.trim(), workingDirectory };
}

// Validates an association payload against the expected workspace, project,
// and order (the renderer always derives order as the next free slot).
function validatedAssociation(
  value: unknown,
  workspaceId: string,
  projectId: string,
  order: number,
): WorkspaceProjectAssociationRecord | null {
  if (!isRecord(value)) return null;
  if (value.workspaceId !== workspaceId || value.projectId !== projectId || value.order !== order) {
    return null;
  }
  if (!runtimeIds.includes(value.defaultRuntimeId as RuntimeId)) return null;
  if (!isRuntimeMode(value.defaultRuntimeMode)) return null;
  if (value.alias !== undefined && (typeof value.alias !== "string" || !value.alias.trim())) {
    return null;
  }
  if (
    value.defaultRuntimeModelId !== undefined &&
    (typeof value.defaultRuntimeModelId !== "string" || !value.defaultRuntimeModelId.trim())
  ) {
    return null;
  }

  const alias = typeof value.alias === "string" ? value.alias.trim() : "";
  const modelId =
    typeof value.defaultRuntimeModelId === "string" ? value.defaultRuntimeModelId.trim() : "";
  return {
    workspaceId,
    projectId,
    ...(alias ? { alias } : {}),
    order,
    defaultRuntimeId: value.defaultRuntimeId as RuntimeId,
    ...(modelId ? { defaultRuntimeModelId: modelId } : {}),
    defaultRuntimeMode: value.defaultRuntimeMode as RuntimeMode,
  };
}

// Mirrors createWorkspace: the renderer pre-builds the workspace record (with
// the next order), any brand-new project records, and their associations;
// creation also selects the new workspace.
const createWorkspace: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || !isRecord(payload.workspace)) return null;
  if (payload.projects !== undefined && !Array.isArray(payload.projects)) return null;
  if (payload.associations !== undefined && !Array.isArray(payload.associations)) return null;

  const workspaceInput = payload.workspace;
  if (
    typeof workspaceInput.id !== "string" ||
    !workspaceInput.id ||
    workspaceInput.id.trim() !== workspaceInput.id ||
    snapshot.workspaces.some((workspace) => workspace.id === workspaceInput.id)
  ) {
    return null;
  }
  const name = validatedWorkspaceName(snapshot.workspaces, workspaceInput.name);
  if (!name) return null;
  if (workspaceInput.order !== snapshot.workspaces.length) return null;
  const workspace: WorkspaceRecord = { id: workspaceInput.id, name, order: workspaceInput.order };

  const seenProjectIds = new Set(snapshot.projects.map((project) => project.id));
  const seenWorkingDirectories = new Set(
    snapshot.projects.map((project) =>
      getProjectWorkingDirectoryIdentity(project.workingDirectory),
    ),
  );
  const projects: AppProjectRecord[] = [];
  for (const projectInput of payload.projects ?? []) {
    const project = validatedNewProject(projectInput, seenProjectIds, seenWorkingDirectories);
    if (!project) return null;
    projects.push(project);
  }

  const knownProjectIds = new Set(seenProjectIds);
  const seenAssociatedProjectIds = new Set<string>();
  const associations: WorkspaceProjectAssociationRecord[] = [];
  for (const [index, associationInput] of (payload.associations ?? []).entries()) {
    if (!isRecord(associationInput) || typeof associationInput.projectId !== "string") return null;
    if (
      !knownProjectIds.has(associationInput.projectId) ||
      seenAssociatedProjectIds.has(associationInput.projectId)
    ) {
      return null;
    }
    const association = validatedAssociation(
      associationInput,
      workspace.id,
      associationInput.projectId,
      index,
    );
    if (!association) return null;
    seenAssociatedProjectIds.add(associationInput.projectId);
    associations.push(association);
  }

  return {
    ...snapshot,
    workspaces: [...snapshot.workspaces, workspace],
    projects: [...snapshot.projects, ...projects],
    associations: [...snapshot.associations, ...associations],
    activeWorkspaceId: workspace.id,
  };
};

// Mirrors renameWorkspace.
const renameWorkspace: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.workspaceId !== "string") return null;
  const workspace = snapshot.workspaces.find((item) => item.id === payload.workspaceId);
  if (!workspace) return null;
  const name = validatedWorkspaceName(snapshot.workspaces, payload.name, workspace.id);
  if (!name) return null;

  return {
    ...snapshot,
    workspaces: snapshot.workspaces.map((item) =>
      item.id === workspace.id ? { ...item, name } : item,
    ),
  };
};

// Mirrors the snapshot part of deleteWorkspace; chat/terminal/attachment data
// lives outside the snapshot and stays with the deletion transaction.
const deleteWorkspace: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.workspaceId !== "string") return null;
  const workspaceId = payload.workspaceId;
  if (!snapshot.workspaces.some((workspace) => workspace.id === workspaceId)) return null;

  const affectedThreadIds = [
    ...(snapshot.threads ?? [])
      .filter((thread) => thread.workspaceId === workspaceId)
      .map((thread) => thread.id),
    ...(snapshot.threadDrafts ?? [])
      .filter((draft) => draft.workspaceId === workspaceId)
      .map((draft) => draft.threadId),
  ];
  return applyThreadDeletionToAppState(snapshot, affectedThreadIds, {
    kind: "workspace",
    workspaceId,
  });
};

// Mirrors addProject: with `existingProjectId` the already-known project is
// reused (same working directory) and only the association is appended.
const addProject: AppStateCommandReducer = (snapshot, payload) => {
  if (
    !isRecord(payload) ||
    typeof payload.workspaceId !== "string" ||
    !isRecord(payload.association)
  ) {
    return null;
  }
  const workspaceId = payload.workspaceId;
  if (!snapshot.workspaces.some((workspace) => workspace.id === workspaceId)) return null;

  let project: AppProjectRecord;
  let projects = snapshot.projects;
  if (payload.existingProjectId !== undefined) {
    if (typeof payload.existingProjectId !== "string") return null;
    const existing = snapshot.projects.find((item) => item.id === payload.existingProjectId);
    if (!existing) return null;
    project = existing;
  } else {
    const seenProjectIds = new Set(snapshot.projects.map((item) => item.id));
    const seenWorkingDirectories = new Set(
      snapshot.projects.map((item) => getProjectWorkingDirectoryIdentity(item.workingDirectory)),
    );
    const created = validatedNewProject(payload.project, seenProjectIds, seenWorkingDirectories);
    if (!created) return null;
    project = created;
    projects = [...snapshot.projects, created];
  }

  // An already-associated project is a no-op in the renderer; as a command it
  // carries no state change, so it is rejected instead.
  if (
    snapshot.associations.some(
      (item) => item.workspaceId === workspaceId && item.projectId === project.id,
    )
  ) {
    return null;
  }
  const order = snapshot.associations.filter((item) => item.workspaceId === workspaceId).length;
  const association = validatedAssociation(payload.association, workspaceId, project.id, order);
  if (!association) return null;

  return {
    ...snapshot,
    projects,
    associations: [...snapshot.associations, association],
  };
};

// Mirrors renameSharedProject.
const renameProject: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.projectId !== "string") return null;
  if (!snapshot.projects.some((project) => project.id === payload.projectId)) return null;
  if (typeof payload.name !== "string" || !payload.name.trim()) return null;
  const name = payload.name.trim();

  return {
    ...snapshot,
    projects: snapshot.projects.map((project) =>
      project.id === payload.projectId ? { ...project, name } : project,
    ),
  };
};

// Mirrors setProjectAlias: a blank alias clears it.
const setProjectAlias: AppStateCommandReducer = (snapshot, payload) => {
  if (
    !isRecord(payload) ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.projectId !== "string" ||
    typeof payload.alias !== "string"
  ) {
    return null;
  }
  const association = snapshot.associations.find(
    (item) => item.workspaceId === payload.workspaceId && item.projectId === payload.projectId,
  );
  if (!association) return null;
  const alias = payload.alias.trim();

  return {
    ...snapshot,
    associations: snapshot.associations.map((item) => {
      if (item !== association) return item;
      const { alias: _alias, ...withoutAlias } = item;
      return alias ? { ...withoutAlias, alias } : withoutAlias;
    }),
  };
};

// Mirrors the snapshot part of removeAssociation.
const removeAssociation: AppStateCommandReducer = (snapshot, payload) => {
  if (
    !isRecord(payload) ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.projectId !== "string"
  ) {
    return null;
  }
  const { workspaceId, projectId } = payload;
  if (
    !snapshot.associations.some(
      (item) => item.workspaceId === workspaceId && item.projectId === projectId,
    )
  ) {
    return null;
  }

  const affectedThreadIds = [
    ...(snapshot.threads ?? [])
      .filter((thread) => thread.workspaceId === workspaceId && thread.projectId === projectId)
      .map((thread) => thread.id),
    ...(snapshot.threadDrafts ?? [])
      .filter((draft) => draft.workspaceId === workspaceId && draft.projectId === projectId)
      .map((draft) => draft.threadId),
  ];
  const next = applyThreadDeletionToAppState(snapshot, affectedThreadIds, {
    kind: "association",
    workspaceId,
    projectId,
  });
  // applyThreadDeletionToAppState keeps the remaining associations' order
  // values; reindex the affected workspace so its orders stay contiguous for
  // normalizeAppStateSnapshotForWrite.
  let order = 0;
  return {
    ...next,
    associations: next.associations.map((item) =>
      item.workspaceId === workspaceId ? { ...item, order: order++ } : item,
    ),
  };
};

// Mirrors setAssociationDefaults.
const setAssociationDefaults: AppStateCommandReducer = (snapshot, payload) => {
  if (
    !isRecord(payload) ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.projectId !== "string" ||
    !isRecord(payload.defaults)
  ) {
    return null;
  }
  const association = snapshot.associations.find(
    (item) => item.workspaceId === payload.workspaceId && item.projectId === payload.projectId,
  );
  if (!association) return null;

  const defaults = payload.defaults;
  if (!runtimeIds.includes(defaults.runtimeId as RuntimeId)) return null;
  if (!isRuntimeMode(defaults.runtimeMode)) return null;
  if (defaults.runtimeModelId !== undefined && typeof defaults.runtimeModelId !== "string") {
    return null;
  }
  const runtimeModelId =
    typeof defaults.runtimeModelId === "string" ? defaults.runtimeModelId.trim() : "";

  return {
    ...snapshot,
    associations: snapshot.associations.map((item) => {
      if (item !== association) return item;
      const { defaultRuntimeModelId: _model, ...withoutModel } = item;
      return {
        ...withoutModel,
        defaultRuntimeId: defaults.runtimeId as RuntimeId,
        ...(runtimeModelId ? { defaultRuntimeModelId: runtimeModelId } : {}),
        defaultRuntimeMode: defaults.runtimeMode as RuntimeMode,
      };
    }),
  };
};

// Mirrors archiveThread: archiving clears the remembered location when it
// points at the thread. Live-run guards stay in the renderer.
const archiveThread: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.threadId !== "string") return null;
  const thread = (snapshot.threads ?? []).find(
    (item) => item.id === payload.threadId && !item.archived,
  );
  if (!thread) return null;

  const lastThreadIdByWorkspace = { ...snapshot.lastThreadIdByWorkspace };
  if (lastThreadIdByWorkspace[thread.workspaceId] === thread.id) {
    delete lastThreadIdByWorkspace[thread.workspaceId];
  }

  return {
    ...snapshot,
    threads: (snapshot.threads ?? []).map((item) =>
      item.id === thread.id ? { ...item, archived: true } : item,
    ),
    lastThreadIdByWorkspace,
  };
};

// Mirrors restoreThread.
const restoreThread: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.threadId !== "string") return null;
  const thread = (snapshot.threads ?? []).find(
    (item) => item.id === payload.threadId && item.archived,
  );
  if (!thread) return null;

  return {
    ...snapshot,
    threads: (snapshot.threads ?? []).map((item) => {
      if (item.id !== thread.id) return item;
      const { archived: _archived, ...restored } = item;
      return restored;
    }),
  };
};

// Mirrors updateThreadConfig: only the provided fields change; a blank
// runtimeModelId clears it.
const updateThreadConfig: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.threadId !== "string" || !isRecord(payload.config)) {
    return null;
  }
  const thread = (snapshot.threads ?? []).find((item) => item.id === payload.threadId);
  if (!thread) return null;

  const config = payload.config;
  if (config.runtimeId !== undefined && !runtimeIds.includes(config.runtimeId as RuntimeId)) {
    return null;
  }
  if (config.runtimeMode !== undefined && !isRuntimeMode(config.runtimeMode)) return null;
  if (config.planMode !== undefined && typeof config.planMode !== "boolean") return null;
  if (config.runtimeModelId !== undefined && typeof config.runtimeModelId !== "string") {
    return null;
  }

  const next = { ...thread };
  if (config.runtimeId !== undefined) next.runtimeId = config.runtimeId as RuntimeId;
  if (config.runtimeMode !== undefined) next.runtimeMode = config.runtimeMode as RuntimeMode;
  if (config.planMode !== undefined) next.planMode = config.planMode as boolean;
  if (config.runtimeModelId !== undefined) {
    const runtimeModelId = config.runtimeModelId.trim();
    if (runtimeModelId) {
      next.runtimeModelId = runtimeModelId;
    } else {
      delete next.runtimeModelId;
    }
  }

  return {
    ...snapshot,
    threads: (snapshot.threads ?? []).map((item) => (item.id === thread.id ? next : item)),
  };
};

// Mirrors selectWorkspace: selecting the active or an unknown workspace is a
// no-op in the renderer; as a command it is rejected instead.
const selectWorkspace: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.workspaceId !== "string") return null;
  if (payload.workspaceId === snapshot.activeWorkspaceId) return null;
  if (!snapshot.workspaces.some((workspace) => workspace.id === payload.workspaceId)) return null;

  return { ...snapshot, activeWorkspaceId: payload.workspaceId };
};

// Mirrors rememberThreadLocation.
const rememberThreadLocation: AppStateCommandReducer = (snapshot, payload) => {
  if (
    !isRecord(payload) ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.threadId !== "string"
  ) {
    return null;
  }
  const thread = (snapshot.threads ?? []).find(
    (item) =>
      item.id === payload.threadId && item.workspaceId === payload.workspaceId && !item.archived,
  );
  if (!thread) return null;
  if (
    snapshot.activeWorkspaceId === payload.workspaceId &&
    snapshot.lastThreadIdByWorkspace?.[payload.workspaceId] === payload.threadId
  ) {
    return null;
  }

  return {
    ...snapshot,
    activeWorkspaceId: payload.workspaceId,
    lastThreadIdByWorkspace: {
      ...snapshot.lastThreadIdByWorkspace,
      [payload.workspaceId]: payload.threadId,
    },
  };
};

// Settings are validated leniently (see AppStateSettings) and shallow-merged
// over the snapshot's current settings.
const updateSettings: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload)) return null;
  const settings = normalizeAppStateSettings(payload.settings);
  if (!settings) return null;

  return { ...snapshot, settings: { ...snapshot.settings, ...settings } };
};

export const appStateCommandReducers: Record<string, AppStateCommandReducer> = {
  "workspace:create": createWorkspace,
  "workspace:rename": renameWorkspace,
  "workspace:delete": deleteWorkspace,
  "project:add": addProject,
  "project:rename": renameProject,
  "project:set-alias": setProjectAlias,
  "association:remove": removeAssociation,
  "association:set-defaults": setAssociationDefaults,
  "thread:archive": archiveThread,
  "thread:restore": restoreThread,
  "thread:update-config": updateThreadConfig,
  "state:select-workspace": selectWorkspace,
  "state:remember-thread-location": rememberThreadLocation,
  "settings:update": updateSettings,
};
