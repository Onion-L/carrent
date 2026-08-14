import { describe, expect, it } from "bun:test";

import {
  APP_STATE_SNAPSHOT_VERSION,
  normalizeAppStateSnapshot,
  normalizeAppStateSnapshotForMemory,
  normalizeAppStateSnapshotForWrite,
  normalizePersistedAppStateSnapshot,
  normalizeProviderSessionSnapshot,
} from "./workspacePersistence";

describe("normalizeAppStateSnapshot", () => {
  it("round-trips valid Compact history and drops malformed Thread Action records", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Compact history",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:03:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "user",
          content: "Before Compact",
          createdAt: "2026-07-27T08:01:00.000Z",
          attachments: [],
        },
      ],
      threadActions: [
        {
          id: "action-1",
          threadId: "thread-1",
          action: "compact",
          runtimeId: "kimi",
          completedAt: "2026-07-27T08:02:00.000Z",
        },
      ],
      activeWorkspaceId: "workspace-1",
    };

    expect(normalizeAppStateSnapshot(snapshot)).toEqual(snapshot);
    expect(
      normalizeAppStateSnapshot({
        ...snapshot,
        threadActions: [
          ...snapshot.threadActions,
          { ...snapshot.threadActions[0], id: "bad-action", threadId: "other-thread" },
          { ...snapshot.threadActions[0], id: "unknown-action", action: "unknown" },
        ],
      }),
    ).toEqual(snapshot);
  });

  it("round-trips valid per-Workspace last Thread locations", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Navigation",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
      activeWorkspaceId: "workspace-1",
    };

    expect(normalizeAppStateSnapshot(snapshot)).toEqual(snapshot);
    expect(
      normalizeAppStateSnapshot({
        ...snapshot,
        lastThreadIdByWorkspace: { "workspace-1": "missing-thread" },
      }),
    ).toEqual({ ...snapshot, lastThreadIdByWorkspace: {} });
  });

  it("drops unusable persisted Thread navigation recovery state", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Archived",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          archived: true,
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadDrafts: [],
      threadMessages: [],
      threadRuns: [],
      threadPromotionIntents: [],
      activeWorkspaceId: "workspace-1",
    };

    expect(normalizePersistedAppStateSnapshot(snapshot)).toEqual({
      ...snapshot,
      lastThreadIdByWorkspace: {},
    });
    expect(
      normalizePersistedAppStateSnapshot({
        ...snapshot,
        lastThreadIdByWorkspace: { "workspace-1": "thread-1", missing: 42 },
      }),
    ).toEqual({ ...snapshot, lastThreadIdByWorkspace: {} });
    expect(
      normalizePersistedAppStateSnapshot({
        ...snapshot,
        lastThreadIdByWorkspace: "invalid",
      }),
    ).toEqual({ ...snapshot, lastThreadIdByWorkspace: {} });
  });

  it("drops a remembered Thread owned by another Workspace", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
      ],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
        {
          workspaceId: "workspace-2",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-2",
          projectId: "project-1",
          title: "Client Thread",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
      activeWorkspaceId: "workspace-1",
    };

    expect(normalizeAppStateSnapshot(snapshot)).toEqual({
      ...snapshot,
      lastThreadIdByWorkspace: {},
    });
  });

  it("round-trips Projects and Workspace-Project Associations", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
      ],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          alias: "Personal Carrent",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
        {
          workspaceId: "workspace-2",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "codex",
          defaultRuntimeModelId: "gpt-5",
          defaultRuntimeMode: "auto-accept-edits",
        },
      ],
      activeWorkspaceId: "workspace-2",
    };

    expect(normalizeAppStateSnapshot(snapshot)).toEqual({
      ...snapshot,
      associations: [
        snapshot.associations[0],
        {
          workspaceId: "workspace-2",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "auto-accept-edits",
        },
      ],
    });
  });

  it("rejects duplicate Project directories and broken Association references", () => {
    const base = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      activeWorkspaceId: "workspace-1",
    };

    expect(
      normalizeAppStateSnapshot({
        ...base,
        projects: [
          ...base.projects,
          { id: "project-2", name: "Duplicate", workingDirectory: "/code/other/../carrent/" },
        ],
      }),
    ).toBe(null);
    expect(
      normalizeAppStateSnapshot({
        ...base,
        associations: [{ ...base.associations[0], projectId: "missing-project" }],
      }),
    ).toBe(null);
    expect(normalizeAppStateSnapshot({ ...base, associations: [] })).toBe(null);
  });

  it("treats Windows Project Working Directory identity as case-insensitive", () => {
    expect(
      normalizeAppStateSnapshot({
        version: APP_STATE_SNAPSHOT_VERSION,
        workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
        projects: [
          { id: "project-1", name: "One", workingDirectory: "C:/Code/Carrent" },
          { id: "project-2", name: "Two", workingDirectory: "c:/code/carrent" },
        ],
        associations: [
          {
            workspaceId: "workspace-1",
            projectId: "project-1",
            order: 0,
            defaultRuntimeId: "kimi",
            defaultRuntimeMode: "approval-required",
          },
          {
            workspaceId: "workspace-1",
            projectId: "project-2",
            order: 1,
            defaultRuntimeId: "kimi",
            defaultRuntimeMode: "approval-required",
          },
        ],
        activeWorkspaceId: "workspace-1",
      }),
    ).toBe(null);
  });

  it("round-trips Association Drafts, fixed Thread ownership, messages, and Run config", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeModelId: "kimi-k2.5",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Implement draft promotion",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          archived: true,
          runtimeId: "kimi",
          runtimeModelId: "kimi-k2.5",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadDrafts: [
        {
          id: "draft-2",
          threadId: "thread-2",
          workspaceId: "workspace-1",
          projectId: "project-1",
          content: "Unsent request",
          attachedSkillNames: ["tdd"],
          attachments: [],
          runtimeId: "codex",
          runtimeModelId: "gpt-5",
          runtimeMode: "full-access",
          planMode: true,
        },
      ],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "user",
          content: "Implement draft promotion",
          createdAt: "2026-07-27T08:00:00.000Z",
          attachments: [],
        },
      ],
      threadRuns: [
        {
          id: "run-1",
          threadId: "thread-1",
          messageId: "message-1",
          startedAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeModelId: "kimi-k2.5",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      activeWorkspaceId: "workspace-1",
    };

    expect(normalizeAppStateSnapshot(snapshot)).toEqual({
      ...snapshot,
      threadDrafts: [
        {
          id: "draft-2",
          threadId: "thread-2",
          workspaceId: "workspace-1",
          projectId: "project-1",
          content: "Unsent request",
          attachedSkillNames: ["tdd"],
          attachments: [],
          runtimeId: "kimi",
          runtimeMode: "full-access",
          planMode: true,
        },
      ],
    });
  });

  it("clears legacy runtime models when migrating Thread Runs", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Legacy run",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "user",
          content: "Legacy run",
          createdAt: "2026-07-27T08:00:00.000Z",
          attachments: [],
        },
      ],
      threadRuns: [
        {
          id: "run-1",
          threadId: "thread-1",
          messageId: "message-1",
          startedAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "codex",
          runtimeModelId: "gpt-5",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      activeWorkspaceId: "workspace-1",
    };

    expect(normalizeAppStateSnapshot(snapshot)?.threadRuns).toEqual([
      {
        id: "run-1",
        threadId: "thread-1",
        messageId: "message-1",
        startedAt: "2026-07-27T08:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ]);
  });

  it("round-trips complete Thread content in App State", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Persist complete content",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:01:00.000Z",
          pinned: true,
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
          runChecklist: {
            runId: "run-1",
            runtimeId: "kimi",
            entries: [{ content: "Persist content", status: "in_progress" }],
            outcome: "running",
            expanded: true,
          },
        },
      ],
      threadDrafts: [],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "assistant",
          content: "Working",
          createdAt: "2026-07-27T08:01:00.000Z",
          timestamp: "16:01",
          runStatus: "running",
          parts: [
            {
              type: "reasoning",
              id: "reasoning-1",
              content: "Inspecting state",
              status: "running",
            },
            {
              type: "kimi_timeline",
              item: {
                type: "thinking",
                id: "kimi-run-1-thinking-1",
                order: 0,
                content: "Inspecting state",
                status: "cancelled",
              },
            },
            {
              type: "kimi_timeline",
              item: {
                type: "tool",
                id: "kimi-run-1-tool-item-0",
                order: 1,
                toolCallId: "tool-read",
                title: "Read",
                kind: "read",
                command: "",
                filePath: "src/a.ts",
                input: "",
                output: "file contents",
                error: "",
                status: "cancelled",
              },
            },
            {
              type: "kimi_timeline",
              item: {
                type: "message",
                id: "kimi-run-1-message-1",
                order: 2,
                content: "Working",
                isFinal: false,
              },
            },
          ],
          attachments: [],
        },
      ],
      threadRuns: [],
      threadPromotionIntents: [],
      threadWork: {
        "thread-1": {
          draft: {
            content: "Follow up",
            composerState: '{"root":{"type":"root"}}',
            attachedSkillNames: [],
            attachments: [],
          },
          queuedMessages: [{ id: "queued-1", content: "Next request", requiresConfirmation: true }],
        },
      },
      lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
      activeWorkspaceId: "workspace-1",
    };

    expect(normalizeAppStateSnapshot(snapshot)).toEqual(snapshot);
  });

  it("rejects an App State snapshot when any Thread content entry is invalid", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Validate content",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadDrafts: [],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "assistant",
          content: "Working",
          createdAt: "2026-07-27T08:00:00.000Z",
          attachments: [],
          parts: [{ type: "text", content: "Working" }],
        },
      ],
      threadRuns: [],
      threadPromotionIntents: [],
      threadWork: {
        "thread-1": {
          draft: { content: "Follow up", attachedSkillNames: [], attachments: [] },
          queuedMessages: [{ id: "queue-1", content: "Continue" }],
        },
      },
      activeWorkspaceId: "workspace-1",
    };

    expect(
      normalizeAppStateSnapshot({
        ...snapshot,
        threadWork: { "thread-1": { draft: { content: 42 }, queuedMessages: [] } },
      }),
    ).toBe(null);
    expect(
      normalizeAppStateSnapshot({
        ...snapshot,
        threadWork: { "thread-1": { queuedMessages: [{ id: "queue-1" }] } },
      }),
    ).toBe(null);
    expect(
      normalizeAppStateSnapshot({
        ...snapshot,
        threadMessages: [{ ...snapshot.threadMessages[0], parts: [{ type: "unknown" }] }],
      }),
    ).toBe(null);
    expect(
      normalizeAppStateSnapshot({
        ...snapshot,
        threadMessages: [{ ...snapshot.threadMessages[0], parts: [{ type: "text", content: 42 }] }],
      }),
    ).toBe(null);
  });

  it("round-trips a pending promotion intent without creating a Thread", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [],
      threadDrafts: [
        {
          id: "draft-1",
          threadId: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          content: "Pending request",
          attachedSkillNames: [],
          attachments: [],
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadMessages: [],
      threadRuns: [],
      threadPromotionIntents: [
        {
          draftId: "draft-1",
          threadId: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Pending request",
          runId: "run-1",
          messageId: "message-1",
          message: "Pending request",
          attachments: [],
          startedAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      activeWorkspaceId: "workspace-1",
    };

    expect(normalizeAppStateSnapshot(snapshot)).toEqual(snapshot);
    expect(normalizeAppStateSnapshot({ ...snapshot, threadDrafts: [] })).toBe(null);
  });

  it("rejects Draft and Thread records outside an existing Association", () => {
    const base = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      activeWorkspaceId: "workspace-1",
    };
    const draft = {
      id: "draft-1",
      threadId: "thread-1",
      workspaceId: "workspace-1",
      projectId: "project-missing",
      content: "Unsent",
      attachedSkillNames: [],
      attachments: [],
      runtimeId: "kimi",
      runtimeMode: "approval-required",
      planMode: false,
    };
    const thread = {
      id: "thread-1",
      workspaceId: "workspace-1",
      projectId: "project-missing",
      title: "Missing parent",
      createdAt: "2026-07-27T08:00:00.000Z",
      lastActivityAt: "2026-07-27T08:00:00.000Z",
      runtimeId: "kimi",
      runtimeMode: "approval-required",
      planMode: false,
    };

    expect(normalizeAppStateSnapshot({ ...base, threadDrafts: [draft] })).toBe(null);
    expect(normalizeAppStateSnapshot({ ...base, threads: [thread] })).toBe(null);
  });

  it("rejects more than one Draft per Association and invalid Run references", () => {
    const base = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      activeWorkspaceId: "workspace-1",
    };
    const draft = {
      id: "draft-1",
      threadId: "thread-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      content: "Unsent",
      attachedSkillNames: [],
      attachments: [],
      runtimeId: "kimi",
      runtimeMode: "approval-required",
      planMode: false,
    };

    expect(
      normalizeAppStateSnapshot({
        ...base,
        threadDrafts: [draft, { ...draft, id: "draft-2", threadId: "thread-2" }],
      }),
    ).toBe(null);
    expect(
      normalizeAppStateSnapshot({
        ...base,
        threadRuns: [
          {
            id: "run-1",
            threadId: "thread-missing",
            messageId: "message-missing",
            startedAt: "2026-07-27T08:00:00.000Z",
            runtimeId: "kimi",
            runtimeMode: "approval-required",
            planMode: false,
          },
        ],
      }),
    ).toBe(null);
  });

  it("rejects parseable dates that are not persisted ISO timestamps", () => {
    expect(
      normalizeAppStateSnapshot({
        version: APP_STATE_SNAPSHOT_VERSION,
        workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
        projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
        associations: [
          {
            workspaceId: "workspace-1",
            projectId: "project-1",
            order: 0,
            defaultRuntimeId: "kimi",
            defaultRuntimeMode: "approval-required",
          },
        ],
        threads: [
          {
            id: "thread-1",
            workspaceId: "workspace-1",
            projectId: "project-1",
            title: "Thread",
            createdAt: "July 27, 2026",
            lastActivityAt: "2026-07-27T08:00:00.000Z",
            runtimeId: "kimi",
            runtimeMode: "approval-required",
            planMode: false,
          },
        ],
        activeWorkspaceId: "workspace-1",
      }),
    ).toBe(null);
  });

  it("persists a thread's customTitle flag and rejects non-boolean values", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "New thread",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          customTitle: true,
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadDrafts: [],
      threadMessages: [],
      threadRuns: [],
      threadPromotionIntents: [],
      activeWorkspaceId: "workspace-1",
    };

    const normalized = normalizeAppStateSnapshot(snapshot);
    expect(normalized?.threads?.[0]?.customTitle).toBe(true);
    expect(
      normalizeAppStateSnapshot({
        ...snapshot,
        threads: [{ ...snapshot.threads[0], customTitle: "yes" }],
      }),
    ).toBe(null);
  });

  it("rejects persisted App State attachments without an explicit kind", () => {
    const snapshot = {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Attachment schema",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadDrafts: [],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "user",
          content: "Inspect this image",
          createdAt: "2026-07-27T08:00:00.000Z",
          attachments: [
            {
              id: "attachment-1",
              name: "screen.png",
              mimeType: "image/png",
              size: 10,
              storageKey: "attachment-1.png",
            },
          ],
        },
      ],
      threadRuns: [],
      threadPromotionIntents: [],
      lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
      activeWorkspaceId: "workspace-1",
    };

    expect(normalizePersistedAppStateSnapshot(snapshot)).toBe(null);
  });
});

