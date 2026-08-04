import { isDeepStrictEqual } from "node:util";

import { applyThreadDeletionToAppState } from "../../src/shared/chat";
import { isRuntimeMode, type RuntimeMode } from "../../src/shared/runtimeMode";
import { runtimeIds, type RuntimeId } from "../../src/shared/runtimes";
import {
  getProjectWorkingDirectoryIdentity,
  normalizeAppStateSettings,
  normalizeProjectWorkingDirectory,
  normalizeThreadRunChecklist,
  type AppProjectRecord,
  type AppStateSnapshot,
  type AppThreadActionRecord,
  type AppThreadMessageRecord,
  type AppThreadRecord,
  type AppThreadRunRecord,
  type AssociationThreadDraftRecord,
  type ThreadWorkSnapshot,
  type WorkspaceProjectAssociationRecord,
  type WorkspaceRecord,
} from "../../src/shared/workspacePersistence";
import type { AppStateCommandReducer } from "../../src/shared/appStateAuthority";
import { reconcileInterruptedMessage } from "../../src/shared/threadContent";

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
  return applyThreadDeletionToAppState(snapshot, affectedThreadIds, {
    kind: "association",
    workspaceId,
    projectId,
  });
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

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isValidRuntimeSelection(runtimeId: unknown, runtimeMode: unknown, planMode: unknown) {
  return (
    runtimeIds.includes(runtimeId as RuntimeId) &&
    isRuntimeMode(runtimeMode) &&
    typeof planMode === "boolean"
  );
}

function isValidModelId(value: unknown): boolean {
  return value === undefined || isNonEmptyTrimmedString(value);
}

// Validates a renderer-built AssociationThreadDraftRecord the way the
// snapshot normalizer would; `snapshot` provides the referential context.
function validatedDraftRecord(
  value: Record<string, unknown>,
  snapshot: AppStateSnapshot,
): AssociationThreadDraftRecord | null {
  if (
    !isNonEmptyTrimmedString(value.id) ||
    !isNonEmptyTrimmedString(value.threadId) ||
    typeof value.workspaceId !== "string" ||
    typeof value.projectId !== "string" ||
    !snapshot.associations.some(
      (item) => item.workspaceId === value.workspaceId && item.projectId === value.projectId,
    ) ||
    (snapshot.threadDrafts ?? []).some((draft) => draft.id === value.id) ||
    (snapshot.threads ?? []).some((thread) => thread.id === value.threadId) ||
    (snapshot.threadDrafts ?? []).some((draft) => draft.threadId === value.threadId) ||
    typeof value.content !== "string" ||
    (value.composerState !== undefined && typeof value.composerState !== "string") ||
    !Array.isArray(value.attachedSkillNames) ||
    value.attachedSkillNames.some((name) => !isNonEmptyTrimmedString(name)) ||
    new Set(value.attachedSkillNames).size !== value.attachedSkillNames.length ||
    !Array.isArray(value.attachments) ||
    !isValidRuntimeSelection(value.runtimeId, value.runtimeMode, value.planMode) ||
    !isValidModelId(value.runtimeModelId)
  ) {
    return null;
  }
  return {
    id: value.id,
    threadId: value.threadId,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    content: value.content,
    ...(typeof value.composerState === "string" && value.composerState
      ? { composerState: value.composerState }
      : {}),
    attachedSkillNames: [...(value.attachedSkillNames as string[])],
    attachments: value.attachments as AssociationThreadDraftRecord["attachments"],
    runtimeId: value.runtimeId as RuntimeId,
    ...(isNonEmptyTrimmedString(value.runtimeModelId)
      ? { runtimeModelId: value.runtimeModelId }
      : {}),
    runtimeMode: value.runtimeMode as RuntimeMode,
    planMode: value.planMode as boolean,
  };
}

function validatedUserMessageRecord(
  value: Record<string, unknown>,
  threadId: string,
): AppThreadMessageRecord | null {
  if (
    !isNonEmptyTrimmedString(value.id) ||
    value.threadId !== threadId ||
    value.role !== "user" ||
    typeof value.content !== "string" ||
    typeof value.createdAt !== "string" ||
    !Array.isArray(value.attachments)
  ) {
    return null;
  }
  return value as unknown as AppThreadMessageRecord;
}

