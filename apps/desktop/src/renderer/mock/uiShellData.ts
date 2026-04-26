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
    id: "project-1",
    name: "Carrent",
    path: "/Users/onion/workbench/carrent",
    active: true,
    threads: [
      {
        id: "thread-1",
        title: "Shared workspace thread state",
        updatedAt: "now",
        active: true,
      },
    ],
  },
];

export const initialActiveThreadId =
  projects.flatMap((project) => project.threads).find((thread) => thread.active)?.id ?? null;

// Seed-only fallback for screens that still read directly from mock data.
export const currentProject = projects.find((project) => project.active) ?? projects[0];

export type AgentRecord = {
  id: string;
  name: string;
  runtime: "codex" | "claude-code" | "pi";
  responsibility: string;
  description?: string;
  avatar?: string;
  selected?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export const agents: AgentRecord[] = [
  {
    id: "architect",
    name: "Architect",
    runtime: "codex",
    selected: true,
    responsibility:
      "You are a senior software architect. Focus on system design, API contracts, data models, and technical decisions. Provide high-level architecture recommendations and identify trade-offs.",
  },
  {
    id: "frontend",
    name: "Frontend",
    runtime: "codex",
    responsibility:
      "You are a senior frontend engineer. Focus on React components, CSS, accessibility, performance, and user experience. Write clean, maintainable UI code with modern best practices.",
  },
  {
    id: "reviewer",
    name: "Reviewer",
    runtime: "claude-code",
    responsibility:
      "You are a meticulous code reviewer. Analyze code for bugs, security issues, performance bottlenecks, and style violations. Suggest concrete improvements with explanations.",
  },
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

export type MessagePart =
  | { type: "text"; content: string }
  | {
      type: "reasoning";
      id: string;
      content: string;
      status: "running" | "completed";
    }
  | {
      type: "shell";
      id: string;
      command: string;
      output: string;
      status: "running" | "completed" | "failed";
      exitCode?: number | null;
    };

type TextMessage = MessageBase & {
  type?: "text";
  content: string;
  parts?: MessagePart[];
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
    content:
      "The hero is clear, but the comparison section needs stronger grouping and less repeated copy.",
  },
  {
    id: "message-carrent-1",
    role: "user",
    agentId: "architect",
    timestamp: "11:02",
    threadId: "thread-1",
    content: "Make sidebar thread state drive the main chat area instead of static mock data.",
  },
  {
    id: "message-carrent-2",
    role: "assistant",
    agentId: "frontend",
    timestamp: "11:05",
    duration: "1m 12s",
    threadId: "thread-1",
    content:
      "Use one renderer workspace context for projects, messages, and activeThreadId. Keep mutations inside the provider.",
  },
];