describe("queued message requiresConfirmation stamping", () => {
  function snapshotWithQueuedMessage(requiresConfirmation: boolean | undefined) {
    return {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Tidy the docs",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActivityAt: "2026-01-01T00:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadDrafts: [],
      threadMessages: [],
      threadRuns: [],
      threadActions: [],
      threadPromotionIntents: [],
      threadWork: {
        "thread-1": {
          queuedMessages: [
            {
              id: "queued-1",
              content: "Next request",
              ...(requiresConfirmation === undefined ? {} : { requiresConfirmation }),
            },
          ],
        },
      },
      lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
      activeWorkspaceId: "workspace-1",
    };
  }

  it("force-stamps requiresConfirmation: true when loading from disk", () => {
    const normalized = normalizeAppStateSnapshot(snapshotWithQueuedMessage(undefined))!;
    expect(normalized.threadWork!["thread-1"].queuedMessages[0].requiresConfirmation).toBe(true);
  });

  it("force-stamps requiresConfirmation: true when persisting to disk", () => {
    // Even a live auto-continuing item (flag false) is stamped on disk so a
    // restarted application never auto-sends recovered queue items.
    const normalized = normalizeAppStateSnapshotForWrite(snapshotWithQueuedMessage(false))!;
    expect(normalized.threadWork!["thread-1"].queuedMessages[0].requiresConfirmation).toBe(true);
  });

  it("preserves the live requiresConfirmation flag in the in-memory authority", () => {
    // A freshly-enqueued, steerable item keeps flag false so the Main Process
    // can tell auto-continuing work from work needing an explicit Send/Steer.
    const auto = normalizeAppStateSnapshotForMemory(snapshotWithQueuedMessage(false))!;
    expect(auto.threadWork!["thread-1"].queuedMessages[0].requiresConfirmation).toBeUndefined();

    const confirmed = normalizeAppStateSnapshotForMemory(snapshotWithQueuedMessage(true))!;
    expect(confirmed.threadWork!["thread-1"].queuedMessages[0].requiresConfirmation).toBe(true);
  });
});