function validatedAssistantMessageRecord(
  value: Record<string, unknown>,
  threadId: string,
): AppThreadMessageRecord | null {
  if (
    !isNonEmptyTrimmedString(value.id) ||
    value.threadId !== threadId ||
    value.role !== "assistant" ||
    typeof value.content !== "string" ||
    typeof value.createdAt !== "string" ||
    !Array.isArray(value.attachments) ||
    value.runStatus !== "running"
  ) {
    return null;
  }
  return value as unknown as AppThreadMessageRecord;
}

function validatedRunRecord(
  value: Record<string, unknown>,
  threadId: string,
  messageId: string,
  snapshot: AppStateSnapshot,
): AppThreadRunRecord | null {
  if (
    !isNonEmptyTrimmedString(value.id) ||
    (snapshot.threadRuns ?? []).some((run) => run.id === value.id) ||
    value.threadId !== threadId ||
    value.messageId !== messageId ||
    (value.assistantMessageId !== undefined &&
      !isNonEmptyTrimmedString(value.assistantMessageId)) ||
    typeof value.startedAt !== "string" ||
    !isValidRuntimeSelection(value.runtimeId, value.runtimeMode, value.planMode) ||
    !isValidModelId(value.runtimeModelId)
  ) {
    return null;
  }
  return {
    id: value.id,
    threadId,
    messageId,
    ...(isNonEmptyTrimmedString(value.assistantMessageId)
      ? { assistantMessageId: value.assistantMessageId }
      : {}),
    startedAt: value.startedAt,
    runtimeId: value.runtimeId as RuntimeId,
    ...(isNonEmptyTrimmedString(value.runtimeModelId)
      ? { runtimeModelId: value.runtimeModelId }
      : {}),
    runtimeMode: value.runtimeMode as RuntimeMode,
    planMode: value.planMode as boolean,
  };
}

// Mirrors openThreadDraft: one draft per association, get-or-create. The
// accepted command's data carries the resulting draft.
const openThreadDraft: AppStateCommandReducer = (snapshot, payload) => {
  if (
    !isRecord(payload) ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.projectId !== "string" ||
    !isRecord(payload.draft)
  ) {
    return null;
  }
  if (
    !snapshot.associations.some(
      (item) => item.workspaceId === payload.workspaceId && item.projectId === payload.projectId,
    )
  ) {
    return null;
  }
  const existing = (snapshot.threadDrafts ?? []).find(
    (draft) => draft.workspaceId === payload.workspaceId && draft.projectId === payload.projectId,
  );
  if (existing) return { snapshot, data: existing };

  const draft = validatedDraftRecord(payload.draft, snapshot);
  if (
    !draft ||
    draft.workspaceId !== payload.workspaceId ||
    draft.projectId !== payload.projectId
  ) {
    return null;
  }
  return {
    snapshot: {
      ...snapshot,
      threads: snapshot.threads ?? [],
      threadDrafts: [...(snapshot.threadDrafts ?? []), draft],
    },
    data: draft,
  };
};

// Mirrors updateThreadDraft: a null draft clears the content fields.
const updateThreadDraft: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.draftId !== "string") return null;
  const existing = (snapshot.threadDrafts ?? []).find((draft) => draft.id === payload.draftId);
  if (!existing) return null;
  if (payload.draft !== null && !isRecord(payload.draft)) return null;
  if (
    payload.draft !== null &&
    isRecord(payload.draft) &&
    (typeof payload.draft.content !== "string" ||
      (payload.draft.composerState !== undefined &&
        typeof payload.draft.composerState !== "string") ||
      !Array.isArray(payload.draft.attachedSkillNames) ||
      !Array.isArray(payload.draft.attachments))
  ) {
    return null;
  }
  const draft = payload.draft as {
    content: string;
    composerState?: string;
    attachedSkillNames: string[];
    attachments: AssociationThreadDraftRecord["attachments"];
  } | null;

  return {
    ...snapshot,
    threadDrafts: (snapshot.threadDrafts ?? []).map((item) => {
      if (item.id !== existing.id) return item;
      const { composerState: _composerState, ...withoutComposerState } = item;
      const content = draft?.content ?? "";
      const composerState = draft?.composerState ? draft.composerState : undefined;
      return {
        ...withoutComposerState,
        content,
        ...(composerState ? { composerState } : {}),
        attachedSkillNames: draft ? [...draft.attachedSkillNames] : [],
        attachments: draft ? draft.attachments : [],
      };
    }),
  };
};

