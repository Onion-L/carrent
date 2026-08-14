import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import type { ChatRunEvent, ChatTurnRequest } from "../../../shared/chat";
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
        localPathContexts: [
          { path: "/tmp/remove.ts", basename: "remove.ts", kind: "file" },
          { path: "/tmp/keep", basename: "keep", kind: "directory" },
        ],
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

function installCarrentBridge(
  authority: ReturnType<typeof createFakeAppStateAuthority>,
  requests: ChatTurnRequest[] = [],
) {
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
      send: async (request: ChatTurnRequest) => {
        requests.push(structuredClone(request));
        return { runId: "run-1" };
      },
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
            localPathContexts: draft.localPathContexts,
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

async function renderEditScenario(requests: ChatTurnRequest[] = []) {
  const snapshot = baseSnapshot();
  const authority = createFakeAppStateAuthority(snapshot);
  installCarrentBridge(authority, requests);
  await mount(testTree());
  return authority;
}

async function enterEditMode() {
  const userBubble = [...container!.querySelectorAll<HTMLParagraphElement>("p")].find((p) =>
    p.textContent?.includes("hello"),
  )?.parentElement?.parentElement;
  expect(userBubble).toBeDefined();
  await act(async () => {
    userBubble!.dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: true }));
    userBubble!.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  const editButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.title === "Edit",
  );
  expect(editButton).toBeDefined();
  await act(async () => {
    editButton!.click();
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
});

describe("edit without content change", () => {
  it("rehydrates removable Local Path Context and preserves only the submitted selection", async () => {
    const requests: ChatTurnRequest[] = [];
    const authority = await renderEditScenario(requests);
    await enterEditMode();

    expect(container!.querySelectorAll("[data-local-path-context-card]")).toHaveLength(2);
    const removeButton = container!.querySelector<HTMLButtonElement>(
      '[aria-label="Remove remove.ts"]',
    );
    expect(removeButton).not.toBeNull();
    await act(async () => removeButton!.click());

    const sendButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "发送",
    );
    await act(async () => {
      sendButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(requests[0]?.localPathContexts).toEqual([
      { path: "/tmp/keep", basename: "keep", kind: "directory" },
    ]);
    expect(authority.getState().snapshot.threadMessages?.[0]?.localPathContexts).toEqual([
      { path: "/tmp/keep", basename: "keep", kind: "directory" },
    ]);
  });

  it("opens a spacious, resizable message editor with compact actions", async () => {
    await renderEditScenario();
    await enterEditMode();

    const editor = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑消息"]');
    expect(editor?.getAttribute("rows")).toBe("8");
    expect(editor?.classList.contains("min-h-48")).toBe(true);
    expect(editor?.classList.contains("max-h-[55vh]")).toBe(true);
    expect(editor?.classList.contains("resize-y")).toBe(true);

    const sendButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "发送",
    );
    expect(sendButton?.classList.contains("text-app-12")).toBe(true);
    expect(sendButton?.classList.contains("rounded-md")).toBe(true);
  });

  it("prunes the previous assistant answer and starts a new run", async () => {
    await renderEditScenario();

    // Initially the old assistant answer is visible.
    expect(container!.textContent).toContain("old answer");

    await enterEditMode();

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