describe("normalizeProviderSessionSnapshot", () => {
  it("preserves an invalid mapping marker for isolated Run-time recovery", () => {
    expect(
      normalizeProviderSessionSnapshot({
        version: 1,
        sessions: { "kimi:thread-1": { unexpected: true } },
      }),
    ).toEqual({ version: 1, sessions: { "kimi:thread-1": "" } });
  });
});

describe("Local Path Context persistence", () => {
  // Edge-case paths already in normalized form (absolute, forward slashes,
  // explicit basename) so the round-trip assertion can compare verbatim.
  const fileContext = {
    path: "/Users/onion/My Notes (draft) [v2].md",
    basename: "My Notes (draft) [v2].md",
    kind: "file",
  };
  const folderContext = {
    path: "/Users/onion/项目 文件",
    basename: "项目 文件",
    kind: "directory",
  };
  const longFileContext = {
    path: "/tmp/a b/c[d].ts",
    basename: "c[d].ts",
    kind: "file",
  };
  const orderedContexts = [fileContext, folderContext, longFileContext];

  function baseSnapshot() {
    return {
      version: APP_STATE_SNAPSHOT_VERSION,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Local Path Context",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      activeWorkspaceId: "workspace-1",
    };
  }

  it("round-trips Local Path Context on drafts, messages, intents, and Thread Work with order and exact text", () => {
    const snapshot = {
      ...baseSnapshot(),
      threadDrafts: [
        {
          id: "draft-1",
          threadId: "thread-2",
          workspaceId: "workspace-1",
          projectId: "project-1",
          content: "Draft",
          attachedSkillNames: [],
          attachments: [],
          localPathContexts: orderedContexts,
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "user",
          content: "Read these",
          createdAt: "2026-07-27T08:01:00.000Z",
          attachments: [],
          localPathContexts: orderedContexts,
        },
      ],
      threadRuns: [],
      threadPromotionIntents: [
        {
          draftId: "draft-1",
          threadId: "thread-2",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Local Path Context",
          runId: "run-1",
          messageId: "message-2",
          message: "Draft",
          attachments: [],
          localPathContexts: [folderContext],
          startedAt: "2026-07-27T08:02:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadWork: {
        "thread-1": {
          draft: {
            content: "Follow up",
            composerState: '{"root":{"type":"root"}}',
            attachedSkillNames: [],
            attachments: [],
            localPathContexts: [fileContext, folderContext],
          },
          queuedMessages: [
            {
              id: "queued-1",
              content: "Next request",
              localPathContexts: [longFileContext],
              requiresConfirmation: true,
            },
          ],
        },
      },
      lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
    };

    const normalized = normalizeAppStateSnapshot(snapshot)!;
    expect(normalized).toEqual(snapshot);
    // Order and exact text are preserved through every carrier.
    expect(normalized.threadDrafts![0].localPathContexts).toEqual(orderedContexts);
    expect(normalized.threadMessages![0].localPathContexts).toEqual(orderedContexts);
    expect(normalized.threadPromotionIntents![0].localPathContexts).toEqual([folderContext]);
    expect(normalized.threadWork!["thread-1"].draft!.localPathContexts).toEqual([
      fileContext,
      folderContext,
    ]);
    expect(normalized.threadWork!["thread-1"].queuedMessages[0].localPathContexts).toEqual([
      longFileContext,
    ]);
  });

  it("loads an old snapshot without Local Path Context unchanged (no destructive migration)", () => {
    const legacy = {
      ...baseSnapshot(),
      threadDrafts: [],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "user",
          content: "No contexts",
          createdAt: "2026-07-27T08:01:00.000Z",
          attachments: [],
        },
      ],
      threadRuns: [],
      threadPromotionIntents: [],
      threadWork: {
        "thread-1": {
          draft: { content: "Follow up", attachedSkillNames: [], attachments: [] },
          queuedMessages: [{ id: "q-1", content: "Continue", requiresConfirmation: true }],
        },
      },
    };

    const normalized = normalizeAppStateSnapshot(legacy)!;
    expect(normalized).toEqual(legacy);
    expect(normalized.threadMessages![0].localPathContexts).toBeUndefined();
    expect(normalized.threadWork!["thread-1"].draft!.localPathContexts).toBeUndefined();
    expect(normalized.threadWork!["thread-1"].queuedMessages[0].localPathContexts).toBeUndefined();
  });

  it("drops malformed Local Path Context items instead of rejecting the snapshot", () => {
    const snapshot = {
      ...baseSnapshot(),
      threadDrafts: [],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "user",
          content: "Mixed",
          createdAt: "2026-07-27T08:01:00.000Z",
          attachments: [],
          localPathContexts: [
            fileContext,
            { path: "relative/path", kind: "file" }, // relative -> dropped
            { path: "/a/unknown-kind", kind: "folder" }, // bad kind -> dropped
            folderContext,
          ],
        },
      ],
      threadRuns: [],
      threadPromotionIntents: [],
      threadWork: {
        "thread-1": {
          draft: {
            content: "Follow up",
            attachedSkillNames: [],
            attachments: [],
            localPathContexts: [{ path: "/keep", kind: "file" }, "nope", 7],
          },
          queuedMessages: [],
        },
      },
    };

    const normalized = normalizeAppStateSnapshot(snapshot)!;
    expect(normalized).not.toBe(null);
    expect(normalized.threadMessages![0].localPathContexts).toEqual([fileContext, folderContext]);
    expect(normalized.threadWork!["thread-1"].draft!.localPathContexts).toEqual([
      { path: "/keep", basename: "keep", kind: "file" },
    ]);
  });
});