// Mirrors updateThreadDraftConfig.
const updateThreadDraftConfig: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.draftId !== "string" || !isRecord(payload.config)) {
    return null;
  }
  if (!(snapshot.threadDrafts ?? []).some((draft) => draft.id === payload.draftId)) return null;
  const config = payload.config;
  if (!isValidRuntimeSelection(config.runtimeId, config.runtimeMode, config.planMode)) return null;
  if (config.runtimeModelId !== undefined && typeof config.runtimeModelId !== "string") return null;
  const runtimeModelId =
    typeof config.runtimeModelId === "string" ? config.runtimeModelId.trim() : "";

  return {
    ...snapshot,
    threadDrafts: (snapshot.threadDrafts ?? []).map((item) => {
      if (item.id !== payload.draftId) return item;
      const { runtimeModelId: _runtimeModelId, ...withoutModel } = item;
      return {
        ...withoutModel,
        runtimeId: config.runtimeId as RuntimeId,
        ...(runtimeModelId ? { runtimeModelId } : {}),
        runtimeMode: config.runtimeMode as RuntimeMode,
        planMode: config.planMode as boolean,
      };
    }),
  };
};

// Mirrors discardThreadDraft.
const discardThreadDraft: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.draftId !== "string") return null;
  if (!(snapshot.threadDrafts ?? []).some((draft) => draft.id === payload.draftId)) return null;

  return {
    ...snapshot,
    threadDrafts: (snapshot.threadDrafts ?? []).filter((draft) => draft.id !== payload.draftId),
    threadPromotionIntents: (snapshot.threadPromotionIntents ?? []).filter(
      (intent) => intent.draftId !== payload.draftId,
    ),
  };
};

// Mirrors prepareThreadDraftPromotion: creates the Thread, its initial user
// message, and the first Run record, and removes the draft — atomically. When
// the draft is already gone because another client won the race, the command
// is a no-op whose data resolves to the existing Thread with `created: false`.
const promoteThreadDraft: AppStateCommandReducer = (snapshot, payload) => {
  if (
    !isRecord(payload) ||
    typeof payload.draftId !== "string" ||
    typeof payload.threadId !== "string" ||
    !isRecord(payload.thread) ||
    !isRecord(payload.message) ||
    !isRecord(payload.assistantMessage) ||
    !isRecord(payload.run)
  ) {
    return null;
  }
  const draft = (snapshot.threadDrafts ?? []).find((item) => item.id === payload.draftId);
  if (!draft || draft.threadId !== payload.threadId) {
    const promoted = (snapshot.threads ?? []).find((thread) => thread.id === payload.threadId);
    if (promoted && !draft) return { snapshot, data: { thread: promoted, created: false } };
    return null;
  }
  const existingThread = (snapshot.threads ?? []).find((thread) => thread.id === draft.threadId);
  if (existingThread) return { snapshot, data: { thread: existingThread, created: false } };

  const threadInput = payload.thread;
  if (
    threadInput.id !== draft.threadId ||
    threadInput.workspaceId !== draft.workspaceId ||
    threadInput.projectId !== draft.projectId ||
    !isNonEmptyTrimmedString(threadInput.title) ||
    typeof threadInput.createdAt !== "string" ||
    typeof threadInput.lastActivityAt !== "string" ||
    !isValidRuntimeSelection(
      threadInput.runtimeId,
      threadInput.runtimeMode,
      threadInput.planMode,
    ) ||
    !isValidModelId(threadInput.runtimeModelId)
  ) {
    return null;
  }
  const message = validatedUserMessageRecord(payload.message, draft.threadId);
  if (!message || (snapshot.threadMessages ?? []).some((item) => item.id === message.id)) {
    return null;
  }
  const assistantMessage = validatedAssistantMessageRecord(
    payload.assistantMessage,
    draft.threadId,
  );
  if (
    !assistantMessage ||
    assistantMessage.id === message.id ||
    (snapshot.threadMessages ?? []).some((item) => item.id === assistantMessage.id)
  ) {
    return null;
  }
  const run = validatedRunRecord(payload.run, draft.threadId, message.id, snapshot);
  if (run?.assistantMessageId !== assistantMessage.id) return null;
  if (!run) return null;

  const thread: AppThreadRecord = {
    id: draft.threadId,
    workspaceId: draft.workspaceId,
    projectId: draft.projectId,
    title: threadInput.title,
    createdAt: threadInput.createdAt,
    lastActivityAt: threadInput.lastActivityAt,
    runtimeId: threadInput.runtimeId as RuntimeId,
    ...(isNonEmptyTrimmedString(threadInput.runtimeModelId)
      ? { runtimeModelId: threadInput.runtimeModelId }
      : {}),
    runtimeMode: threadInput.runtimeMode as RuntimeMode,
    planMode: threadInput.planMode as boolean,
  };

  return {
    snapshot: {
      ...snapshot,
      threads: [...(snapshot.threads ?? []), thread],
      threadDrafts: (snapshot.threadDrafts ?? []).filter((item) => item.id !== draft.id),
      threadMessages: [...(snapshot.threadMessages ?? []), message, assistantMessage],
      threadRuns: [...(snapshot.threadRuns ?? []), run],
      threadPromotionIntents: (snapshot.threadPromotionIntents ?? []).filter(
        (intent) => intent.draftId !== draft.id,
      ),
    },
    data: { thread, created: true },
  };
};

