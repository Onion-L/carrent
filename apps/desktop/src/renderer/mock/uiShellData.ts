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
    threads: [
      {
        id: "thread-timbre-design-review",
        title: "Landing page design review",
        updatedAt: "12m",
        pinned: true,
      },
      {
        id: "thread-timbre-runtime-audit",
        title: "Runtime audit follow-up",
        updatedAt: "1h",
      },
    ],
  },
  {
    id: "carrent",
    name: "Carrent",
    path: "/Users/onion/workbench/carrent",
    active: true,
    threads: [
      {
        id: "thread-carrent-shared-workspace",
        title: "Shared workspace thread state",
        updatedAt: "now",
        active: true,
      },
    ],
  },
];

export const initialActiveThreadId =
  projects.flatMap((project) => project.threads).find((thread) => thread.active)
    ?.id ?? null;

// Seed-only fallback for screens that still read directly from mock data.
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

export const messages: Message[] = [
  {
    id: "message-timbre-1",
    role: "user",
    agentId: "architect",
    timestamp: "09:10",
    threadId: "thread-timbre-design-review",
    content: "Audit the landing page hierarchy before we ship this week's update.",
  },
  {
    id: "message-timbre-2",
    role: "assistant",
    agentId: "reviewer",
    timestamp: "09:12",
    duration: "34s",
    threadId: "thread-timbre-design-review",
    content: "The hero is clear, but the comparison section needs stronger grouping and less repeated copy.",
  },
  {
    id: "message-carrent-1",
    role: "user",
    agentId: "architect",
    timestamp: "11:02",
    threadId: "thread-carrent-shared-workspace",
    content: "Make sidebar thread state drive the main chat area instead of static mock data.",
  },
  {
    id: "message-carrent-2",
    role: "assistant",
    agentId: "frontend",
    timestamp: "11:05",
    duration: "1m 12s",
    threadId: "thread-carrent-shared-workspace",
    content: "Use one renderer workspace context for projects, messages, and activeThreadId. Keep mutations inside the provider.",
  },
];
