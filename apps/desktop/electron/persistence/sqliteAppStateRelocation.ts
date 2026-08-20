import { getProjectWorkingDirectoryIdentity } from "../../src/shared/workspacePersistence";
import type { SqliteClient } from "./sqliteClient";

type RelocationClient = Pick<SqliteClient, "get" | "all" | "run">;

export function relocateProjectInAppState(
  client: RelocationClient,
  request: {
    projectId: string;
    beforeWorkingDirectory: string;
    targetDirectory: string;
    threadIds: string[];
  },
): void {
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
  if (
    project.working_directory !== request.beforeWorkingDirectory ||
    JSON.stringify(currentThreadIds) !== JSON.stringify(expectedThreadIds)
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
}
