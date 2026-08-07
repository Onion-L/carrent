import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import type { ChatRunEvent } from "../../../shared/chat";
import type { AppStateSnapshot } from "../../../shared/workspacePersistence";
import { createFakeAppStateAuthority } from "../../test/fakeAppStateAuthority";
import { AppStateProvider } from "../../context/AppStateContext";
import { RuntimeModelsProvider } from "../../context/RuntimeModelsContext";
import { ThreadContentProvider, useThreadContent } from "../../context/ThreadContentContext";
import { Composer, type ComposerSubmitRequest } from "./Composer";
import { MessageTimeline, type UserMessageEditDraft } from "./MessageTimeline";
import type { Message } from "../../../shared/threadContent";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function baseSnapshot(): AppStateSnapshot {
  return {
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
        id: "user-1",
        threadId: "thread-1",
        role: "user",
        content: "hello",
        createdAt: "2026-07-27T08:00:01.000Z",
        attachments: [],
      },
      {
        id: "assistant-1",
        threadId: "thread-1",
        role: "assistant",
        content: "old answer",
        createdAt: "2026-07-27T08:00:02.000Z",
        attachments: [],
      },
    ],
    threadRuns: [],
    threadPromotionIntents: [],
    threadWork: {},
    lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
    activeWorkspaceId: "workspace-1",
  };
}

function installCarrentBridge(authority: ReturnType<typeof createFakeAppStateAuthority>) {
  window.carrent = {
    appState: {
      load: async () => ({ status: "ready", snapshot: authority.getState().snapshot }),
      reread: async () => ({ status: "ready", snapshot: authority.getState().snapshot }),
      fullReset: async () => ({ status: "ready", snapshot: authority.getState().snapshot }),
      subscribe: authority.subscribe,
      unsubscribe: authority.unsubscribe,
      command: authority.command,
      onChanged: authority.onChanged,
      onFlushRequest: () => () => {},
      flushDone: async () => {},
    },
    projectDirectories: { check: async () => ({ available: true }) },
    attachments: { read: async () => new Uint8Array([1]) },
    runtimes: {
      list: async () => [
        {
          id: "kimi",
          name: "Kimi Code",
          command: "kimi",
          availability: "detected",
          enabled: true,
          status: "stopped",
          configuration: "configured",
          verification: "never",
          supportsModelPing: false,
        },
      ],
      listModels: async () => ({ state: "listed", models: [] }),
    },
    skills: { list: async () => [] },
    mcpServer: { getStatus: async () => ({ enabled: true, running: true }) },
    git: {
      workspaceSnapshot: async () => ({ state: "ready", baseRevision: "abc" }),
      workspaceDiff: async () => ({ state: "ready", files: [], patch: "" }),
    },
    chat: {
      send: async () => ({ runId: "run-1" }),
      stop: async () => {},
      deleteThreadData: async () => {},
      respondToPermission: async () => {},
      respondToQuestion: async () => {},
      getKimiStatus: async () => null,
      onEvent: (_listener: (event: ChatRunEvent) => void) => () => {},
    },
  } as unknown as Window["carrent"];
}

function EditResendHarness() {
  const { hasHydrated, getThreadRouteData, messages } = useThreadContent();
  const [submitRequest, setSubmitRequest] = React.useState<ComposerSubmitRequest | undefined>();
  const routeData = getThreadRouteData("project-1", "thread-1");
  if (!hasHydrated || !routeData) return null;

  return (
    <>
      <MessageTimeline
        messages={routeData.messages}
        threadId="thread-1"
        onSubmitUserEdit={(draft: UserMessageEditDraft) => {
          setSubmitRequest({
            messageId: draft.messageId,
            content: draft.content,
            attachments: draft.attachments,
            requestId: Date.now(),
          });
        }}
      />
      <Composer
        mode="thread"
        workspaceId="workspace-1"
        projectId="project-1"
        threadId="thread-1"
        messages={routeData.messages}
        runtimeId="kimi"
        runtimeMode="approval-required"
        planMode={false}
        submitRequest={submitRequest}
      />
      <div data-testid="assistant-ids">
        {messages
          .filter((message: Message) => message.role === "assistant")
          .map((message: Message) => message.id)
          .join(",")}
      </div>
    </>
  );
}

function testTree() {
  return (
    <AppStateProvider>
      <ThreadContentProvider>
        <RuntimeModelsProvider>
          <MemoryRouter>
            <EditResendHarness />
          </MemoryRouter>
        </RuntimeModelsProvider>
      </ThreadContentProvider>
    </AppStateProvider>
  );
}

async function mount(tree: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(tree);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
}

async function renderEditScenario() {
  const snapshot = baseSnapshot();
  const authority = createFakeAppStateAuthority(snapshot);
  installCarrentBridge(authority);
  await mount(testTree());
  return authority;
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

describe("edit without content change", () => {
  it("prunes the previous assistant answer and starts a new run", async () => {
    await renderEditScenario();

    // Initially the old assistant answer is visible.
    expect(container!.textContent).toContain("old answer");

    // Hover the user message bubble to reveal the Edit button.
    const userBubble = [...container!.querySelectorAll<HTMLParagraphElement>("p")].find((p) =>
      p.textContent?.includes("hello"),
    )?.parentElement?.parentElement;
    expect(userBubble).toBeDefined();
    await act(async () => {
      userBubble!.dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: true }));
      userBubble!.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Enter edit mode on the user message.
    const editButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.title === "Edit",
    );
    expect(editButton).toBeDefined();
    await act(async () => {
      editButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Submit without changing the textarea content.
    const sendButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("发送"),
    );
    expect(sendButton).toBeDefined();
    await act(async () => {
      sendButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The old assistant answer should be gone.
    expect(container!.textContent).not.toContain("old answer");

    // Exactly one assistant message should remain (the new running placeholder).
    const assistantIds = container!.querySelector<HTMLDivElement>("[data-testid='assistant-ids']");
    expect(assistantIds?.textContent?.split(",").filter(Boolean).length).toBe(1);
  });
});
