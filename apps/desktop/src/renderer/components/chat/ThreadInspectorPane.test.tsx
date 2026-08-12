import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { Message, SubagentTaskPart } from "../../../shared/threadContent";
import {
  ThreadInspectorContent,
  ThreadInspectorToggle,
  collectSubagentTasks,
  formatSubagentTaskDuration,
  getChangedFilesTotals,
  selectLatestChangedFilesMessage,
  sortSubagentTasks,
} from "./ThreadInspectorPane";

function makeTask(overrides: Partial<SubagentTaskPart> = {}): SubagentTaskPart {
  return {
    type: "subagent_task",
    id: "task-1",
    runtimeId: "kimi",
    source: "agent",
    description: "Implement persistence",
    background: false,
    status: "running",
    startedAt: 1_000,
    ...overrides,
  };
}

function makeAssistantMessage(parts: SubagentTaskPart[]): Message {
  return {
    id: "assistant-1",
    role: "assistant",
    threadId: "thread-1",
    timestamp: "09:00",
    content: "",
    parts,
  };
}

function renderContent(props: Partial<Parameters<typeof ThreadInspectorContent>[0]> = {}): string {
  return renderToStaticMarkup(
    <ThreadInspectorContent
      messages={[]}
      branch={null}
      selectedTaskId={null}
      onSelectTask={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("subagent task selectors", () => {
  it("collects tasks from assistant messages only", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        threadId: "thread-1",
        timestamp: "09:00",
        content: "hi",
        parts: [makeTask({ id: "task-user" })],
      },
      makeAssistantMessage([makeTask({ id: "task-assistant" })]),
    ];

    expect(collectSubagentTasks(messages).map((task) => task.id)).toEqual(["task-assistant"]);
  });

  it("sorts active and settled tasks newest first", () => {
    const { active, settled } = sortSubagentTasks([
      makeTask({ id: "old-running", status: "running", startedAt: 1_000 }),
      makeTask({ id: "new-completed", status: "completed", startedAt: 3_000, finishedAt: 4_000 }),
      makeTask({ id: "new-running", status: "running", startedAt: 5_000 }),
      makeTask({ id: "old-failed", status: "failed", startedAt: 2_000, finishedAt: 2_500 }),
    ]);

    expect(active.map((task) => task.id)).toEqual(["new-running", "old-running"]);
    expect(settled.map((task) => task.id)).toEqual(["new-completed", "old-failed"]);
  });

  it("selects the latest valid changed_files message", () => {
    const older = {
      id: "changes-1",
      role: "assistant" as const,
      threadId: "thread-1",
      timestamp: "09:00",
      type: "changed_files" as const,
      changedFiles: [{ path: "a.ts", additions: 1, deletions: 2, binary: false, untracked: false }],
    };
    const latest = {
      ...older,
      id: "changes-2",
      changedFiles: [
        { path: "b.ts", additions: 3, deletions: 4, binary: false, untracked: false },
        {
          path: "src",
          additions: 0,
          deletions: 0,
          binary: false,
          untracked: false,
          isFolder: true,
        },
      ],
    };

    const selected = selectLatestChangedFilesMessage([older, makeAssistantMessage([]), latest]);
    expect(selected?.id).toBe("changes-2");
    expect(getChangedFilesTotals(selected)).toEqual({
      fileCount: 1,
      additions: 3,
      deletions: 4,
    });
    expect(selectLatestChangedFilesMessage([makeAssistantMessage([])])).toBe(null);
  });

  it("formats durations from task timestamps without per-row timers", () => {
    expect(formatSubagentTaskDuration(makeTask({ startedAt: 1_000, finishedAt: 35_000 }))).toBe(
      "34s",
    );
    expect(formatSubagentTaskDuration(makeTask({ startedAt: 0, finishedAt: 72_000 }))).toBe(
      "1m 12s",
    );
    expect(formatSubagentTaskDuration(makeTask({ startedAt: 0 }), 10_000)).toBe("10s");
  });
});

