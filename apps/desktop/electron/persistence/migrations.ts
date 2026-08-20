import type { MigrationContext } from "./sqliteClient";

/**
 * Schema migrations.
 *
 * Migrations are registered in one monotonically ordered list. Each migration
 * has a stable numeric `version` and a one-line `name` describing its intent.
 * The runner applies them in ascending order inside a per-migration
 * transaction that also writes its `schema_migrations` row, so a failed
 * migration leaves none of its DDL, data changes, or migration record applied.
 *
 * Released migration definitions are immutable: once a version ships, its
 * `up` body and `name` must never change. Fix-forward with a new, higher
 * migration instead. The runner guards `schema_migrations.name` immutability
 * by erroring if a recorded migration's name no longer matches the registry.
 */

export interface Migration {
  /** Monotonic, unique, never reused or reordered. Starts at 1. */
  readonly version: number;
  /** Human-readable, immutable once released. */
  readonly name: string;
  /**
   * Apply the migration. Runs inside the runner's exclusive transaction with a
   * {@link MigrationContext} that intentionally has no `transaction` method — a
   * migration cannot start its own transaction. Must be synchronous and must
   * not cross an `await` boundary.
   */
  readonly up: (context: MigrationContext) => void;
}

/**
 * The complete, ordered, immutable list of released migrations.
 *
 * Adding a migration: append a new entry with the next `version` and never edit
 * or reorder existing entries. The runner rejects a registry whose versions are
 * not the contiguous sequence `1..n`.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial-app-state-schema",
    up: initialStateSchema,
  },
  {
    version: 2,
    name: "enforce-identity-graph-constraints",
    up: enforceIdentityGraphConstraints,
  },
  {
    version: 3,
    name: "thread-message-payloads",
    up: addThreadMessagePayloads,
  },
  {
    version: 4,
    name: "agent-core-schema",
    up: migrateToAgentCoreSchema,
  },
  {
    version: 5,
    name: "normalize-agent-modes",
    up: normalizeAgentModes,
  },
];

/**
 * Validate that a migration list is the contiguous, monotonically increasing
 * sequence `1..n`. Used by the runner at startup so a reordered or duplicated
 * registry fails loudly instead of silently skipping or re-running migrations.
 */
export function assertMigrationsWellFormed(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new Error(
        `Migration registry is malformed: position ${index} has version ${migration.version}, expected ${expected}.`,
      );
    }
  });
}

/**
 * Read the highest applied migration version from `schema_migrations`, or `0`
 * for a fresh database. Returns `0` when the table does not yet exist (the
 * runner creates it as part of migration 1, but a brand-new connection may be
 * queried before any migration runs).
 */
export function readAppliedMigrationVersion(context: MigrationContext): number {
  const table = context
    .all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .map((row) => row.name);
  if (!table.includes("schema_migrations")) return 0;
  const row = context.get<{ version: number }>(
    "SELECT MAX(version) AS version FROM schema_migrations",
  );
  return row?.version ?? 0;
}

/**
 * The initial schema DDL. Exported as a single string so the Node/Electron
 * smoke suite can apply the exact production schema through `node:sqlite`
 * without resolving the TypeScript migration module, proving the DDL is valid
 * under the production driver and not just under Bun.
 */
