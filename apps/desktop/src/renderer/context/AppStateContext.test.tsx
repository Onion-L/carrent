import { afterEach, describe, expect, it } from "bun:test";

import "../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { AppStateSnapshot } from "../../shared/workspacePersistence";
import { AppStateProvider, useAppState } from "./AppStateContext";

const baseSnapshot: AppStateSnapshot = {
  version: 1,
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
      title: "First",
      createdAt: "2026-07-29T12:00:00.000Z",
      lastActivityAt: "2026-07-29T12:00:00.000Z",
      runtimeId: "kimi",
      runtimeMode: "approval-required",
      planMode: false,
    },
  ],
  threadDrafts: [],
  threadMessages: [],
  threadRuns: [],
  threadPromotionIntents: [],
  threadWork: {},
  lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
  activeWorkspaceId: "workspace-1",
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let contextValue: ReturnType<typeof useAppState> | null = null;
let savedSnapshot: AppStateSnapshot | null = null;

function Probe() {
  contextValue = useAppState();
  return null;
}

async function renderProvider(snapshot: AppStateSnapshot) {
  savedSnapshot = null;
  contextValue = null;
  window.carrent = {
    appState: {
      load: async () => ({ status: "ready", snapshot }),
      reread: async () => ({ status: "ready", snapshot }),
      stage: () => {},
      save: async (next: AppStateSnapshot) => {
        savedSnapshot = next;
      },
      fullReset: async () => ({ status: "ready", snapshot }),
      copyDiagnostics: async () => {},
    },
    projectDirectories: { check: async () => ({ available: true }) },
  } as unknown as Window["carrent"];

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AppStateProvider>
        <Probe />
      </AppStateProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  contextValue = null;
  savedSnapshot = null;
});

describe("recordThreadRun", () => {
  it("persists the original user message createdAt so it cannot sort after the assistant placeholder", async () => {
    await renderProvider(baseSnapshot);

    let recorded = false;
    await act(async () => {
      recorded = await contextValue!.recordThreadRun({
        threadId: "thread-1",
        runId: "run-1",
        messageId: "message-1",
        message: "hi",
        attachments: [],
        startedAt: "2026-07-29T12:31:39.718Z",
        messageCreatedAt: "2026-07-29T12:31:39.700Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      });
    });

    expect(recorded).toBe(true);
    expect(savedSnapshot?.threadMessages).toHaveLength(1);
    expect(savedSnapshot?.threadMessages?.[0]?.createdAt).toBe("2026-07-29T12:31:39.700Z");
    expect(savedSnapshot?.threadRuns?.[0]?.startedAt).toBe("2026-07-29T12:31:39.718Z");
  });

  it("falls back to startedAt when the optimistic message has no original createdAt", async () => {
    await renderProvider(baseSnapshot);

    let recorded = false;
    await act(async () => {
      recorded = await contextValue!.recordThreadRun({
        threadId: "thread-1",
        runId: "run-1",
        messageId: "message-1",
        message: "hi",
        attachments: [],
        startedAt: "2026-07-29T12:31:39.718Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      });
    });

    expect(recorded).toBe(true);
    expect(savedSnapshot?.threadMessages?.[0]?.createdAt).toBe("2026-07-29T12:31:39.718Z");
  });
});

describe("prepareThreadDraftPromotion", () => {
  it("persists the optimistic user message createdAt during promotion", async () => {
    await renderProvider({
      ...baseSnapshot,
      threads: [],
      threadDrafts: [
        {
          id: "draft-1",
          threadId: "thread-promoted",
          workspaceId: "workspace-1",
          projectId: "project-1",
          content: "first turn",
          attachedSkillNames: [],
          attachments: [],
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
    });

    await act(async () => {
      await contextValue!.prepareThreadDraftPromotion({
        draftId: "draft-1",
        runId: "run-1",
        messageId: "message-1",
        message: "first turn",
        attachments: [],
        startedAt: "2026-07-29T12:31:39.718Z",
        messageCreatedAt: "2026-07-29T12:31:39.700Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
        title: "First turn",
        draft: { content: "first turn", attachedSkillNames: [], attachments: [] },
      });
    });

    expect(savedSnapshot?.threadMessages?.[0]?.createdAt).toBe("2026-07-29T12:31:39.700Z");
    expect(savedSnapshot?.threadRuns?.[0]?.startedAt).toBe("2026-07-29T12:31:39.718Z");
  });
});
