import {
  APP_STATE_SNAPSHOT_VERSION,
  getProjectWorkingDirectoryIdentity,
  normalizeAppStateSettings,
  normalizeAppStateSnapshotForWrite,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import type { RuntimeMode } from "../../src/shared/runtimeMode";
import type { RuntimeId } from "../../src/shared/runtimes";
import type { SqliteClient } from "./sqliteClient";

type RepositoryClient = Pick<SqliteClient, "all" | "get" | "run">;

type WorkspaceRow = { id: string; name: string; order_value: number };
type ProjectRow = { id: string; name: string; working_directory: string };
type AssociationRow = {
  workspace_id: string;
  project_id: string;
  alias: string | null;
  order_value: number;
  default_runtime_id: RuntimeId;
  default_runtime_model_id: string | null;
  default_runtime_mode: RuntimeMode;
};
type ThreadRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  custom_title: number;
  archived: number;
  pinned: number;
  created_at: string;
  last_activity_at: string;
  runtime_id: RuntimeId;
  runtime_model_id: string | null;
  runtime_mode: RuntimeMode;
  plan_mode: number;
  run_checklist: string | null;
};
type DraftRow = {
  id: string;
  reserved_thread_id: string;
  workspace_id: string;
  project_id: string;
  content: string;
  composer_state: string | null;
  attached_skill_names: string;
  attachments: string;
  runtime_id: RuntimeId;
  runtime_model_id: string | null;
  runtime_mode: RuntimeMode;
  plan_mode: number;
};