export const INITIAL_APP_STATE_SCHEMA_SQL = `
    CREATE TABLE schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL
        CHECK (applied_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
    );

    CREATE TABLE app_metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE workspaces (
      id    TEXT PRIMARY KEY,
      name  TEXT NOT NULL,
      "order" INTEGER NOT NULL CHECK ("order" >= 0)
    );
    CREATE UNIQUE INDEX workspaces_name_unique ON workspaces (name);
    CREATE UNIQUE INDEX workspaces_order_unique ON workspaces ("order");

    CREATE TABLE projects (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      working_directory_identity TEXT NOT NULL
    );
    CREATE UNIQUE INDEX projects_working_directory_identity_unique
      ON projects (working_directory_identity);

    CREATE TABLE workspace_project_associations (
      workspace_id           TEXT NOT NULL REFERENCES workspaces (id),
      project_id             TEXT NOT NULL REFERENCES projects (id),
      "order"                INTEGER NOT NULL CHECK ("order" >= 0),
      alias                  TEXT,
      default_runtime_id     TEXT NOT NULL,
      default_runtime_model_id TEXT,
      default_runtime_mode   TEXT    NOT NULL
        CHECK (default_runtime_mode IN ('ask', 'auto-edit', 'full-project')),
      PRIMARY KEY (workspace_id, project_id)
    );
    CREATE UNIQUE INDEX workspace_project_associations_workspace_order_unique
      ON workspace_project_associations (workspace_id, "order");
    CREATE INDEX workspace_project_associations_by_project
      ON workspace_project_associations (project_id);

    CREATE TABLE threads (
      id               TEXT PRIMARY KEY,
      workspace_id     TEXT NOT NULL,
      project_id       TEXT NOT NULL,
      title            TEXT NOT NULL,
      custom_title     INTEGER NOT NULL DEFAULT 0 CHECK (custom_title IN (0, 1)),
      archived         INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      pinned           INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      created_at       TEXT NOT NULL
        CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
      last_activity_at TEXT NOT NULL
        CHECK (last_activity_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
      runtime_id       TEXT NOT NULL,
      runtime_model_id TEXT,
      runtime_mode     TEXT NOT NULL
        CHECK (runtime_mode IN ('ask', 'auto-edit', 'full-project')),
      plan_mode        INTEGER NOT NULL DEFAULT 0 CHECK (plan_mode IN (0, 1)),
      run_checklist    TEXT,
      FOREIGN KEY (workspace_id, project_id)
        REFERENCES workspace_project_associations (workspace_id, project_id)
    );
    CREATE INDEX threads_by_association ON threads (workspace_id, project_id, last_activity_at);

    CREATE TABLE thread_drafts (
      id                TEXT PRIMARY KEY,
      reserved_thread_id TEXT NOT NULL UNIQUE,
      workspace_id      TEXT NOT NULL,
      project_id        TEXT NOT NULL,
      content           TEXT NOT NULL,
      composer_state    TEXT,
      attached_skill_names TEXT NOT NULL,
      attachments       TEXT NOT NULL,
      runtime_id        TEXT NOT NULL,
      runtime_model_id  TEXT,
      runtime_mode      TEXT NOT NULL
        CHECK (runtime_mode IN ('ask', 'auto-edit', 'full-project')),
      plan_mode         INTEGER NOT NULL DEFAULT 0 CHECK (plan_mode IN (0, 1)),
      FOREIGN KEY (workspace_id, project_id)
        REFERENCES workspace_project_associations (workspace_id, project_id)
    );
    CREATE UNIQUE INDEX thread_drafts_by_association_unique
      ON thread_drafts (workspace_id, project_id);

    CREATE TABLE thread_messages (
      id         TEXT PRIMARY KEY,
      thread_id  TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL
        CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
    );
    CREATE INDEX thread_messages_by_thread_created
      ON thread_messages (thread_id, created_at);

    CREATE TABLE thread_runs (
      id                 TEXT PRIMARY KEY,
      thread_id          TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
      message_id         TEXT NOT NULL REFERENCES thread_messages (id) ON DELETE CASCADE,
      assistant_message_id TEXT REFERENCES thread_messages (id) ON DELETE CASCADE,
      started_at         TEXT NOT NULL
        CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
      runtime_id         TEXT NOT NULL,
      runtime_model_id   TEXT,
      runtime_mode       TEXT NOT NULL
        CHECK (runtime_mode IN ('ask', 'auto-edit', 'full-project')),
      plan_mode          INTEGER NOT NULL DEFAULT 0 CHECK (plan_mode IN (0, 1)),
      CHECK (assistant_message_id IS NULL OR assistant_message_id <> message_id)
    );
    CREATE INDEX thread_runs_by_thread ON thread_runs (thread_id, started_at);
    CREATE INDEX thread_runs_by_message ON thread_runs (message_id);

    CREATE TABLE thread_actions (
      id           TEXT PRIMARY KEY,
      thread_id    TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
      action       TEXT NOT NULL CHECK (action = 'compact'),
      runtime_id   TEXT NOT NULL,
      completed_at TEXT NOT NULL
        CHECK (completed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
    );
    CREATE INDEX thread_actions_by_thread
      ON thread_actions (thread_id, completed_at);

    CREATE TABLE promotion_intents (
      draft_id           TEXT PRIMARY KEY REFERENCES thread_drafts (id) ON DELETE CASCADE,
      thread_id          TEXT NOT NULL,
      workspace_id       TEXT NOT NULL,
      project_id         TEXT NOT NULL,
      title              TEXT NOT NULL,
      run_id             TEXT NOT NULL UNIQUE,
      message_id         TEXT NOT NULL UNIQUE,
      message            TEXT NOT NULL,
      attachments        TEXT NOT NULL,
      message_created_at TEXT,
      started_at         TEXT NOT NULL
        CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
      runtime_id         TEXT NOT NULL,
      runtime_model_id   TEXT,
      runtime_mode       TEXT NOT NULL
        CHECK (runtime_mode IN ('ask', 'auto-edit', 'full-project')),
      plan_mode          INTEGER NOT NULL DEFAULT 0 CHECK (plan_mode IN (0, 1)),
      FOREIGN KEY (workspace_id, project_id)
        REFERENCES workspace_project_associations (workspace_id, project_id)
    );

    CREATE TABLE thread_work (
      thread_id      TEXT PRIMARY KEY REFERENCES threads (id) ON DELETE CASCADE,
      draft          TEXT,
      queued_messages TEXT NOT NULL
    );

    CREATE TABLE workspace_last_threads (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
      thread_id    TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads (id) ON DELETE CASCADE
    );

    CREATE TABLE provider_sessions (
      session_key TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL
    );

    CREATE TABLE settings (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      value TEXT NOT NULL
    );
  `;

