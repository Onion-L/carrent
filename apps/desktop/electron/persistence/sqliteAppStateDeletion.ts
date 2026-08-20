import type { ThreadDeletionScope } from "../../src/shared/chat";
import type { SqliteClient } from "./sqliteClient";

/**
 * Row-level Thread deletion, mirroring `applyThreadDeletionToAppState`'s scope
 * rules (see `src/shared/chat.ts`) as bound SQL inside the caller's transaction.
 *
 * The Thread-owned tables (`thread_messages`, `thread_runs`, `thread_work`) and
 * `workspace_last_threads` cascade-delete with the `threads`
 * row (`ON DELETE CASCADE`). A Thread Draft's `reserved_thread_id` is
 * intentionally NOT a foreign key (the Thread does not exist until promotion),
 * so drafts and their cascading `promotion_intents` are deleted explicitly.
 * The whole deletion runs in the caller's transaction, so any constraint or
 * statement failure rolls back every deleted row.
 */
export function deleteThreadsFromAppState(
  client: Pick<SqliteClient, "all" | "get" | "run">,
  operationId: string,
  threadIds: string[],
  scope?: ThreadDeletionScope,
): void {
  const targetThreadIds = collectTargetThreadIds(client, threadIds, scope);

  for (const threadId of targetThreadIds) {
    // Deleting the `threads` row cascades thread_messages, thread_runs,
    // thread_work, and workspace_last_threads (thread_id FK).
    client.run("DELETE FROM threads WHERE id = ?", threadId);
    // Draft promotion can reserve a Thread ID before the Thread row exists.
    client.run("DELETE FROM thread_drafts WHERE reserved_thread_id = ?", threadId);
  }

  if (!scope || scope.kind === "threads") {
    recordCommittedDeletion(client, operationId);
    return;
  }

  if (scope.kind === "association") {
    deleteAssociationScope(client, scope);
    recordCommittedDeletion(client, operationId);
    return;
  }

  deleteWorkspaceScope(client, scope);
  recordCommittedDeletion(client, operationId);
  return;
}

export function threadDeletionOperationKey(operationId: string): string {
  return `thread_deletion_operation:${operationId}`;
}

function collectTargetThreadIds(
  client: Pick<SqliteClient, "all">,
  threadIds: string[],
  scope?: ThreadDeletionScope,
): string[] {
  const ids = new Set(threadIds);
  if (scope?.kind === "association") {
    for (const row of client.all<{ id: string }>(
      "SELECT id FROM threads WHERE workspace_id = ? AND project_id = ?",
      scope.workspaceId,
      scope.projectId,
    )) {
      ids.add(row.id);
    }
  } else if (scope?.kind === "workspace") {
    for (const row of client.all<{ id: string }>(
      "SELECT id FROM threads WHERE workspace_id = ?",
      scope.workspaceId,
    )) {
      ids.add(row.id);
    }
  }
  return [...ids];
}

function recordCommittedDeletion(client: Pick<SqliteClient, "run">, operationId: string): void {
  client.run(
    "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
    threadDeletionOperationKey(operationId),
    new Date().toISOString(),
  );
}

function deleteAssociationScope(
  client: Pick<SqliteClient, "all" | "run">,
  scope: { workspaceId: string; projectId: string },
): void {
  // The association's Threads were already derived and deleted above. Remove the
  // association row, its drafts, reindex the workspace's remaining associations
  // so per-workspace orders stay contiguous (a UNIQUE(workspace_id, "order")
  // constraint would otherwise fire), and drop the project iff no other
  // association still references it (the orphan-Project rule).
  client.run(
    "DELETE FROM thread_drafts WHERE workspace_id = ? AND project_id = ?",
    scope.workspaceId,
    scope.projectId,
  );
  client.run(
    "DELETE FROM workspace_project_associations WHERE workspace_id = ? AND project_id = ?",
    scope.workspaceId,
    scope.projectId,
  );
  reindexAssociationOrders(client, scope.workspaceId);

  const remaining = client.all<{ project_id: string }>(
    "SELECT project_id FROM workspace_project_associations WHERE project_id = ?",
    scope.projectId,
  );
  if (remaining.length === 0) {
    client.run("DELETE FROM projects WHERE id = ?", scope.projectId);
  }
}

