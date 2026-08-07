import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";

import type { ThreadRunChecklist } from "../../../shared/runChecklist";
import type { ChatRunEvent } from "../../../shared/chat";
import type { AppStateSnapshot } from "../../../shared/workspacePersistence";
import { createFakeAppStateAuthority } from "../../test/fakeAppStateAuthority";
import { AppStateProvider } from "../../context/AppStateContext";
import { RuntimeModelsProvider } from "../../context/RuntimeModelsContext";
import { ThreadContentProvider, useThreadContent } from "../../context/ThreadContentContext";
import { Composer } from "./Composer";
import { getRunChecklistProgress, RunChecklist } from "./RunChecklist";

const checklist: ThreadRunChecklist = {
  runId: "run-1",
  runtimeId: "kimi",
  outcome: "running",
  expanded: true,
  entries: [
    { content: "Inspect the existing flow", status: "completed" },
    { content: "Implement the checklist", status: "in_progress" },
    { content: "Run verification", status: "pending" },
  ],
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let chatEventListener: ((event: ChatRunEvent) => void) | null = null;
let nextRunId = "run-next";

async function renderChecklist(
  value: ThreadRunChecklist,
  onExpandedChange: (expanded: boolean) => void = () => {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RunChecklist checklist={value} onExpandedChange={onExpandedChange} />);
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  chatEventListener = null;
  nextRunId = "run-next";
});

function ComposerHarness({ threadId }: { threadId: string }) {
  const { hasHydrated, getThreadRouteData } = useThreadContent();
  const routeData = getThreadRouteData("project-1", threadId);
  if (!hasHydrated || !routeData) {
    return null;
  }

  return (
    <Composer
      mode="thread"
      workspaceId="workspace-1"
      projectId="project-1"
      threadId={threadId}
      messages={routeData.messages}
      runtimeId="kimi"
      runtimeMode="approval-required"
      planMode={false}
    />
  );
}

async function renderComposer(threadId: string, snapshot: AppStateSnapshot) {
  const authority = createFakeAppStateAuthority(snapshot);
  window.carrent = {
    appState: {
      load: async () => ({ status: "ready", snapshot }),
      reread: async () => ({ status: "ready", snapshot }),
      fullReset: async () => ({ status: "ready", snapshot }),
      subscribe: authority.subscribe,
      unsubscribe: authority.unsubscribe,
      command: authority.command,
      onChanged: authority.onChanged,
      onFlushRequest: () => () => {},
      flushDone: async () => {},
    },
    projectDirectories: { check: async () => ({ available: true }) },
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
    mcpServer: {
      getStatus: async () => ({ enabled: true, running: false }),
    },
    chat: {
      send: async () => ({ runId: nextRunId }),
      stop: async () => {},
      deleteThreadData: async () => {},
      respondToPermission: async () => {},
      respondToQuestion: async () => {},
      getKimiStatus: async () => null,
      onEvent: (listener: (event: ChatRunEvent) => void) => {
        chatEventListener = listener;
        return () => {
          chatEventListener = null;
        };
      },
    },
  } as unknown as Window["carrent"];

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AppStateProvider>
        <ThreadContentProvider>
          <RuntimeModelsProvider>
            <MemoryRouter>
              <ComposerHarness threadId={threadId} />
            </MemoryRouter>
          </RuntimeModelsProvider>
        </ThreadContentProvider>
      </AppStateProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
}