// Mirrors rollbackThreadDraftPromotion: restores the draft and removes the
// promoted Thread, its messages, Runs, and Thread work. Idempotent — a
// repeated rollback after the draft is back is a no-op.
const rollbackThreadDraftPromotion: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || !isRecord(payload.draft)) return null;
  const draft = payload.draft;
  if (
    !isNonEmptyTrimmedString(draft.id) ||
    !isNonEmptyTrimmedString(draft.threadId) ||
    typeof draft.workspaceId !== "string" ||
    typeof draft.projectId !== "string"
  ) {
    return null;
  }
  if ((snapshot.threadDrafts ?? []).some((item) => item.id === draft.id)) return snapshot;
  if (
    !snapshot.associations.some(
      (item) => item.workspaceId === draft.workspaceId && item.projectId === draft.projectId,
    )
  ) {
    return null;
  }

  return {
    ...snapshot,
    threads: (snapshot.threads ?? []).filter((thread) => thread.id !== draft.threadId),
    threadDrafts: [
      ...(snapshot.threadDrafts ?? []),
      draft as unknown as AssociationThreadDraftRecord,
    ],
    threadMessages: (snapshot.threadMessages ?? []).filter(
      (message) => message.threadId !== draft.threadId,
    ),
    threadRuns: (snapshot.threadRuns ?? []).filter((run) => run.threadId !== draft.threadId),
    threadWork: snapshot.threadWork
      ? Object.fromEntries(
          Object.entries(snapshot.threadWork).filter(([threadId]) => threadId !== draft.threadId),
        )
      : undefined,
    threadPromotionIntents: (snapshot.threadPromotionIntents ?? []).filter(
      (intent) => intent.draftId !== draft.id,
    ),
  };
};

// Mirrors recordThreadRun: appends the first user message (unless already
// present) and the Run record, and bumps the Thread's lastActivityAt.
const recordThreadRun: AppStateCommandReducer = (snapshot, payload) => {
  if (
    !isRecord(payload) ||
    typeof payload.threadId !== "string" ||
    !isRecord(payload.message) ||
    !isRecord(payload.assistantMessage) ||
    !isRecord(payload.run)
  ) {
    return null;
  }
  const thread = (snapshot.threads ?? []).find(
    (item) => item.id === payload.threadId && !item.archived,
  );
  if (!thread) return null;
  const message = validatedUserMessageRecord(payload.message, thread.id);
  const assistantMessage = validatedAssistantMessageRecord(payload.assistantMessage, thread.id);
  const run = validatedRunRecord(payload.run, thread.id, payload.message.id as string, snapshot);
  if (
    !message ||
    !assistantMessage ||
    assistantMessage.id === message.id ||
    !run ||
    run.assistantMessageId !== assistantMessage.id
  ) {
    return null;
  }

  return {
    ...snapshot,
    threads: (snapshot.threads ?? []).map((item) =>
      item.id === thread.id ? { ...item, lastActivityAt: run.startedAt } : item,
    ),
    threadMessages: [message, assistantMessage].reduce(
      (messages, item) =>
        messages.some((existing) => existing.id === item.id) ? messages : [...messages, item],
      snapshot.threadMessages ?? [],
    ),
    threadRuns: [...(snapshot.threadRuns ?? []), run],
  };
};