/**
 * Initial schema: identity, ownership, ordering, timestamps, roles, state
 * flags, and query fields in normalized columns; nested message activity,
 * attachment metadata, composer data, and other non-query structures in
 * validated JSON text.
 *
 * The PRD's entity set maps to these tables:
 * - `schema_migrations`: durable record of applied migrations.
 * - `app_metadata`: single-row App-level values (currently the import marker).
 * - `workspaces`, `projects`, `workspace_project_associations`: the identity
 *   and ownership graph.
 * - `threads`, `thread_drafts`, `promotion_intents`,
 *   `thread_work`, `thread_messages`, `thread_runs`: conversation state.
 * - `workspace_last_threads`: per-Workspace active Thread (relation, not JSON).
 *
 * Notable constraint choices (see PRD "Implementation Decisions"):
 * - A Thread Draft's `reserved_thread_id` is `UNIQUE` but is NOT a foreign key
 *   to `threads`: the Thread does not exist until promotion, so the FK would
 *   make the Draft uncreatable. The Draft is owned through its association.
 * - `thread_drafts` has exactly one row per association, enforced by a unique
 *   index on `(workspace_id, project_id)`.
 * - Ordering and enum/boolean fields are normalized columns so they can be
 *   indexed and constrained; everything the snapshot normalizers already
 *   validate as opaque JSON stays JSON text.
 */
function initialStateSchema(context: MigrationContext): void {
  context.exec(INITIAL_APP_STATE_SCHEMA_SQL);
}

/**
 * Thread history storage: a message's identity, ownership, role, content, and
 * timestamp stay in normalized columns (they are the query fields), while the
 * non-query nested structures — activity parts, attachment metadata, changed
 * files and their snapshot, and run flags — persist as one validated JSON
 * payload per message. Attachment bytes never enter SQLite; the payload only
 * carries their metadata (storage keys, hashes, dimensions).
 *
 * Rows written before this migration have no payload; backfill them with the
 * minimal valid payload so they still satisfy the snapshot normalizer.
 */
function addThreadMessagePayloads(context: MigrationContext): void {
  context.exec(`
    ALTER TABLE thread_messages ADD COLUMN payload TEXT;
    UPDATE thread_messages SET payload = '{"attachments":[]}' WHERE payload IS NULL;
  `);
}

