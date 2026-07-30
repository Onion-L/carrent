import type {
  AppProjectRecord,
  AppThreadRecord,
  WorkspaceProjectAssociationRecord,
  WorkspaceRecord,
} from "../../shared/workspacePersistence";
import type { ThreadSearchEntry } from "../../shared/threadSearch";

type SearchThreadsInput = {
  threads: AppThreadRecord[];
  workspaces: WorkspaceRecord[];
  projects: AppProjectRecord[];
  associations: WorkspaceProjectAssociationRecord[];
  query: string;
};

function getMatchRank(title: string, query: string) {
  const normalizedTitle = title.toLocaleLowerCase();
  if (normalizedTitle === query) return 0;
  if (normalizedTitle.startsWith(query)) return 1;
  return normalizedTitle.includes(query) ? 2 : null;
}

function getActivityTime(thread: AppThreadRecord) {
  const timestamp = Date.parse(thread.lastActivityAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function searchThreads({
  threads,
  workspaces,
  projects,
  associations,
  query,
}: SearchThreadsInput): ThreadSearchEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const entries = threads.flatMap((thread) => {
    if (thread.archived) return [];

    const workspace = workspaces.find((item) => item.id === thread.workspaceId);
    const project = projects.find((item) => item.id === thread.projectId);
    const association = associations.find(
      (item) => item.workspaceId === thread.workspaceId && item.projectId === thread.projectId,
    );
    if (!workspace || !project || !association) return [];

    const matchRank = normalizedQuery ? getMatchRank(thread.title, normalizedQuery) : 0;
    if (matchRank === null) return [];

    return [
      {
        entry: {
          thread,
          workspaceName: workspace.name,
          projectName: association.alias ?? project.name,
        },
        matchRank,
      },
    ];
  });

  entries.sort(
    (left, right) =>
      left.matchRank - right.matchRank ||
      getActivityTime(right.entry.thread) - getActivityTime(left.entry.thread),
  );

  const results = entries.map(({ entry }) => entry);
  return normalizedQuery ? results : results.slice(0, 20);
}
