import { getProjectWorkingDirectoryIdentity } from "../../src/shared/workspacePersistence";
import { deleteProviderSessionByKey, readProviderSessions } from "./providerSessionRepository";
import type { SqliteClient } from "./sqliteClient";

type RelocationClient = Pick<SqliteClient, "get" | "all" | "run">;

function recordsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

export function relocateProjectInAppState(
  client: RelocationClient,
  request: {
    projectId: string;
    beforeWorkingDirectory: string;
    targetDirectory: string;
    threadIds: string[];
    providerSessions: Record<string, string>;
  },
): { removedProviderSessions: Record<string, string> } {
  const project = client.get<{ working_directory: string }>(
    "SELECT working_directory FROM projects WHERE id = ?",
    request.projectId,
  );
  if (!project) throw new Error("Project not found.");
  const currentThreadIds = client
    .all<{ id: string }>(
      "SELECT id FROM threads WHERE project_id = ? ORDER BY id",
      request.projectId,
    )
    .map((row) => row.id);
  const expectedThreadIds = [...new Set(request.threadIds)].sort();
  const suffixes = expectedThreadIds.map((threadId) => `:${threadId}`);
  const currentProviderSessions = Object.fromEntries(
    Object.entries(readProviderSessions(client)).filter(([key]) =>
      suffixes.some((suffix) => key.endsWith(suffix)),
    ),
  );
  if (
    project.working_directory !== request.beforeWorkingDirectory ||
    JSON.stringify(currentThreadIds) !== JSON.stringify(expectedThreadIds) ||
    !recordsEqual(currentProviderSessions, request.providerSessions)
  ) {
    throw new Error("App State changed during Project relocation.");
  }

  client.run(
    `UPDATE projects
     SET working_directory = ?, working_directory_identity = ?
     WHERE id = ?`,
    request.targetDirectory,
    getProjectWorkingDirectoryIdentity(request.targetDirectory),
    request.projectId,
  );

  for (const key of Object.keys(currentProviderSessions)) {
    deleteProviderSessionByKey(client, key);
  }

  return { removedProviderSessions: currentProviderSessions };
}
