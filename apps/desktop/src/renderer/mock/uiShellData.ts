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

export const messages: Message[] = [
  {
    id: "m1",
    role: "assistant",
    agentId: "architect",
    content: "我先读取会话启动要求相关的 skill，然后直接回复你。",
    timestamp: "19:42:20",
    duration: "7.3s",
  },
  {
    id: "m2",
    role: "assistant",
    agentId: "architect",
    type: "changed_files",
    timestamp: "19:42:29",
    duration: "9.0s",
    changedFiles: [
      { path: "Sources/App", additions: 1, deletions: 0, isFolder: true },
      { path: "Sources/App/HomeView.swift", additions: 1, deletions: 0, fileType: "swift" },
      { path: "README.md", additions: 14, deletions: 0, fileType: "markdown" },
    ],
  },
  {
    id: "m3",
    role: "user",
    agentId: "frontend",
    content:
      "scan this project and tell me what you think is vulnerable before shipping, respond in Chinese",
    timestamp: "19:47:46",
  },
  {
    id: "m4",
    role: "assistant",
    agentId: "reviewer",
    content: "使用 review skill 做一次发版前审查。重点看安全风险、数据暴露和构建配置。",
    timestamp: "19:47:52",
    duration: "6.2s",
  },
];