function migrateToAgentCoreSchema(context: MigrationContext): void {
  context.exec(`
    DROP TRIGGER IF EXISTS associations_runtime_id_insert;
    DROP TRIGGER IF EXISTS associations_runtime_id_update;
    DROP TRIGGER IF EXISTS threads_runtime_id_insert;
    DROP TRIGGER IF EXISTS threads_runtime_id_update;
    DROP TRIGGER IF EXISTS thread_drafts_runtime_id_insert;
    DROP TRIGGER IF EXISTS thread_drafts_runtime_id_update;

    ALTER TABLE workspace_project_associations
      RENAME COLUMN default_runtime_id TO default_provider_profile_id;
    ALTER TABLE workspace_project_associations
      RENAME COLUMN default_runtime_mode TO default_agent_mode;
    ALTER TABLE workspace_project_associations DROP COLUMN default_runtime_model_id;

    ALTER TABLE threads RENAME COLUMN runtime_id TO provider_profile_id;
    ALTER TABLE threads RENAME COLUMN runtime_mode TO agent_mode;
    ALTER TABLE threads DROP COLUMN runtime_model_id;
    ALTER TABLE threads DROP COLUMN plan_mode;

    ALTER TABLE thread_drafts RENAME COLUMN runtime_id TO provider_profile_id;
    ALTER TABLE thread_drafts RENAME COLUMN runtime_mode TO agent_mode;
    ALTER TABLE thread_drafts DROP COLUMN runtime_model_id;
    ALTER TABLE thread_drafts DROP COLUMN plan_mode;

    ALTER TABLE thread_runs RENAME COLUMN runtime_id TO provider_profile_id;
    ALTER TABLE thread_runs RENAME COLUMN runtime_mode TO agent_mode;
    ALTER TABLE thread_runs DROP COLUMN runtime_model_id;
    ALTER TABLE thread_runs DROP COLUMN plan_mode;

    ALTER TABLE promotion_intents RENAME COLUMN runtime_id TO provider_profile_id;
    ALTER TABLE promotion_intents RENAME COLUMN runtime_mode TO agent_mode;
    ALTER TABLE promotion_intents DROP COLUMN runtime_model_id;
    ALTER TABLE promotion_intents DROP COLUMN plan_mode;

    UPDATE workspace_project_associations
      SET default_provider_profile_id = 'default'
      WHERE default_provider_profile_id = 'kimi';
    UPDATE threads SET provider_profile_id = 'default' WHERE provider_profile_id = 'kimi';
    UPDATE thread_drafts SET provider_profile_id = 'default' WHERE provider_profile_id = 'kimi';
    UPDATE thread_runs SET provider_profile_id = 'default' WHERE provider_profile_id = 'kimi';
    UPDATE promotion_intents SET provider_profile_id = 'default' WHERE provider_profile_id = 'kimi';

    DROP TABLE thread_actions;
    DROP TABLE provider_sessions;
  `);
}

function normalizeAgentModes(context: MigrationContext): void {
  const normalizeColumn = (table: string, column: string) => {
    const legacyColumn = `legacy_${column}`;
    context.exec(`
      ALTER TABLE ${table} RENAME COLUMN ${column} TO ${legacyColumn};
      ALTER TABLE ${table} ADD COLUMN ${column} TEXT NOT NULL DEFAULT 'ask'
        CHECK (${column} IN ('ask', 'auto-edit', 'full-project'));
      UPDATE ${table}
      SET ${column} = CASE ${legacyColumn}
        WHEN 'approval-required' THEN 'ask'
        WHEN 'auto-accept-edits' THEN 'auto-edit'
        WHEN 'full-access' THEN 'full-project'
        WHEN 'ask' THEN 'ask'
        WHEN 'auto-edit' THEN 'auto-edit'
        WHEN 'full-project' THEN 'full-project'
        ELSE 'ask'
      END;
      ALTER TABLE ${table} DROP COLUMN ${legacyColumn};
    `);
  };

  normalizeColumn("workspace_project_associations", "default_agent_mode");
  normalizeColumn("threads", "agent_mode");
  normalizeColumn("thread_drafts", "agent_mode");
  normalizeColumn("thread_runs", "agent_mode");
  normalizeColumn("promotion_intents", "agent_mode");
}

