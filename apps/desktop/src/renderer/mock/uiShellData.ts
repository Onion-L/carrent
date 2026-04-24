export type ThreadRecord = {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
  archived?: boolean;
  active?: boolean;
};

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  active?: boolean;
  threads: ThreadRecord[];
};

export const projects: ProjectRecord[] = [
  {
    id: "timbre",
    name: "Timbre",
    path: "/Users/onion/workbench/timbre",
    active: true,
    threads: [],
  },
  {
    id: "carrent",
    name: "Carrent",
    path: "/Users/onion/workbench/carrent",
    threads: [],
  },
];

export const currentProject =
  projects.find((project) => project.active) ?? projects[0];

export const agents = [
  { id: "architect", name: "Architect", runtime: "codex", selected: true },
  { id: "frontend", name: "Frontend", runtime: "codex" },
  { id: "reviewer", name: "Reviewer", runtime: "claude-code" },
];

type ChangedFile = {
  path: string;
  additions: number;
  deletions: number;
  isFolder?: boolean;
  fileType?: "swift" | "markdown" | "other";
};

type MessageBase = {
  id: string;
  role: "user" | "assistant";
  agentId: string;
  timestamp: string;
  duration?: string;
  threadId: string;
};

type TextMessage = MessageBase & {
  type?: "text";
  content: string;
};

type ChangedFilesMessage = Omit<MessageBase, "role"> & {
  role: "assistant";
  type: "changed_files";
  content?: string;
  changedFiles: ChangedFile[];
};

export type Message = TextMessage | ChangedFilesMessage;

export const messages: Message[] = [];