// Mirrors rollbackThreadRun.
const rollbackThreadRun: AppStateCommandReducer = (snapshot, payload) => {
  if (
    !isRecord(payload) ||
    typeof payload.threadId !== "string" ||
    typeof payload.runId !== "string" ||
    typeof payload.messageId !== "string" ||
    typeof payload.assistantMessageId !== "string"
  ) {
    return null;
  }
  const thread = (snapshot.threads ?? []).find((item) => item.id === payload.threadId);
  if (!thread) return null;
  const remainingMessages = (snapshot.threadMessages ?? []).filter(
    (message) => message.id !== payload.messageId && message.id !== payload.assistantMessageId,
  );

  return {
    ...snapshot,
    threadMessages: remainingMessages,
    threadRuns: (snapshot.threadRuns ?? []).filter((run) => run.id !== payload.runId),
    threads: (snapshot.threads ?? []).map((item) =>
      item.id === thread.id
        ? {
            ...item,
            lastActivityAt:
              remainingMessages.filter((message) => message.threadId === thread.id).at(-1)
                ?.createdAt ?? item.createdAt,
          }
        : item,
    ),
  };
};

// Mirrors recordThreadAction.
const recordThreadAction: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || !isRecord(payload.action)) return null;
  const action = payload.action;
  if (
    !isNonEmptyTrimmedString(action.id) ||
    typeof action.threadId !== "string" ||
    action.action !== "compact" ||
    !runtimeIds.includes(action.runtimeId as RuntimeId) ||
    typeof action.completedAt !== "string"
  ) {
    return null;
  }
  const thread = (snapshot.threads ?? []).find((item) => item.id === action.threadId);
  if (!thread) return null;

  const record: AppThreadActionRecord = {
    id: action.id,
    threadId: thread.id,
    action: "compact",
    runtimeId: action.runtimeId as RuntimeId,
    completedAt: action.completedAt,
  };
  return {
    ...snapshot,
    threads: (snapshot.threads ?? []).map((item) =>
      item.id === thread.id ? { ...item, lastActivityAt: record.completedAt } : item,
    ),
    threadActions: [...(snapshot.threadActions ?? []), record],
  };
};

// Snapshot part of deleting a Thread from history; Thread data cleanup runs
// through chat.deleteThreadData before the command is submitted.
const removeThread: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.threadId !== "string") return null;
  if (!(snapshot.threads ?? []).some((thread) => thread.id === payload.threadId)) return null;
  return applyThreadDeletionToAppState(snapshot, [payload.threadId]);
};