function parseJson(value: string | null): unknown {
  if (value === null) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function nextTemporaryValue(used: Set<string>, sequence: { value: number }): string {
  let candidate: string;
  do {
    candidate = `\u0000carrent-rewrite:${sequence.value}`;
    sequence.value += 1;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

export function replaceAppStateIdentityGraph(
  client: RepositoryClient,
  snapshot: AppStateSnapshot,
): void {
  client.run("DELETE FROM workspace_last_threads");
  client.run("DELETE FROM settings");
  client.run("DELETE FROM app_metadata WHERE key = ?", "active_workspace_id");

  // Move locally unique values aside so a valid final snapshot may swap names,
  // paths, orders, or reserved Thread IDs without transient uniqueness errors.
  const sequence = { value: 0 };
  const workspaceNames = new Set([
    ...snapshot.workspaces.map((workspace) => workspace.name),
    ...client.all<{ name: string }>("SELECT name FROM workspaces").map((row) => row.name),
  ]);
  for (const row of client.all<{ id: string }>("SELECT id FROM workspaces ORDER BY id")) {
    client.run(
      'UPDATE workspaces SET name = ?, "order" = "order" + (SELECT COUNT(*) FROM workspaces) + ? WHERE id = ?',
      nextTemporaryValue(workspaceNames, sequence),
      snapshot.workspaces.length,
      row.id,
    );
  }
  const projectIdentities = new Set([
    ...snapshot.projects.map((project) =>
      getProjectWorkingDirectoryIdentity(project.workingDirectory),
    ),
    ...client
      .all<{ working_directory_identity: string }>(
        "SELECT working_directory_identity FROM projects",
      )
      .map((row) => row.working_directory_identity),
  ]);
  for (const row of client.all<{ id: string }>("SELECT id FROM projects ORDER BY id")) {
    client.run(
      "UPDATE projects SET working_directory_identity = ? WHERE id = ?",
      nextTemporaryValue(projectIdentities, sequence),
      row.id,
    );
  }
  client.run(
    `UPDATE workspace_project_associations
     SET "order" = "order" + (
       SELECT COUNT(*) FROM workspace_project_associations AS counted
       WHERE counted.workspace_id = workspace_project_associations.workspace_id
     ) + ?`,
    snapshot.associations.length,
  );
  const reservedThreadIds = new Set([
    ...(snapshot.threads ?? []).map((thread) => thread.id),
    ...(snapshot.threadDrafts ?? []).map((draft) => draft.threadId),
    ...client.all<{ id: string }>("SELECT id FROM threads").map((row) => row.id),
    ...client
      .all<{ reserved_thread_id: string }>("SELECT reserved_thread_id FROM thread_drafts")
      .map((row) => row.reserved_thread_id),
  ]);
  for (const row of client.all<{ id: string }>("SELECT id FROM thread_drafts ORDER BY id")) {
    client.run(
      "UPDATE thread_drafts SET reserved_thread_id = ? WHERE id = ?",
      nextTemporaryValue(reservedThreadIds, sequence),
      row.id,
    );
  }

  for (const workspace of snapshot.workspaces) {
    client.run(
      `INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, "order" = excluded."order"`,
      workspace.id,
      workspace.name,
      workspace.order,
    );
  }
  for (const project of snapshot.projects) {
    client.run(
      `INSERT INTO projects (id, name, working_directory, working_directory_identity)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         working_directory = excluded.working_directory,
         working_directory_identity = excluded.working_directory_identity`,
      project.id,
      project.name,
      project.workingDirectory,
      getProjectWorkingDirectoryIdentity(project.workingDirectory),
    );
  }
  for (const association of snapshot.associations) {
    client.run(
      `INSERT INTO workspace_project_associations (
         workspace_id, project_id, "order", alias, default_runtime_id,
         default_runtime_model_id, default_runtime_mode
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, project_id) DO UPDATE SET
         "order" = excluded."order",
         alias = excluded.alias,
         default_runtime_id = excluded.default_runtime_id,
         default_runtime_model_id = excluded.default_runtime_model_id,
         default_runtime_mode = excluded.default_runtime_mode`,
      association.workspaceId,
      association.projectId,
      association.order,
      association.alias ?? null,
      association.defaultRuntimeId,
      association.defaultRuntimeModelId ?? null,
      association.defaultRuntimeMode,
    );
  }

  const nextDraftIds = new Set((snapshot.threadDrafts ?? []).map((draft) => draft.id));
  for (const row of client.all<{ id: string }>("SELECT id FROM thread_drafts")) {
    if (!nextDraftIds.has(row.id)) client.run("DELETE FROM thread_drafts WHERE id = ?", row.id);
  }
  const nextThreadIds = new Set((snapshot.threads ?? []).map((thread) => thread.id));
  for (const row of client.all<{ id: string }>("SELECT id FROM threads")) {
    if (!nextThreadIds.has(row.id)) client.run("DELETE FROM threads WHERE id = ?", row.id);
  }

  for (const thread of snapshot.threads ?? []) {
    client.run(
      `INSERT INTO threads (
         id, workspace_id, project_id, title, custom_title, archived, pinned,
         created_at, last_activity_at, runtime_id, runtime_model_id, runtime_mode,
         plan_mode, run_checklist
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         project_id = excluded.project_id,
         title = excluded.title,
         custom_title = excluded.custom_title,
         archived = excluded.archived,
         pinned = excluded.pinned,
         created_at = excluded.created_at,
         last_activity_at = excluded.last_activity_at,
         runtime_id = excluded.runtime_id,
         runtime_model_id = excluded.runtime_model_id,
         runtime_mode = excluded.runtime_mode,
         plan_mode = excluded.plan_mode,
         run_checklist = excluded.run_checklist`,
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
  for (const draft of snapshot.threadDrafts ?? []) {
    client.run(
      `INSERT INTO thread_drafts (
         id, reserved_thread_id, workspace_id, project_id, content, composer_state,
         attached_skill_names, attachments, runtime_id, runtime_model_id,
         runtime_mode, plan_mode
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         reserved_thread_id = excluded.reserved_thread_id,
         workspace_id = excluded.workspace_id,
         project_id = excluded.project_id,
         content = excluded.content,
         composer_state = excluded.composer_state,
         attached_skill_names = excluded.attached_skill_names,
         attachments = excluded.attachments,
         runtime_id = excluded.runtime_id,
         runtime_model_id = excluded.runtime_model_id,
         runtime_mode = excluded.runtime_mode,
         plan_mode = excluded.plan_mode`,
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

  const nextAssociationKeys = new Set(
    snapshot.associations.map(({ workspaceId, projectId }) => `${workspaceId}\u0000${projectId}`),
  );
  for (const row of client.all<{ workspace_id: string; project_id: string }>(
    "SELECT workspace_id, project_id FROM workspace_project_associations",
  )) {
    if (!nextAssociationKeys.has(`${row.workspace_id}\u0000${row.project_id}`)) {
      client.run(
        "DELETE FROM workspace_project_associations WHERE workspace_id = ? AND project_id = ?",
        row.workspace_id,
        row.project_id,
      );
    }
  }
  const nextProjectIds = new Set(snapshot.projects.map((project) => project.id));
  for (const row of client.all<{ id: string }>("SELECT id FROM projects")) {
    if (!nextProjectIds.has(row.id)) client.run("DELETE FROM projects WHERE id = ?", row.id);
  }
  const nextWorkspaceIds = new Set(snapshot.workspaces.map((workspace) => workspace.id));
  for (const row of client.all<{ id: string }>("SELECT id FROM workspaces")) {
    if (!nextWorkspaceIds.has(row.id)) client.run("DELETE FROM workspaces WHERE id = ?", row.id);
  }

  if (snapshot.settings) {
    client.run("INSERT INTO settings (id, value) VALUES (1, ?)", JSON.stringify(snapshot.settings));
  }
  if (snapshot.activeWorkspaceId !== null) {
    client.run(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      "active_workspace_id",
      snapshot.activeWorkspaceId,
    );
  }
  for (const [workspaceId, threadId] of Object.entries(snapshot.lastThreadIdByWorkspace ?? {})) {
    client.run(
      "INSERT INTO workspace_last_threads (workspace_id, thread_id) VALUES (?, ?)",
      workspaceId,
      threadId,
    );
  }
}

export function readAppStateIdentityGraph(client: RepositoryClient): AppStateSnapshot | null {
  const workspaces = client
    .all<WorkspaceRow>(
      'SELECT id, name, "order" AS order_value FROM workspaces ORDER BY "order", id',
    )
    .map((row) => ({ id: row.id, name: row.name, order: row.order_value }));
  const projects = client
    .all<ProjectRow>("SELECT id, name, working_directory FROM projects ORDER BY id")
    .map((row) => ({ id: row.id, name: row.name, workingDirectory: row.working_directory }));
  const associations = client
    .all<AssociationRow>(
      `SELECT workspace_id, project_id, alias, "order" AS order_value,
              default_runtime_id, default_runtime_model_id, default_runtime_mode
       FROM workspace_project_associations
       ORDER BY workspace_id, "order", project_id`,
    )
    .map((row) => ({
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      ...(row.alias === null ? {} : { alias: row.alias }),
      order: row.order_value,
      defaultRuntimeId: row.default_runtime_id,
      ...(row.default_runtime_model_id === null
        ? {}
        : { defaultRuntimeModelId: row.default_runtime_model_id }),
      defaultRuntimeMode: row.default_runtime_mode,
    }));
  const threads = client
    .all<ThreadRow>(
      `SELECT id, workspace_id, project_id, title, custom_title, archived, pinned,
              created_at, last_activity_at, runtime_id, runtime_model_id, runtime_mode,
              plan_mode, run_checklist
       FROM threads
       ORDER BY workspace_id, project_id, last_activity_at, id`,
    )
    .map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      title: row.title,
      ...(row.custom_title === 1 ? { customTitle: true } : {}),
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      ...(row.archived === 1 ? { archived: true } : {}),
      ...(row.pinned === 1 ? { pinned: true } : {}),
      runtimeId: row.runtime_id,
      ...(row.runtime_model_id === null ? {} : { runtimeModelId: row.runtime_model_id }),
      runtimeMode: row.runtime_mode,
      planMode: row.plan_mode === 1,
      ...(row.run_checklist === null ? {} : { runChecklist: parseJson(row.run_checklist) }),
    }));
  const threadDrafts = client
    .all<DraftRow>(
      `SELECT id, reserved_thread_id, workspace_id, project_id, content, composer_state,
              attached_skill_names, attachments, runtime_id, runtime_model_id,
              runtime_mode, plan_mode
       FROM thread_drafts
       ORDER BY workspace_id, project_id, id`,
    )
    .map((row) => ({
      id: row.id,
      threadId: row.reserved_thread_id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      content: row.content,
      ...(row.composer_state === null ? {} : { composerState: row.composer_state }),
      attachedSkillNames: parseJson(row.attached_skill_names),
      attachments: parseJson(row.attachments),
      runtimeId: row.runtime_id,
      ...(row.runtime_model_id === null ? {} : { runtimeModelId: row.runtime_model_id }),
      runtimeMode: row.runtime_mode,
      planMode: row.plan_mode === 1,
    }));
  const settingsValue = client.get<{ value: string }>(
    "SELECT value FROM settings WHERE id = 1",
  )?.value;
  const settings =
    settingsValue === undefined
      ? undefined
      : (normalizeAppStateSettings(parseJson(settingsValue)) ?? undefined);
  const lastThreadIdByWorkspace = Object.fromEntries(
    client
      .all<{ workspace_id: string; thread_id: string }>(
        "SELECT workspace_id, thread_id FROM workspace_last_threads ORDER BY workspace_id",
      )
      .map((row) => [row.workspace_id, row.thread_id]),
  );
  const activeWorkspaceId =
    client.get<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ?",
      "active_workspace_id",
    )?.value ?? null;

  return normalizeAppStateSnapshotForWrite({
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces,
    projects,
    associations,
    threads,
    threadDrafts,
    threadMessages: [],
    threadRuns: [],
    threadActions: [],
    threadPromotionIntents: [],
    threadWork: {},
    ...(settings ? { settings } : {}),
    lastThreadIdByWorkspace,
    activeWorkspaceId,
  });
}
