import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import type { ThreadRunChecklist } from "../../../shared/runChecklist";
import type { ChatRunEvent } from "../../../shared/chat";
import type { WorkspaceSnapshot } from "../../../shared/workspacePersistence";
import { RuntimeModelsProvider } from "../../context/RuntimeModelsContext";
import { WorkspaceProvider, useWorkspace } from "../../context/WorkspaceContext";
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
});

function ComposerHarness({ threadId }: { threadId: string }) {
  const { hasHydrated, getChatRouteData } = useWorkspace();
  const routeData = getChatRouteData(threadId);
  if (!hasHydrated || !routeData) {
    return null;
  }

  return (
    <Composer
      mode="chat"
      threadId={threadId}
      messages={routeData.messages}
      runtimeId="kimi"
      runtimeMode="approval-required"
      planMode={false}
    />
  );
}

async function renderComposer(threadId: string, snapshot: WorkspaceSnapshot) {
  window.carrent = {
    workspace: {
      load: async () => snapshot,
      remember: () => {},
      save: async () => {},
    },
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
      send: async () => ({ runId: "run-next" }),
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
      <WorkspaceProvider>
        <RuntimeModelsProvider>
          <MemoryRouter>
            <ComposerHarness threadId={threadId} />
          </MemoryRouter>
        </RuntimeModelsProvider>
      </WorkspaceProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
}

async function rerenderComposer(threadId: string) {
  await act(async () => {
    root!.render(
      <WorkspaceProvider>
        <RuntimeModelsProvider>
          <MemoryRouter>
            <ComposerHarness threadId={threadId} />
          </MemoryRouter>
        </RuntimeModelsProvider>
      </WorkspaceProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
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
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [],
      chats: [
        {
          id: "thread-1",
          title: "First",
          updatedAt: "now",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          runChecklist: checklist,
        },
        {
          id: "thread-2",
          title: "Second",
          updatedAt: "now",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          runChecklist: {
            ...checklist,
            runId: "run-2",
            entries: [{ content: "Second Thread step", status: "completed" }],
          },
        },
      ],
      messages: [],
      activeThreadId: "thread-1",
    };
    await renderComposer("thread-1", snapshot);

    expect(container!.textContent).toContain("Implement the checklist");
    await rerenderComposer("thread-2");
    expect(container!.textContent).toContain("Second Thread step");
    expect(container!.textContent).not.toContain("Implement the checklist");
    await rerenderComposer("thread-1");

    const textarea = container!.querySelector("textarea")!;
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      textarea.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
      valueSetter.call(textarea, "Continue the work");
      textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
      textarea.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: "k" }));
    });
    expect(container!.textContent).toContain("Implement the checklist");

    const sendButton = container!.querySelector<SVGElement>(".lucide-arrow-up")?.closest("button");
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
    expect(container!.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      chatEventListener?.({ type: "stopped", runId: "run-next" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
