export const currentProject = {
  id: "timbre",
  name: "Timbre",
  path: "/Users/onion/workbench/timbre",
};

export const agents = [
  { id: "architect", name: "Architect", runtime: "codex", selected: true },
  { id: "frontend", name: "Frontend", runtime: "codex" },
  { id: "reviewer", name: "Reviewer", runtime: "claude-code" },
];

export const threads = [
  { id: "thread-1", title: "Project onboarding", updatedAt: "2m ago", active: true },
  { id: "thread-2", title: "Refactor entry flow", updatedAt: "1h ago" },
];

export const messages = [
  { id: "m1", role: "user" as const, agentId: "architect", content: "先帮我梳理这个项目" },
  { id: "m2", role: "assistant" as const, agentId: "architect", content: "这是一个本地 agent chat workspace，支持多个 runtime 和 agent 协作。你可以在这里创建 thread，分配不同 agent 处理不同任务。" },
  { id: "m3", role: "user" as const, agentId: "frontend", content: "切到 frontend 视角看一下 UI 壳" },
];

export const runtimes = [
  { id: "codex", name: "Codex CLI", status: "detected" as const, version: "local", path: "/usr/local/bin/codex" },
  { id: "claude-code", name: "Claude Code", status: "unavailable" as const, version: "unknown", path: "/usr/local/bin/claude" },
];