function deleteWorkspaceScope(
  client: Pick<SqliteClient, "all" | "get" | "run">,
  scope: { workspaceId: string },
): void {
  // The workspace's Threads were already derived and deleted above. Remove the workspace's
  // associations and drafts, its orphan projects, the workspace row (cascades
  // its workspace_last_threads), reindex remaining workspace orders, and move
  // the active workspace to a surviving neighbor when the active one is gone.
  const associationProjects = client.all<{ project_id: string }>(
    "SELECT project_id FROM workspace_project_associations WHERE workspace_id = ?",
    scope.workspaceId,
  );
  client.run("DELETE FROM thread_drafts WHERE workspace_id = ?", scope.workspaceId);
  client.run(
    "DELETE FROM workspace_project_associations WHERE workspace_id = ?",
    scope.workspaceId,
  );

  for (const { project_id: projectId } of associationProjects) {
    const remaining = client.all<{ project_id: string }>(
      "SELECT project_id FROM workspace_project_associations WHERE project_id = ?",
      projectId,
    );
    if (remaining.length === 0) {
      client.run("DELETE FROM projects WHERE id = ?", projectId);
    }
  }

  const activeRow = client.get<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    "active_workspace_id",
  );
  const activeWasDeleted = activeRow?.value === scope.workspaceId;

  const nextWorkspace = activeWasDeleted ? pickSurvivingWorkspace(client, scope.workspaceId) : null;
  client.run("DELETE FROM workspaces WHERE id = ?", scope.workspaceId);

  if (activeWasDeleted) {
    if (nextWorkspace) {
      client.run(
        `INSERT INTO app_metadata (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        "active_workspace_id",
        nextWorkspace,
      );
    } else {
      client.run("DELETE FROM app_metadata WHERE key = ?", "active_workspace_id");
    }
  }

  reindexWorkspaceOrders(client);
}

/**
 * Reindex one workspace's association orders to be contiguous starting at 0, in
 * the rows' current `(workspace_id, "order", project_id)` order. SQLite has no
 * deferred unique-constraint window, so the reindex moves each row to a
 * temporary non-conflicting order first, then to its final contiguous order.
 */
function reindexAssociationOrders(
  client: Pick<SqliteClient, "all" | "run">,
  workspaceId: string,
): void {
  const rows = client.all<{ project_id: string; association_order: number }>(
    `SELECT project_id, "order" AS association_order
     FROM workspace_project_associations
     WHERE workspace_id = ?
     ORDER BY "order", project_id`,
    workspaceId,
  );
  if (rows.length === 0) return;
  const temporaryStart = Math.max(...rows.map((row) => row.association_order)) + 1;
  for (const [index, { project_id: projectId }] of rows.entries()) {
    client.run(
      `UPDATE workspace_project_associations SET "order" = ? WHERE workspace_id = ? AND project_id = ?`,
      temporaryStart + index,
      workspaceId,
      projectId,
    );
  }
  let nextOrder = 0;
  for (const { project_id: projectId } of rows) {
    client.run(
      `UPDATE workspace_project_associations SET "order" = ? WHERE workspace_id = ? AND project_id = ?`,
      nextOrder,
      workspaceId,
      projectId,
    );
    nextOrder += 1;
  }
}

/**
 * Reindex workspace orders to be contiguous starting at 0, in current order.
 * Same temporary-order technique as association reindex.
 */
function reindexWorkspaceOrders(client: Pick<SqliteClient, "all" | "run">): void {
  const rows = client.all<{ id: string; workspace_order: number }>(
    'SELECT id, "order" AS workspace_order FROM workspaces ORDER BY "order", id',
  );
  if (rows.length === 0) return;
  const temporaryStart = Math.max(...rows.map((row) => row.workspace_order)) + 1;
  for (const [index, { id }] of rows.entries()) {
    client.run('UPDATE workspaces SET "order" = ? WHERE id = ?', temporaryStart + index, id);
  }
  let nextOrder = 0;
  for (const { id } of rows) {
    client.run('UPDATE workspaces SET "order" = ? WHERE id = ?', nextOrder, id);
    nextOrder += 1;
  }
}

/**
 * Pick the workspace that should become active after `deletedWorkspaceId` is
 * gone: the next workspace by order, falling back to the previous one. Returns
 * null when no workspace survives (the active-workspace column is cleared).
 */
function pickSurvivingWorkspace(
  client: Pick<SqliteClient, "all">,
  deletedWorkspaceId: string,
): string | null {
  const rows = client.all<{ id: string }>('SELECT id FROM workspaces ORDER BY "order", id');
  const index = rows.findIndex((row) => row.id === deletedWorkspaceId);
  return rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;
}
