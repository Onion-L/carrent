import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import type { ChatRunEvent } from "../../../shared/chat";
import type { AppStateSnapshot } from "../../../shared/workspacePersistence";
import { AppStateProvider } from "../../context/AppStateContext";
import { RuntimeModelsProvider } from "../../context/RuntimeModelsContext";
import { ThreadContentProvider, useThreadContent } from "../../context/ThreadContentContext";
import { Composer } from "./Composer";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function ComposerHarness() {
  const { hasHydrated, getThreadRouteData } = useThreadContent();
  const routeData = getThreadRouteData("project-1", "thread-1");
  if (!hasHydrated || !routeData) {
    return null;
  }

  return (
    <Composer
      mode="thread"
      workspaceId="workspace-1"
      projectId="project-1"
      threadId="thread-1"
      messages={routeData.messages}
      runtimeId="kimi"
      runtimeMode="approval-required"
      planMode={false}
    />
  );
}

async function renderComposer() {
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

  window.carrent = {
    appState: {
      load: async () => ({ status: "ready", snapshot }),
      reread: async () => ({ status: "ready", snapshot }),
      stage: () => {},
      save: async () => {},
      fullReset: async () => ({ status: "ready", snapshot }),
      copyDiagnostics: async () => {},
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
    skills: {
      list: async () => [
        {
          name: "grilling",
          description: "Different Skill with the same name.",
          path: "/skills/other/grilling/SKILL.md",
          source: "codex",
        },
        {
          name: "grilling",
          description: "Stress-test a plan.",
          path: "/skills/grilling/SKILL.md",
          source: "agents",
        },
        {
          name: "pdf",
          description: "Work with PDF files.",
          path: "/skills/pdf/SKILL.md",
          source: "codex",
        },
        {
          name: "tdd",
          description: "Develop test-first.",
          path: "/skills/tdd/SKILL.md",
          source: "agents",
        },
      ],
    },
    mcpServer: {
      getStatus: async () => ({ enabled: true, running: true }),
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

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AppStateProvider>
        <ThreadContentProvider>
          <RuntimeModelsProvider>
            <MemoryRouter>
              <ComposerHarness />
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

async function insertSkill(input: string, cursor: number, description: string) {
  const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
  const text = editor.querySelector<HTMLElement>("[data-composer-text='true']")!;
  await act(async () => {
    text.focus();
    text.textContent = input;
    text.dispatchEvent(
      new window.InputEvent("input", { bubbles: true, inputType: "insertText" }),
    );
    const range = document.createRange();
    range.setStart(text.firstChild!, cursor);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    text.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: "a" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const skillButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes(description),
  )!;
  await act(async () => {
    skillButton.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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

describe("Composer inline Skills", () => {
  it("keeps first input inside the text editor and opens the slash menu", async () => {
    await renderComposer();

    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
    const text = editor.querySelector<HTMLElement>("[data-composer-text='true']")!;

    expect(editor.contentEditable).not.toBe("true");
    expect(text.contentEditable).toBe("true");

    await act(async () => {
      text.focus();
      text.textContent = "/";
      text.dispatchEvent(new window.InputEvent("input", { bubbles: true, inputType: "insertText" }));
      text.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: "/" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container!.textContent).toContain("Plan mode");
  });

  it("preserves surrounding text and keeps multiple Skills inside the editable flow", async () => {
    await renderComposer();

    await insertSkill("/grill已有内容", 6, "Stress-test a plan.");
    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
    const text = editor.querySelector<HTMLElement>("[data-composer-text='true']")!;
    expect(text.textContent).toBe("已有内容");

    await insertSkill("before /pdf after", 11, "Work with PDF files.");
    expect(text.textContent).toBe("before  after");
    expect(window.getSelection()?.anchorOffset).toBe(7);

    await insertSkill("finish /tdd", 11, "Develop test-first.");
    expect(text.textContent).toBe("finish ");
    expect(window.getSelection()?.anchorOffset).toBe(7);

    const markers = editor.querySelectorAll<HTMLElement>("[data-skill-marker='true']");
    expect(markers).toHaveLength(3);
    expect([...markers].every((marker) => marker.contentEditable === "false")).toBe(true);
    expect(editor.contentEditable).not.toBe("true");
    expect(text.contentEditable).toBe("true");
    expect([...editor.children].at(-1)).toBe(text);
    expect(editor.className).not.toContain("flex");
    expect(markers[0]!.className).toContain("inline-flex");
    expect(text.className).toContain("whitespace-pre-wrap");
  });

  it("restores a pasted Skill by name and path", async () => {
    await renderComposer();
    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
    const text = editor.querySelector<HTMLElement>("[data-composer-text='true']")!;
    const pasteEvent = new window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        files: [],
        getData: () => "[$grilling](/skills/grilling/SKILL.md) Keep this text",
      },
    });

    await act(async () => {
      text.dispatchEvent(pasteEvent);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(editor.querySelector<HTMLElement>("[data-skill-marker='true']")?.title).toBe(
      "/skills/grilling/SKILL.md",
    );
    expect(text.textContent).toBe("Keep this text");
  });
});
