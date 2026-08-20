import type { AppStateCommand } from "../../src/shared/appStateAuthority";
import {
  getProjectWorkingDirectoryIdentity,
  serializeAppStateSettings,
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
       workspace_id, project_id, "order", alias, default_provider_profile_id, default_agent_mode
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    association.workspaceId,
    association.projectId,
    association.order,
    association.alias ?? null,
    association.defaultProviderProfileId,
    association.defaultAgentMode,
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
       created_at, last_activity_at, provider_profile_id, agent_mode, run_checklist
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    thread.id,
    thread.workspaceId,
    thread.projectId,
    thread.title,
    thread.customTitle === true ? 1 : 0,
    thread.archived === true ? 1 : 0,
    thread.pinned === true ? 1 : 0,
    thread.createdAt,
    thread.lastActivityAt,
    thread.providerProfileId,
    thread.agentMode,
    thread.runChecklist ? JSON.stringify(thread.runChecklist) : null,
  );
}

// Keep in sync with replaceAppStateSnapshot's `thread_drafts` upsert
// (sqliteAppStateRepository.ts).
function insertDraft(client: CommandClient, draft: AssociationThreadDraftRecord): void {
  client.run(
    `INSERT INTO thread_drafts (
       id, reserved_thread_id, workspace_id, project_id, content, composer_state,
       attached_skill_names, attachments, provider_profile_id, agent_mode
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    draft.id,
    draft.threadId,
    draft.workspaceId,
    draft.projectId,
    draft.content,
    draft.composerState ?? null,
    JSON.stringify(draft.attachedSkillNames),
    JSON.stringify(draft.attachments),
    draft.providerProfileId,
    draft.agentMode,
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
       provider_profile_id, agent_mode
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    run.id,
    run.threadId,
    run.messageId,
    run.assistantMessageId ?? null,
    run.startedAt,
    run.providerProfileId,
    run.agentMode,
  );
}

// Keep in sync with replaceAppStateSnapshot's `threads` upsert column list and
// encodings (sqliteAppStateRepository.ts). The reducer always produces a fully
// resolved `after` thread, so writing every metadata column from `after` (rather
// than per-command column subsets) is simpler and avoids drift between the
// incremental path and a full-snapshot replace.
function updateThreadMetadata(client: CommandClient, thread: AppThreadRecord): void {
  client.run(
    `UPDATE threads SET
       workspace_id = ?, project_id = ?, title = ?, custom_title = ?,
       archived = ?, pinned = ?, created_at = ?, last_activity_at = ?,
       provider_profile_id = ?, agent_mode = ?, run_checklist = ?
     WHERE id = ?`,
    thread.workspaceId,
    thread.projectId,
    thread.title,
    thread.customTitle === true ? 1 : 0,
    thread.archived === true ? 1 : 0,
    thread.pinned === true ? 1 : 0,
    thread.createdAt,
    thread.lastActivityAt,
    thread.providerProfileId,
    thread.agentMode,
    thread.runChecklist ? JSON.stringify(thread.runChecklist) : null,
    thread.id,
  );
}

// The persisted message row identity used for change detection: the `message`
// column plus the JSON payload derived the same way `insertMessage` builds it.
// Two messages with the same id whose identity differs need an UPDATE; matching
// identity is left untouched so an unaffected message history isn't rewritten.
function messageRowIdentity(message: AppThreadMessageRecord): { message: string; payload: string } {
  const {
    id: _id,
    threadId: _threadId,
    role: _role,
    content,
    createdAt: _createdAt,
    ...payload
  } = message;
  return { message: content, payload: JSON.stringify(payload) };
}

function updateMessageRow(client: CommandClient, message: AppThreadMessageRecord): void {
  const { message: content, payload } = messageRowIdentity(message);
  client.run(
    `UPDATE thread_messages SET message = ?, payload = ? WHERE id = ?`,
    content,
    payload,
    message.id,
  );
}

// The Thread columns an incremental command can change. Two threads whose
// identity matches need no metadata write, so a streamed message update that
// did not patch the Thread record leaves the Thread row untouched. Comparison
// is by value (not reference) because the snapshot normalizer produces fresh
// object references even when a command did not change the Thread.
function threadMetadataIdentity(thread: AppThreadRecord): string {
  return JSON.stringify({
    workspaceId: thread.workspaceId,
    projectId: thread.projectId,
    title: thread.title,
    customTitle: thread.customTitle === true,
    archived: thread.archived === true,
    pinned: thread.pinned === true,
    createdAt: thread.createdAt,
    lastActivityAt: thread.lastActivityAt,
    providerProfileId: thread.providerProfileId,
    agentMode: thread.agentMode,
    runChecklist: thread.runChecklist ?? null,
  });
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
         SET default_provider_profile_id = ?, default_agent_mode = ?
         WHERE workspace_id = ? AND project_id = ?`,
        association.defaultProviderProfileId,
        association.defaultAgentMode,
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
        serializeAppStateSettings(settings),
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
         SET provider_profile_id = ?, agent_mode = ?
         WHERE id = ?`,
        draft.providerProfileId,
        draft.agentMode,
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
    case "thread:archive": {
      const threadId = payloadId(command, "threadId");
      const thread = requireAfterEntity(
        (after.threads ?? []).find((item) => item.id === threadId),
        command,
        "Thread",
      );
      // Only the owning Thread row changes; archiving also clears the
      // remembered Thread location when it pointed at this Thread (mirrors the
      // reducer's `lastThreadIdByWorkspace` cleanup). Existing history rows are
      // untouched.
      updateThreadMetadata(client, thread);
      const remembered = before.lastThreadIdByWorkspace?.[thread.workspaceId];
      if (remembered === threadId) {
        client.run("DELETE FROM workspace_last_threads WHERE workspace_id = ?", thread.workspaceId);
      }
      return;
    }
    case "thread:restore": {
      const threadId = payloadId(command, "threadId");
      const thread = requireAfterEntity(
        (after.threads ?? []).find((item) => item.id === threadId),
        command,
        "Thread",
      );
      updateThreadMetadata(client, thread);
      return;
    }
    case "thread:update-config": {
      const threadId = payloadId(command, "threadId");
      const thread = requireAfterEntity(
        (after.threads ?? []).find((item) => item.id === threadId),
        command,
        "Thread",
      );
      // One Thread row. Writing the full metadata set from `after` mirrors the
      // reducer's resolved Agent config without
      // per-column drift.
      updateThreadMetadata(client, thread);
      return;
    }
    case "thread:record-run": {
      const threadId = payloadId(command, "threadId");
      const thread = requireAfterEntity(
        (after.threads ?? []).find((item) => item.id === threadId),
        command,
        "Thread",
      );
      // Append the Run and any not-yet-present messages, and bump the Thread's
      // activity time. The reducer dedupes an already-present initial user
      // message, so only INSERT messages that are new to this Thread.
      const beforeMessageIds = new Set(
        (before.threadMessages ?? [])
          .filter((message) => message.threadId === threadId)
          .map((message) => message.id),
      );
      const newMessages = (after.threadMessages ?? []).filter(
        (message) => message.threadId === threadId && !beforeMessageIds.has(message.id),
      );
      for (const newMessage of newMessages) insertMessage(client, newMessage);
      const newRunIds = new Set(
        (before.threadRuns ?? []).filter((run) => run.threadId === threadId).map((run) => run.id),
      );
      const newRuns = (after.threadRuns ?? []).filter(
        (run) => run.threadId === threadId && !newRunIds.has(run.id),
      );
      for (const newRun of newRuns) insertRun(client, newRun);
      updateThreadMetadata(client, thread);
      return;
    }
    case "thread:rollback-run": {
      const threadId = payloadId(command, "threadId");
      const thread = requireAfterEntity(
        (after.threads ?? []).find((item) => item.id === threadId),
        command,
        "Thread",
      );
      // Delete the rolled-back messages and Run, then recompute the Thread's
      // activity time from `after`.
      const afterMessageIds = new Set((after.threadMessages ?? []).map((message) => message.id));
      const removedMessages = (before.threadMessages ?? [])
        .filter((message) => message.threadId === threadId && !afterMessageIds.has(message.id))
        .map((message) => message.id);
      for (const removedId of removedMessages) {
        client.run("DELETE FROM thread_messages WHERE id = ?", removedId);
      }
      const afterRunIds = new Set((after.threadRuns ?? []).map((run) => run.id));
      const removedRuns = (before.threadRuns ?? [])
        .filter((run) => run.threadId === threadId && !afterRunIds.has(run.id))
        .map((run) => run.id);
      for (const removedId of removedRuns) {
        client.run("DELETE FROM thread_runs WHERE id = ?", removedId);
      }
      updateThreadMetadata(client, thread);
      return;
    }
    case "thread:set-automatic-title": {
      const threadId = payloadId(command, "threadId");
      // The reducer accepts the command only when the Thread still exists, so
      // the `after` snapshot carries the updated Thread. updateThreadMetadata
      // writes the new title and leaves custom_title at 0 because an automatic
      // title never sets the manual-title marker.
      const thread = requireAfterEntity(
        (after.threads ?? []).find((item) => item.id === threadId),
        command,
        "Thread",
      );
      updateThreadMetadata(client, thread);
      return;
    }
    case "thread-content:update": {
      const threadId = payloadId(command, "threadId");
      // Diff the owning Thread's before/after messages by id: insert new ids,
      // delete ids the reducer actually removed (explicit delete paths only —
      // thread-content:update no longer drops omitted ids), and update only
      // rows whose content or payload actually changed. `after` already carries
      // the reducer's reconciled messages (it swaps regressing event-count
      // messages for the existing row), so persisting `after` preserves the
      // run-event-count anti-regression and interrupted-message reconciliation
      // without re-deriving them here. Unaffected message history is left
      // untouched.
      const beforeMessages = new Map(
        (before.threadMessages ?? [])
          .filter((message) => message.threadId === threadId)
          .map((message) => [message.id, message]),
      );
      const afterMessages = new Map(
        (after.threadMessages ?? [])
          .filter((message) => message.threadId === threadId)
          .map((message) => [message.id, message]),
      );
      for (const id of beforeMessages.keys()) {
        if (!afterMessages.has(id)) {
          client.run("DELETE FROM thread_messages WHERE id = ?", id);
        }
      }
      for (const [id, afterMessage] of afterMessages) {
        const beforeMessage = beforeMessages.get(id);
        if (beforeMessage === undefined) {
          insertMessage(client, afterMessage);
          continue;
        }
        const beforeIdentity = messageRowIdentity(beforeMessage);
        const afterIdentity = messageRowIdentity(afterMessage);
        if (
          beforeIdentity.message !== afterIdentity.message ||
          beforeIdentity.payload !== afterIdentity.payload
        ) {
          updateMessageRow(client, afterMessage);
        }
      }
      // Thread metadata changes only when the reducer patched title/activity/
      // pin/runChecklist; a pure streamed message update writes no Thread row.
      // Compare by value (not reference): the snapshot normalizer produces fresh
      // object references even when a command did not change the Thread.
      const beforeThread = (before.threads ?? []).find((item) => item.id === threadId);
      const afterThread = (after.threads ?? []).find((item) => item.id === threadId);
      if (
        afterThread &&
        (!beforeThread ||
          threadMetadataIdentity(beforeThread) !== threadMetadataIdentity(afterThread))
      ) {
        updateThreadMetadata(client, afterThread);
      }
      return;
    }
    case "thread-work:update": {
      const threadId = payloadId(command, "threadId");
      // The Thread Composer State (composer draft + queued messages) lives on
      // the owning Thread only. A null work value removes the entry; the
      // queued-message restart-confirmation rule is enforced by the snapshot
      // normalizer on load, not by this write.
      const work = after.threadWork?.[threadId];
      if (work) {
        client.run(
          `INSERT INTO thread_work (thread_id, draft, queued_messages) VALUES (?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             draft = excluded.draft, queued_messages = excluded.queued_messages`,
          threadId,
          work.draft ? JSON.stringify(work.draft) : null,
          JSON.stringify(work.queuedMessages),
        );
      } else {
        client.run("DELETE FROM thread_work WHERE thread_id = ?", threadId);
      }
      return;
    }
    default:
      throw new Error(`Unsupported incremental App State command: ${command.type}`);
  }
}