async function rerenderComposer(threadId: string) {
  await act(async () => {
    root!.render(
      <AppStateProvider>
        <ThreadContentProvider>
          <RuntimeModelsProvider>
            <MemoryRouter>
              <ComposerHarness threadId={threadId} />
            </MemoryRouter>
          </RuntimeModelsProvider>
        </ThreadContentProvider>
      </AppStateProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
}

function getLexicalEditor() {
  const editorText = container!.querySelector<HTMLElement>("[data-composer-text='true']")!;
  return (editorText as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
}

async function typeComposerText(message: string) {
  const editorText = container!.querySelector<HTMLElement>("[data-composer-text='true']")!;
  await act(async () => {
    getLexicalEditor().update(() => {
      const rootNode = $getRoot();
      rootNode.clear();
      const paragraph = $createParagraphNode();
      const textNode = $createTextNode(message);
      paragraph.append(textNode);
      rootNode.append(paragraph);
      textNode.select();
    });
    editorText.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function submitComposerMessage(message: string, runId: string) {
  nextRunId = runId;
  await typeComposerText(message);
  const sendButton = await waitForSendButton();
  expect(sendButton?.disabled).toBe(false);
  await act(async () => {
    sendButton!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForSendButton() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const button = container!.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
    if (button) return button;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  return null;
}

describe("getRunChecklistProgress", () => {
  it("uses the first active position, completed count, zero, and total", () => {
    expect(getRunChecklistProgress(checklist.entries)).toBe(2);
    expect(
      getRunChecklistProgress([
        { content: "One", status: "completed" },
        { content: "Two", status: "pending" },
      ]),
    ).toBe(1);
    expect(getRunChecklistProgress([{ content: "One", status: "pending" }])).toBe(0);
    expect(getRunChecklistProgress([{ content: "One", status: "completed" }])).toBe(1);
    expect(
      getRunChecklistProgress([
        { content: "One", status: "completed" },
        { content: "Two", status: "in_progress" },
        { content: "Three", status: "in_progress" },
      ]),
    ).toBe(2);
  });
});

describe("RunChecklist", () => {
  it("renders ordered item states and an accessible disclosure", async () => {
    await renderChecklist(checklist);

    const button = container!.querySelector("button")!;
    expect(button.textContent).toContain("Step 2 of 3");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container!.querySelector('[role="list"]')?.textContent).toContain(
      "Inspect the existing flow",
    );
    expect(container!.textContent).toContain("Completed");
    expect(container!.textContent).toContain("In progress");
    expect(container!.textContent).toContain("Pending");
    expect(container!.querySelectorAll("li")).toHaveLength(3);
  });

  it("requests disclosure changes without making items interactive", async () => {
    const changes: boolean[] = [];
    await renderChecklist(checklist, (expanded) => changes.push(expanded));

    await act(async () => container!.querySelector("button")!.click());

    expect(changes).toEqual([false]);
    expect(container!.querySelectorAll("li button")).toHaveLength(0);
  });

  it("shows terminal outcome text and keeps the list internally scrollable", async () => {
    await renderChecklist({ ...checklist, outcome: "failed" });

    expect(container!.textContent).toContain("Run failed");
    expect(container!.querySelector('[role="list"]')?.className).toContain("overflow-y-auto");
    expect(container!.querySelector('[role="list"]')?.className).toContain("max-h-");
  });

  it("restores per-Thread state and follows the Composer Run lifecycle", async () => {
    const snapshot: AppStateSnapshot = {
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
          runChecklist: checklist,
        },
        {
          id: "thread-2",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Second",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
          runChecklist: {
            ...checklist,
            runId: "run-2",
            entries: [{ content: "Second Thread step", status: "completed" }],
          },
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
    await renderComposer("thread-1", snapshot);

    expect(container!.textContent).toContain("Implement the checklist");
    await rerenderComposer("thread-2");
    expect(container!.textContent).toContain("Second Thread step");
    expect(container!.textContent).not.toContain("Implement the checklist");
    await rerenderComposer("thread-1");

    await typeComposerText("Continue the work");
    expect(container!.textContent).toContain("Implement the checklist");

    const sendButton = await waitForSendButton();
    expect(sendButton?.disabled).toBe(false);
    await act(async () => {
      sendButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      chatEventListener?.({ type: "started", runId: "run-next", threadId: "thread-1" });
    });
    expect(container!.textContent).not.toContain("Step 2 of 3");

    await act(async () => {
      chatEventListener?.({
        type: "checklist",
        runId: "run-next",
        threadId: "thread-1",
        runtimeId: "kimi",
        checklist: { entries: [{ content: "New Run step", status: "in_progress" }] },
      });
    });
    expect(container!.textContent).toContain("New Run step");
    const checklistButton = container!.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(checklistButton.getAttribute("aria-expanded")).toBe("true");

    await act(async () => checklistButton.click());
    expect(checklistButton.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      chatEventListener?.({
        type: "checklist",
        runId: "run-next",
        threadId: "thread-1",
        runtimeId: "kimi",
        checklist: {
          entries: [
            { content: "Replacement complete", status: "completed" },
            { content: "Replacement pending", status: "pending" },
          ],
        },
      });
    });
    expect(checklistButton.getAttribute("aria-expanded")).toBe("false");

    await act(async () => checklistButton.click());
    expect(container!.textContent).not.toContain("New Run step");
    expect(container!.textContent).toContain("Replacement complete");
    expect(container!.textContent).toContain("Replacement pending");

    await act(async () => {
      chatEventListener?.({ type: "stopped", runId: "run-next" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.textContent).toContain("Run cancelled");
    expect(container!.textContent).toContain("Replacement pending");

    await submitComposerMessage("Fail the next Run", "run-failed");
    await act(async () => {
      chatEventListener?.({ type: "started", runId: "run-failed", threadId: "thread-1" });
      chatEventListener?.({
        type: "checklist",
        runId: "run-failed",
        threadId: "thread-1",
        runtimeId: "kimi",
        checklist: { entries: [{ content: "Failed Run step", status: "in_progress" }] },
      });
      chatEventListener?.({ type: "failed", runId: "run-failed", error: "Failed" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.textContent).toContain("Run failed");
    expect(container!.textContent).toContain("Failed Run step");

    await submitComposerMessage("Complete the next Run", "run-completed");
    await act(async () => {
      chatEventListener?.({ type: "started", runId: "run-completed", threadId: "thread-1" });
      chatEventListener?.({
        type: "checklist",
        runId: "run-completed",
        threadId: "thread-1",
        runtimeId: "kimi",
        checklist: { entries: [{ content: "Completed Run step", status: "completed" }] },
      });
      chatEventListener?.({
        type: "completed",
        runId: "run-completed",
        text: "Done",
        finishedAt: "now",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.textContent).toContain("Run completed");
    expect(container!.textContent).toContain("Completed Run step");
  });
});
