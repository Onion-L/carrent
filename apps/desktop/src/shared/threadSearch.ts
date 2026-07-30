import type { AppThreadRecord } from "./workspacePersistence";

export type ThreadSearchEntry = {
  thread: AppThreadRecord;
  workspaceName: string;
  projectName: string;
};
