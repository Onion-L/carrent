import type { AppStateCommand } from "../../src/shared/appStateAuthority";
import {
  getProjectWorkingDirectoryIdentity,
  type AppProjectRecord,
  type AppStateSnapshot,
  type AppThreadMessageRecord,
  type AppThreadRecord,
  type AppThreadRunRecord,
  type AssociationThreadDraftRecord,
  type WorkspaceProjectAssociationRecord,
  type WorkspaceRecord,
} from "../../src/shared/workspacePersistence";
import type { SqliteClient } from "./sqliteClient";

// Promote resolves competing races by reading whether the promoted Thread
// already exists, so the command client needs `get` in addition to `run`.
type CommandClient = Pick<SqliteClient, "get" | "run">;

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

// Keep in sync with replaceAppStateSnapshot's `threads` upsert
// (sqliteAppStateRepository.ts): the column list and boolean/JSON encodings
// must match so an incremental insert and a full-snapshot replace produce the
// same row.
function insertThread(client: CommandClient, thread: AppThreadRecord): void {
  client.run(
    `INSERT INTO threads (
       id, workspace_id, project_id, title, custom_title, archived, pinned,
       created_at, last_activity_at, runtime_id, runtime_model_id, runtime_mode,
       plan_mode, run_checklist
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    thread.id,
    thread.workspaceId,
    thread.projectId,
    thread.title,
    thread.customTitle === true ? 1 : 0,
    thread.archived === true ? 1 : 0,
    thread.pinned === true ? 1 : 0,
    thread.createdAt,
    thread.lastActivityAt,
    thread.runtimeId,
    thread.runtimeModelId ?? null,
    thread.runtimeMode,
    thread.planMode ? 1 : 0,
    thread.runChecklist ? JSON.stringify(thread.runChecklist) : null,
  );
}

// Keep in sync with replaceAppStateSnapshot's `thread_drafts` upsert
// (sqliteAppStateRepository.ts).
function insertDraft(client: CommandClient, draft: AssociationThreadDraftRecord): void {
  client.run(
    `INSERT INTO thread_drafts (
       id, reserved_thread_id, workspace_id, project_id, content, composer_state,
       attached_skill_names, attachments, runtime_id, runtime_model_id,
       runtime_mode, plan_mode
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    draft.id,
    draft.threadId,
    draft.workspaceId,
    draft.projectId,
    draft.content,
    draft.composerState ?? null,
    JSON.stringify(draft.attachedSkillNames),
    JSON.stringify(draft.attachments),
    draft.runtimeId,
    draft.runtimeModelId ?? null,
    draft.runtimeMode,
    draft.planMode ? 1 : 0,
  );
}

// Mirrors replaceAppStateSnapshot's message handling: the query fields (id,
// threadId, role, content, createdAt) stay in normalized columns, while the
// non-query nested structures — attachment metadata, activity parts, run flags
// — serialize to the `payload` JSON column. Attachment bytes never enter SQLite.
function insertMessage(client: CommandClient, message: AppThreadMessageRecord): void {
  const { id, threadId, role, content, createdAt, ...payload } = message;
  client.run(
    `INSERT INTO thread_messages (id, thread_id, role, message, created_at, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    threadId,
    role,
    content,
    createdAt,
    JSON.stringify(payload),
  );
}

// Keep in sync with replaceAppStateSnapshot's `thread_runs` insert
// (sqliteAppStateRepository.ts).
function insertRun(client: CommandClient, run: AppThreadRunRecord): void {
  client.run(
    `INSERT INTO thread_runs (
       id, thread_id, message_id, assistant_message_id, started_at,
       runtime_id, runtime_model_id, runtime_mode, plan_mode
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    run.id,
    run.threadId,
    run.messageId,
    run.assistantMessageId ?? null,
    run.startedAt,
    run.runtimeId,
    run.runtimeModelId ?? null,
    run.runtimeMode,
    run.planMode ? 1 : 0,
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
    case "thread-draft:open": {
      // `thread-draft:open` is get-or-create: when the association already has
      // a draft the reducer is a no-op (same snapshot reference), so reaching
      // here means a genuine new draft. The reducer's payload carries the draft
      // record itself (`{ workspaceId, projectId, draft }`), so read its id from
      // the draft rather than a top-level field. Persist only that one draft row.
      const draftPayload = payloadRecord(command).draft;
      if (
        typeof draftPayload !== "object" ||
        draftPayload === null ||
        typeof (draftPayload as Record<string, unknown>).id !== "string"
      ) {
        throw new Error(`Invalid draft for incremental App State command: ${command.type}`);
      }
      const draftId = (draftPayload as Record<string, unknown>).id as string;
      const draft = requireAfterEntity(
        (after.threadDrafts ?? []).find((item) => item.id === draftId),
        command,
        "Thread Draft",
      );
      insertDraft(client, draft);
      return;
    }
    case "thread-draft:update": {
      const draftId = payloadId(command, "draftId");
      const draft = requireAfterEntity(
        (after.threadDrafts ?? []).find((item) => item.id === draftId),
        command,
        "Thread Draft",
      );
      client.run(
        `UPDATE thread_drafts
         SET content = ?, composer_state = ?, attached_skill_names = ?, attachments = ?
         WHERE id = ?`,
        draft.content,
        draft.composerState ?? null,
        JSON.stringify(draft.attachedSkillNames),
        JSON.stringify(draft.attachments),
        draftId,
      );
      return;
    }
    case "thread-draft:update-config": {
      const draftId = payloadId(command, "draftId");
      const draft = requireAfterEntity(
        (after.threadDrafts ?? []).find((item) => item.id === draftId),
        command,
        "Thread Draft",
      );
      client.run(
        `UPDATE thread_drafts
         SET runtime_id = ?, runtime_model_id = ?, runtime_mode = ?, plan_mode = ?
         WHERE id = ?`,
        draft.runtimeId,
        draft.runtimeModelId ?? null,
        draft.runtimeMode,
        draft.planMode ? 1 : 0,
        draftId,
      );
      return;
    }
    case "thread-draft:discard": {
      const draftId = payloadId(command, "draftId");
      // A discard removes any uncommitted Promotion Intent for this draft in
      // the same transaction; existing association threads are untouched.
      client.run("DELETE FROM promotion_intents WHERE draft_id = ?", draftId);
      client.run("DELETE FROM thread_drafts WHERE id = ?", draftId);
      return;
    }
    case "thread-draft:promote": {
      const draftId = payloadId(command, "draftId");
      const threadId = payloadId(command, "threadId");
      // Competing promotion: if another client already created this Thread,
      // the reducer resolved to the existing Thread (created: false) and the
      // snapshot no-op'd. A concurrent writer may still have committed the
      // Thread between the reducer and this transaction, so guard against the
      // reserved-id trigger by resolving to the existing Thread instead of
      // creating a duplicate. Either way the draft and any intent are removed
      // so the database matches the reducer's "draft gone" outcome, without
      // producing duplicate Thread/Message/Run rows.
      client.run("DELETE FROM promotion_intents WHERE draft_id = ?", draftId);
      // Delete the draft before inserting the Thread: the
      // threads_reserved_identity_insert trigger aborts a Thread INSERT while
      // a draft still reserves its id.
      client.run("DELETE FROM thread_drafts WHERE id = ?", draftId);
      const existing = client.get<{ id: string }>("SELECT id FROM threads WHERE id = ?", threadId);
      if (!existing) {
        const thread = requireAfterEntity(
          (after.threads ?? []).find((item) => item.id === threadId),
          command,
          "Thread",
        );
        const run = requireAfterEntity(
          (after.threadRuns ?? []).find((item) => item.threadId === threadId),
          command,
          "Thread Run",
        );
        // The Thread owns its initial user message and the assistant
        // placeholder created alongside it; persist exactly those, carrying
        // attachment metadata through the payload column.
        const messages = (after.threadMessages ?? []).filter(
          (message) => message.threadId === threadId,
        );
        insertThread(client, thread);
        for (const message of messages) insertMessage(client, message);
        insertRun(client, run);
      }
      return;
    }
    case "thread-draft:rollback-promotion": {
      // The reducer's payload is `{ draft: {...} }` (no top-level id); the
      // restored draft carries its own id.
      const draftPayload = payloadRecord(command).draft;
      if (
        typeof draftPayload !== "object" ||
        draftPayload === null ||
        typeof (draftPayload as Record<string, unknown>).id !== "string"
      ) {
        throw new Error(`Invalid draft for incremental App State command: ${command.type}`);
      }
      const draftId = (draftPayload as Record<string, unknown>).id as string;
      // The restored draft is present in `after`. A repeated rollback is a
      // reducer no-op (same snapshot reference) and never reaches here, so
      // every rollback that does is genuine.
      const restored = requireAfterEntity(
        (after.threadDrafts ?? []).find((item) => item.id === draftId),
        command,
        "Thread Draft",
      );
      // Delete the promoted Thread before restoring the draft: the
      // thread_drafts_reserved_thread_insert trigger aborts a draft INSERT
      // while a Thread still owns its reserved id. The Thread's messages,
      // Runs, actions, and Thread Composer State cascade-delete with it.
      client.run("DELETE FROM threads WHERE id = ?", restored.threadId);
      client.run("DELETE FROM promotion_intents WHERE draft_id = ?", draftId);
      insertDraft(client, restored);
      return;
    }
    default:
      throw new Error(`Unsupported incremental App State command: ${command.type}`);
  }
}