function enforceIdentityGraphConstraints(context: MigrationContext): void {
  const existingConstraintViolation = context.get<{ problem: string }>(`
    SELECT 'Workspace ID is required' AS problem FROM workspaces WHERE id IS NULL
    UNION ALL
    SELECT 'Project ID is required' FROM projects WHERE id IS NULL
    UNION ALL
    SELECT 'Thread ID is required' FROM threads WHERE id IS NULL
    UNION ALL
    SELECT 'Thread Draft ID is required' FROM thread_drafts WHERE id IS NULL
    UNION ALL
    SELECT 'invalid Association Runtime ID'
      FROM workspace_project_associations WHERE default_runtime_id NOT IN ('kimi')
    UNION ALL
    SELECT 'invalid Thread Runtime ID' FROM threads WHERE runtime_id NOT IN ('kimi')
    UNION ALL
    SELECT 'invalid Thread Draft Runtime ID' FROM thread_drafts WHERE runtime_id NOT IN ('kimi')
    LIMIT 1
  `);
  if (existingConstraintViolation) throw new Error(existingConstraintViolation.problem);

  const existingConflict = context.get<{ reserved_thread_id: string }>(
    `SELECT draft.reserved_thread_id
     FROM thread_drafts AS draft
     INNER JOIN threads AS thread ON thread.id = draft.reserved_thread_id
     LIMIT 1`,
  );
  if (existingConflict) {
    throw new Error(
      `Thread Draft reserved ID conflicts with an existing Thread: ${existingConflict.reserved_thread_id}`,
    );
  }

  context.exec(`
    CREATE TRIGGER workspaces_id_required_insert
    BEFORE INSERT ON workspaces
    WHEN NEW.id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Workspace ID is required');
    END;

    CREATE TRIGGER workspaces_id_required_update
    BEFORE UPDATE OF id ON workspaces
    WHEN NEW.id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Workspace ID is required');
    END;

    CREATE TRIGGER projects_id_required_insert
    BEFORE INSERT ON projects
    WHEN NEW.id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Project ID is required');
    END;

    CREATE TRIGGER projects_id_required_update
    BEFORE UPDATE OF id ON projects
    WHEN NEW.id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Project ID is required');
    END;

    CREATE TRIGGER threads_id_required_insert
    BEFORE INSERT ON threads
    WHEN NEW.id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Thread ID is required');
    END;

    CREATE TRIGGER threads_id_required_update
    BEFORE UPDATE OF id ON threads
    WHEN NEW.id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Thread ID is required');
    END;

    CREATE TRIGGER thread_drafts_id_required_insert
    BEFORE INSERT ON thread_drafts
    WHEN NEW.id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Thread Draft ID is required');
    END;

    CREATE TRIGGER thread_drafts_id_required_update
    BEFORE UPDATE OF id ON thread_drafts
    WHEN NEW.id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Thread Draft ID is required');
    END;

    CREATE TRIGGER thread_drafts_reserved_thread_insert
    BEFORE INSERT ON thread_drafts
    WHEN EXISTS (SELECT 1 FROM threads WHERE id = NEW.reserved_thread_id)
    BEGIN
      SELECT RAISE(ABORT, 'reserved Thread ID conflicts with an existing Thread');
    END;

    CREATE TRIGGER thread_drafts_reserved_thread_update
    BEFORE UPDATE OF reserved_thread_id ON thread_drafts
    WHEN EXISTS (SELECT 1 FROM threads WHERE id = NEW.reserved_thread_id)
    BEGIN
      SELECT RAISE(ABORT, 'reserved Thread ID conflicts with an existing Thread');
    END;

    CREATE TRIGGER threads_reserved_identity_insert
    BEFORE INSERT ON threads
    WHEN EXISTS (SELECT 1 FROM thread_drafts WHERE reserved_thread_id = NEW.id)
    BEGIN
      SELECT RAISE(ABORT, 'Thread ID conflicts with a reserved Thread ID');
    END;

    CREATE TRIGGER threads_reserved_identity_update
    BEFORE UPDATE OF id ON threads
    WHEN EXISTS (SELECT 1 FROM thread_drafts WHERE reserved_thread_id = NEW.id)
    BEGIN
      SELECT RAISE(ABORT, 'Thread ID conflicts with a reserved Thread ID');
    END;

    CREATE TRIGGER associations_runtime_id_insert
    BEFORE INSERT ON workspace_project_associations
    WHEN NEW.default_runtime_id NOT IN ('kimi')
    BEGIN
      SELECT RAISE(ABORT, 'invalid Association Runtime ID');
    END;

    CREATE TRIGGER associations_runtime_id_update
    BEFORE UPDATE OF default_runtime_id ON workspace_project_associations
    WHEN NEW.default_runtime_id NOT IN ('kimi')
    BEGIN
      SELECT RAISE(ABORT, 'invalid Association Runtime ID');
    END;

    CREATE TRIGGER threads_runtime_id_insert
    BEFORE INSERT ON threads
    WHEN NEW.runtime_id NOT IN ('kimi')
    BEGIN
      SELECT RAISE(ABORT, 'invalid Thread Runtime ID');
    END;

    CREATE TRIGGER threads_runtime_id_update
    BEFORE UPDATE OF runtime_id ON threads
    WHEN NEW.runtime_id NOT IN ('kimi')
    BEGIN
      SELECT RAISE(ABORT, 'invalid Thread Runtime ID');
    END;

    CREATE TRIGGER thread_drafts_runtime_id_insert
    BEFORE INSERT ON thread_drafts
    WHEN NEW.runtime_id NOT IN ('kimi')
    BEGIN
      SELECT RAISE(ABORT, 'invalid Thread Draft Runtime ID');
    END;

    CREATE TRIGGER thread_drafts_runtime_id_update
    BEFORE UPDATE OF runtime_id ON thread_drafts
    WHEN NEW.runtime_id NOT IN ('kimi')
    BEGIN
      SELECT RAISE(ABORT, 'invalid Thread Draft Runtime ID');
    END;
  `);
}