describe("ThreadInspectorContent", () => {
  const changesMessage = {
    id: "changes-1",
    role: "assistant" as const,
    threadId: "thread-1",
    timestamp: "09:00",
    type: "changed_files" as const,
    changedFiles: [
      { path: "a.ts", additions: 5, deletions: 2, binary: false, untracked: false },
      { path: "b.ts", additions: 3, deletions: 1, binary: false, untracked: false },
    ],
    snapshot: {
      baseRevision: "abcdef1234567890",
      capturedAt: "2026-07-23T00:00:00.000Z",
      patch: "diff",
      truncated: false,
    },
  };

  it("renders the floating card titlebar toggle", () => {
    const html = renderToStaticMarkup(<ThreadInspectorToggle open={false} onToggle={() => {}} />);

    expect(html).toContain('aria-label="Toggle thread tools card"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('title="Environment and subagents"');
    expect(html).toContain("lucide-sliders-horizontal");

    const open = renderToStaticMarkup(<ThreadInspectorToggle open={true} onToggle={() => {}} />);
    expect(open).toContain('aria-pressed="true"');
  });

  it("renders the project Environment with branch and change totals", () => {
    const html = renderContent({
      messages: [changesMessage],
      projectPath: "/tmp/project",
      branch: "main",
      onOpenDiff: () => {},
    });

    expect(html).toContain("Environment");
    expect(html).toContain("lucide-file-diff");
    expect(html).toContain("lucide-laptop");
    expect(html).toContain("lucide-git-branch");
    expect(html).toContain("2 files");
    expect(html).toContain("+8");
    expect(html).toContain("-3");
    expect(html).toContain("Local");
    expect(html).toContain("main");
    // The Environment summary uses the shared Card.
    expect(html).toContain("rounded-lg border border-border bg-surface");
  });

  it("omits the Environment section for general Chats", () => {
    const html = renderContent({
      messages: [changesMessage, makeAssistantMessage([makeTask()])],
      branch: null,
    });

    expect(html).not.toContain("Environment");
    expect(html).not.toContain("Branch");
    expect(html).toContain(">Subagents</h2>");
  });

  it("renders a floating rounded card with the Subagents title, icon, and counts", () => {
    const html = renderContent({
      messages: [makeAssistantMessage([makeTask()])],
    });

    expect(html).toContain(">Subagents</h2>");
    expect(html).toContain("lucide-bot");
    expect(html).toContain("1 active · 0 settled");
    expect(html).toContain("max-h-full");
    expect(html).toContain("rounded-lg");
    expect(html).toContain("border border-border bg-surface");
    expect(html).toContain("shadow-[0_12px_40px_rgb(0_0_0/0.18)]");
    // Overlay positioning belongs to the route wrapper, not the card.
    expect(html).not.toContain("absolute");
    expect(html).not.toContain("border-l");
  });

  it("renders a close button in the card header", () => {
    const html = renderContent({ messages: [] });
    expect(html).toContain('aria-label="Close thread inspector"');
    expect(html).toContain('title="Close"');
    expect(html).toContain("lucide-x");
  });

  it("keeps navigation and close actions in the detail header", () => {
    const html = renderContent({
      messages: [
        makeAssistantMessage([makeTask({ id: "detail", status: "completed", finishedAt: 2_000 })]),
      ],
      selectedTaskId: "detail",
    });

    expect(html).toContain('aria-label="Back to subagents"');
    expect(html).toContain('aria-label="Close thread inspector"');
  });

  it("renders status cues for running, completed, failed, interrupted, and detached", () => {
    const html = renderContent({
      messages: [
        makeAssistantMessage([
          makeTask({ id: "t-running", status: "running", description: "Running task" }),
          makeTask({ id: "t-completed", status: "completed", description: "Completed task" }),
          makeTask({ id: "t-failed", status: "failed", description: "Failed task" }),
          makeTask({
            id: "t-interrupted",
            status: "interrupted",
            description: "Interrupted task",
          }),
          makeTask({ id: "t-detached", status: "detached", description: "Detached task" }),
        ]),
      ],
    });

    expect(html).toContain('aria-label="Running: Running task"');
    expect(html).toContain('aria-label="Completed: Completed task"');
    expect(html).toContain('aria-label="Failed: Failed task"');
    expect(html).toContain('aria-label="Interrupted: Interrupted task"');
    expect(html).toContain('aria-label="Detached: Detached task"');
    expect(html).toContain("Running");
    expect(html).toContain("Recent");
    expect(html).toContain("1 active · 4 settled");
    // Green only for completed, red only for failed.
    expect(html.match(/text-success/g)?.length).toBe(1);
    expect(html.match(/text-danger/g)?.length).toBe(1);
  });

  it("orders active and settled rows newest first and shows counts", () => {
    const html = renderContent({
      messages: [
        makeAssistantMessage([
          makeTask({ id: "old", status: "running", startedAt: 1_000, description: "Old run" }),
          makeTask({ id: "new", status: "running", startedAt: 9_000, description: "New run" }),
          makeTask({
            id: "done",
            status: "completed",
            startedAt: 5_000,
            finishedAt: 6_000,
            description: "Done task",
          }),
        ]),
      ],
    });

    expect(html).toContain("2 active · 1 settled");
    expect(html.indexOf("New run")).toBeLessThan(html.indexOf("Old run"));
  });

  it("truncates long descriptions and agent types without changing row markup", () => {
    const html = renderContent({
      messages: [
        makeAssistantMessage([
          makeTask({
            id: "long",
            description: "A very long delegated task description that must truncate",
            agentType: "a-very-long-agent-type-name",
          }),
        ]),
      ],
    });

    expect(html).toContain("truncate");
    expect(html).toContain("max-w-20");
  });

  it("renders the detail view with Prompt and Result", () => {
    const html = renderContent({
      messages: [
        makeAssistantMessage([
          makeTask({
            id: "detail",
            status: "completed",
            agentType: "coder",
            runtimeAgentId: "agent-0",
            prompt: "Implement step 1 and report the result",
            summary: "Implemented persistence and tests.",
            finishedAt: 61_000,
          }),
        ]),
      ],
      selectedTaskId: "detail",
    });

    expect(html).toContain('aria-label="Back to subagents"');
    expect(html).toContain("Implement persistence");
    expect(html).toContain("Completed");
    expect(html).toContain("coder");
    expect(html).toContain("agent-0");
    expect(html).toContain("1m");
    expect(html).toContain("PROMPT");
    expect(html).toContain("Implement step 1 and report the result");
    expect(html).toContain("RESULT");
    expect(html).toContain("Implemented persistence and tests.");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("break-words");
  });

  it("renders no raw ACP keys or Kimi storage paths", () => {
    const html = renderContent({
      messages: [makeAssistantMessage([makeTask({ status: "completed", summary: "Done." })])],
      projectPath: "/tmp/project",
      branch: "main",
      onOpenDiff: () => {},
    });

    expect(html).not.toContain("rawInput");
    expect(html).not.toContain("rawOutput");
    expect(html).not.toContain(".kimi-code");
    expect(html).not.toContain("toolCallId");
  });

  it("enables the Changes row only when a Diff snapshot is available", () => {
    const withDiff = renderContent({
      messages: [changesMessage],
      projectPath: "/tmp/project",
      branch: "main",
      onOpenDiff: () => {},
    });
    expect(withDiff.match(/<button/gu)).toHaveLength(2);

    const { snapshot: _snapshot, ...legacyMessage } = changesMessage;
    const withoutDiff = renderContent({
      messages: [legacyMessage],
      projectPath: "/tmp/project",
      branch: "main",
      onOpenDiff: () => {},
    });
    expect(withoutDiff).toContain('aria-disabled="true"');
    expect(withoutDiff.match(/<button/gu)).toHaveLength(1);

    const noChanges = renderContent({
      messages: [],
      projectPath: "/tmp/project",
      branch: null,
    });
    expect(noChanges).toContain("0 files");
    expect(noChanges).toContain("—");
  });

  it("shows the concise empty state", () => {
    const html = renderContent({ messages: [] });
    expect(html).toContain("No subagents");
    expect(html).not.toContain("Running");
    expect(html).not.toContain("Recent");
  });
});