// Bounded Thread content update: patches the mutable Thread record fields and
// replaces the Thread's message list in place. Covers rename/pin/activity/
// Run Checklist updates and every message mutation.
const updateThreadContent: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.threadId !== "string") return null;
  const thread = (snapshot.threads ?? []).find((item) => item.id === payload.threadId);
  if (!thread) return null;

  let nextThread = thread;
  if (payload.thread !== undefined) {
    if (!isRecord(payload.thread)) return null;
    const patch = payload.thread;
    nextThread = { ...thread };
    if (patch.title !== undefined) {
      if (typeof patch.title !== "string" || !patch.title.trim()) return null;
      nextThread.title = patch.title.trim();
    }
    if (patch.lastActivityAt !== undefined) {
      if (typeof patch.lastActivityAt !== "string") return null;
      nextThread.lastActivityAt = patch.lastActivityAt;
    }
    if (patch.pinned !== undefined) {
      if (typeof patch.pinned !== "boolean") return null;
      if (patch.pinned) {
        nextThread.pinned = true;
      } else {
        delete nextThread.pinned;
      }
    }
    if (patch.runChecklist !== undefined) {
      if (patch.runChecklist === null) {
        delete nextThread.runChecklist;
      } else {
        const runChecklist = normalizeThreadRunChecklist(patch.runChecklist);
        if (!runChecklist) return null;
        nextThread.runChecklist = runChecklist;
      }
    }
  }

  let threadMessages = snapshot.threadMessages ?? [];
  if (payload.messages !== undefined) {
    if (!Array.isArray(payload.messages)) return null;
    if (payload.messages.some((message) => !isRecord(message) || message.threadId !== thread.id)) {
      return null;
    }
    // Replace the Thread's messages in place so global message order is kept.
    const existingById = new Map(threadMessages.map((message) => [message.id, message]));
    const kimiRunMessageIds = new Set(
      (snapshot.threadRuns ?? []).flatMap((run) =>
        run.runtimeId === "kimi" && run.assistantMessageId ? [run.assistantMessageId] : [],
      ),
    );
    const replacement = (payload.messages as AppThreadMessageRecord[]).map((message) => {
      const existing = existingById.get(message.id);
      if (!existing || !kimiRunMessageIds.has(message.id)) return message;

      const existingEventCount = existing.runEventCount;
      const incomingEventCount = message.runEventCount;
      if (typeof existingEventCount !== "number" || typeof incomingEventCount !== "number") {
        return message;
      }
      if (incomingEventCount < existingEventCount) {
        return existing;
      }
      if (incomingEventCount === existingEventCount) {
        const reconciled = reconcileInterruptedMessage(existing, message.runFinishedAt ?? 0);
        if (isDeepStrictEqual(message, reconciled)) return message;
        if (existing.runStatus === "running" && message.runStatus !== "running") {
          return {
            ...existing,
            runStatus: message.runStatus,
            ...(message.runFinishedAt !== undefined
              ? { runFinishedAt: message.runFinishedAt }
              : {}),
          };
        }
        return existing;
      }
      return message;
    });
    const updated: AppThreadMessageRecord[] = [];
    let inserted = false;
    for (const message of threadMessages) {
      if (message.threadId !== thread.id) {
        updated.push(message);
        continue;
      }
      if (!inserted) {
        updated.push(...replacement);
        inserted = true;
      }
    }
    if (!inserted) updated.push(...replacement);
    threadMessages = updated;
  }

  return {
    ...snapshot,
    threads: (snapshot.threads ?? []).map((item) => (item.id === thread.id ? nextThread : item)),
    threadMessages,
  };
};

// Shared Thread Composer State (composer draft + queued messages). A null
// work value removes the Thread's entry.
const updateThreadWork: AppStateCommandReducer = (snapshot, payload) => {
  if (!isRecord(payload) || typeof payload.threadId !== "string") return null;
  if (!(snapshot.threads ?? []).some((thread) => thread.id === payload.threadId)) return null;
  if (payload.work !== null) {
    if (!isRecord(payload.work) || !Array.isArray(payload.work.queuedMessages)) return null;
    return {
      ...snapshot,
      threadWork: {
        ...snapshot.threadWork,
        [payload.threadId]: payload.work as ThreadWorkSnapshot,
      },
    };
  }
  if (!snapshot.threadWork?.[payload.threadId]) return snapshot;
  const threadWork = { ...snapshot.threadWork };
  delete threadWork[payload.threadId];
  return { ...snapshot, threadWork };
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
  "thread:record-run": recordThreadRun,
  "thread:rollback-run": rollbackThreadRun,
  "thread:record-action": recordThreadAction,
  "thread:remove": removeThread,
  "thread-draft:open": openThreadDraft,
  "thread-draft:update": updateThreadDraft,
  "thread-draft:update-config": updateThreadDraftConfig,
  "thread-draft:discard": discardThreadDraft,
  "thread-draft:promote": promoteThreadDraft,
  "thread-draft:rollback-promotion": rollbackThreadDraftPromotion,
  "thread-content:update": updateThreadContent,
  "thread-work:update": updateThreadWork,
  "state:select-workspace": selectWorkspace,
  "state:remember-thread-location": rememberThreadLocation,
  "settings:update": updateSettings,
};
