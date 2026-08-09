import type { AppStateCommand } from "../../src/shared/appStateAuthority";
import {
  getProjectWorkingDirectoryIdentity,
  type AppProjectRecord,
  type AppStateSnapshot,
  type WorkspaceProjectAssociationRecord,
  type WorkspaceRecord,
} from "../../src/shared/workspacePersistence";
import type { SqliteClient } from "./sqliteClient";

type CommandClient = Pick<SqliteClient, "run">;

function payloadRecord(command: AppStateCommand): Record<string, unknown> {
  if (typeof command.payload !== "object" || command.payload === null) {
    throw new Error(`Invalid payload for incremental App State command: ${command.type}`);
  }
  return command.payload as Record<string, unknown>;
}

function payloadId(command: AppStateCommand, key: string): string {
  const value = payloadRecord(command)[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${key} for incremental App State command: ${command.type}`);
  }
  return value;
}

function requireAfterEntity<T>(value: T | undefined, command: AppStateCommand, entity: string): T {
  if (value === undefined) {
    throw new Error(`${entity} missing after incremental App State command: ${command.type}`);
  }
  return value;
}

function requireAfterAssociation(command: AppStateCommand, after: AppStateSnapshot) {
  const workspaceId = payloadId(command, "workspaceId");
  const projectId = payloadId(command, "projectId");
  const association = requireAfterEntity(
    after.associations.find(
      (item) => item.workspaceId === workspaceId && item.projectId === projectId,
    ),
    command,
    "Association",
  );
  return { association, workspaceId, projectId };
}

function insertWorkspace(client: CommandClient, workspace: WorkspaceRecord): void {
  client.run(
    'INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)',
    workspace.id,
    workspace.name,
    workspace.order,
  );
}

function insertProject(client: CommandClient, project: AppProjectRecord): void {
  client.run(
    `INSERT INTO projects (id, name, working_directory, working_directory_identity)
     VALUES (?, ?, ?, ?)`,
    project.id,
    project.name,
    project.workingDirectory,
    getProjectWorkingDirectoryIdentity(project.workingDirectory),
  );
}

function insertAssociation(
  client: CommandClient,
  association: WorkspaceProjectAssociationRecord,
): void {
  client.run(
    `INSERT INTO workspace_project_associations (
       workspace_id, project_id, "order", alias, default_runtime_id,
       default_runtime_model_id, default_runtime_mode
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    association.workspaceId,
    association.projectId,
    association.order,
    association.alias ?? null,
    association.defaultRuntimeId,
    association.defaultRuntimeModelId ?? null,
    association.defaultRuntimeMode,
  );
}

function setActiveWorkspace(client: CommandClient, workspaceId: string): void {
  client.run(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    "active_workspace_id",
    workspaceId,
  );
}

function persistWorkspaceCreate(
  client: CommandClient,
  command: AppStateCommand,
  workspaceId: string,
  before: AppStateSnapshot,
  after: AppStateSnapshot,
): void {
  const workspace = requireAfterEntity(
    after.workspaces.find((item) => item.id === workspaceId),
    command,
    "Workspace",
  );
  if (before.workspaces.some((item) => item.id === workspaceId)) {
    throw new Error(`Workspace already existed before incremental command: ${workspaceId}`);
  }

  insertWorkspace(client, workspace);
  const previousProjectIds = new Set(before.projects.map((project) => project.id));
  for (const project of after.projects) {
    if (!previousProjectIds.has(project.id)) insertProject(client, project);
  }
  for (const association of after.associations) {
    if (association.workspaceId === workspaceId) insertAssociation(client, association);
  }
  setActiveWorkspace(client, workspaceId);
}

function persistProjectAdd(
  client: CommandClient,
  command: AppStateCommand,
  before: AppStateSnapshot,
  after: AppStateSnapshot,
): void {
  const workspaceId = payloadId(command, "workspaceId");
  const previousAssociationKeys = new Set(
    before.associations.map((item) => `${item.workspaceId}\u0000${item.projectId}`),
  );
  const addedAssociations = after.associations.filter(
    (item) =>
      item.workspaceId === workspaceId &&
      !previousAssociationKeys.has(`${item.workspaceId}\u0000${item.projectId}`),
  );
  if (addedAssociations.length !== 1) {
    throw new Error("Project add command must add exactly one Association.");
  }
  const association = addedAssociations[0];
  const project = requireAfterEntity(
    after.projects.find((item) => item.id === association.projectId),
    command,
    "Project",
  );
  if (!before.projects.some((item) => item.id === project.id)) insertProject(client, project);
  insertAssociation(client, association);
}

export function persistIncrementalAppStateCommand(
  client: CommandClient,
  command: AppStateCommand,
  before: AppStateSnapshot,
  after: AppStateSnapshot,
): void {
  switch (command.type) {
    case "workspace:create": {
      const workspace = payloadRecord(command).workspace;
      if (typeof workspace !== "object" || workspace === null) {
        throw new Error(`Invalid Workspace payload for incremental command: ${command.type}`);
      }
      const workspaceId = (workspace as Record<string, unknown>).id;
      if (typeof workspaceId !== "string" || workspaceId.length === 0) {
        throw new Error(`Invalid Workspace id for incremental command: ${command.type}`);
      }
      persistWorkspaceCreate(client, command, workspaceId, before, after);
      return;
    }
    case "workspace:rename": {
      const workspaceId = payloadId(command, "workspaceId");
      const workspace = requireAfterEntity(
        after.workspaces.find((item) => item.id === workspaceId),
        command,
        "Workspace",
      );
      client.run("UPDATE workspaces SET name = ? WHERE id = ?", workspace.name, workspace.id);
      return;
    }
    case "project:add":
      persistProjectAdd(client, command, before, after);
      return;
    case "project:rename": {
      const projectId = payloadId(command, "projectId");
      const project = requireAfterEntity(
        after.projects.find((item) => item.id === projectId),
        command,
        "Project",
      );
      client.run("UPDATE projects SET name = ? WHERE id = ?", project.name, project.id);
      return;
    }
    case "project:set-alias": {
      const { association, workspaceId, projectId } = requireAfterAssociation(command, after);
      client.run(
        `UPDATE workspace_project_associations SET alias = ?
         WHERE workspace_id = ? AND project_id = ?`,
        association.alias ?? null,
        workspaceId,
        projectId,
      );
      return;
    }
    case "association:set-defaults": {
      const { association, workspaceId, projectId } = requireAfterAssociation(command, after);
      client.run(
        `UPDATE workspace_project_associations
         SET default_runtime_id = ?, default_runtime_model_id = ?, default_runtime_mode = ?
         WHERE workspace_id = ? AND project_id = ?`,
        association.defaultRuntimeId,
        association.defaultRuntimeModelId ?? null,
        association.defaultRuntimeMode,
        workspaceId,
        projectId,
      );
      return;
    }
    case "settings:update": {
      const settings = requireAfterEntity(after.settings, command, "Settings");
      client.run(
        `INSERT INTO settings (id, value) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
        1,
        JSON.stringify(settings),
      );
      return;
    }
    case "state:select-workspace":
      setActiveWorkspace(client, payloadId(command, "workspaceId"));
      return;
    case "state:remember-thread-location": {
      const workspaceId = payloadId(command, "workspaceId");
      const threadId = requireAfterEntity(
        after.lastThreadIdByWorkspace?.[workspaceId],
        command,
        "Thread",
      );
      client.run(
        `INSERT INTO workspace_last_threads (workspace_id, thread_id) VALUES (?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET thread_id = excluded.thread_id`,
        workspaceId,
        threadId,
      );
      setActiveWorkspace(client, workspaceId);
      return;
    }
    default:
      throw new Error(`Unsupported incremental App State command: ${command.type}`);
  }
}
