import type { AppThreadRecord } from "./workspacePersistence";

export type ThreadSearchScope =
  | { kind: "global" }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "association"; workspaceId: string; projectId: string };

export type ThreadSearchEntry = {
  thread: AppThreadRecord;
  workspaceName: string;
  projectName: string;
};
