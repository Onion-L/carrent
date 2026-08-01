import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  PASTE_COMMAND,
  type LexicalEditor,
} from "lexical";

import type { ChatRunEvent } from "../../../shared/chat";
import type { AppStateSnapshot } from "../../../shared/workspacePersistence";
import { createFakeAppStateAuthority } from "../../test/fakeAppStateAuthority";
import { AppStateProvider } from "../../context/AppStateContext";
import { RuntimeModelsProvider } from "../../context/RuntimeModelsContext";
import { ThreadContentProvider, useThreadContent } from "../../context/ThreadContentContext";
import { Composer, type ComposerDraftRequest } from "./Composer";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function ComposerHarness({ draftRequest }: { draftRequest?: ComposerDraftRequest }) {
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
      draftRequest={draftRequest}
    />
  );
}

function composerTree(draftRequest?: ComposerDraftRequest) {
  return (
    <AppStateProvider>
      <ThreadContentProvider>
        <RuntimeModelsProvider>
          <MemoryRouter>
            <ComposerHarness draftRequest={draftRequest} />
          </MemoryRouter>
        </RuntimeModelsProvider>
      </ThreadContentProvider>
    </AppStateProvider>
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
        {
          name: "implement",
          description: "Implement a request.",
          path: "/skills/implement/SKILL.md",
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
    root!.render(composerTree());
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
}

function getLexicalEditor() {
  const text = container!.querySelector<HTMLElement>("[data-composer-text='true']")!;
  return (text as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
}

function getComposerText() {
  let text = "";
  getLexicalEditor()
    .getEditorState()
    .read(() => {
      text = $getRoot().getTextContent();
    });
  return text;
}

async function setComposerText(input: string, cursor = input.length) {
  const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
  const text = editor.querySelector<HTMLElement>("[data-composer-text='true']")!;
  await act(async () => {
    getLexicalEditor().update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const textNode = $createTextNode(input);
      paragraph.append(textNode);
      root.append(paragraph);
      textNode.select(cursor, cursor);
    });
    text.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function chooseSkill(description: string) {
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

    await setComposerText("/");

    expect(container!.textContent).toContain("Plan mode");
  });

  it("preserves surrounding text and keeps multiple Skills inside the editable flow", async () => {
    await renderComposer();

    await setComposerText("before /pdf after", 11);
    await chooseSkill("Work with PDF files.");
    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
    const text = editor.querySelector<HTMLElement>("[data-composer-text='true']")!;
    expect(text.textContent).toContain("before PDF after");

    await act(async () => {
      getLexicalEditor().update(() => {
        $getRoot().selectEnd();
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(" /tdd");
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await chooseSkill("Develop test-first.");

    const markers = editor.querySelectorAll<HTMLElement>("[data-skill-marker='true']");
    expect(markers).toHaveLength(2);
    expect([...markers].every((marker) => marker.contentEditable === "false")).toBe(true);
    expect(editor.contentEditable).not.toBe("true");
    expect(text.contentEditable).toBe("true");
    expect(editor.className).not.toContain("flex");
    expect(markers[0]!.className).toContain("inline-flex");
    expect(text.className).toContain("whitespace-pre-wrap");
  });

  it("restores a pasted Skill by name and path", async () => {
    await renderComposer();
    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
    const text = editor.querySelector<HTMLElement>("[data-composer-text='true']")!;
    const pasteEvent = new window.ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        files: [],
        getData: () => "[$grilling](/skills/grilling/SKILL.md) Keep this text",
      },
    });

    await act(async () => {
      getLexicalEditor().update(() => $getRoot().selectEnd());
      text.focus();
      getLexicalEditor().dispatchCommand(PASTE_COMMAND, pasteEvent);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(editor.querySelector<HTMLElement>("[data-skill-marker='true']")?.title).toBe(
      "/skills/grilling/SKILL.md",
    );
    expect(text.textContent).toEndWith("Keep this text");
  });

  it("normalizes trailing whitespace before appending an external draft", async () => {
    await renderComposer();
    await setComposerText("Keep this draft   ");

    await act(async () => {
      root!.render(composerTree({ content: "Add this", requestId: 1 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getComposerText()).toBe("Keep this draft\n\nAdd this");
  });

  it("renders file references inline while preserving their submitted markdown", async () => {
    await renderComposer();
    const reference = "[index.css (line 30)](/code/carrent/apps/desktop/src/styles/index.css:30)";

    await setComposerText("Open ");
    await act(async () => {
      getLexicalEditor().update(() => {
        $getRoot().selectEnd();
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(reference);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const marker = container!.querySelector<HTMLElement>("[data-file-marker='true']");
    expect(marker?.textContent).toBe("index.css (line 30)");
    expect(marker?.title).toBe("/code/carrent/apps/desktop/src/styles/index.css:30");
    expect(marker?.contentEditable).toBe("false");
    expect(getComposerText()).toBe(`Open ${reference}`);

    await act(async () => {
      getLexicalEditor().update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(" and continue");
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getComposerText()).toBe(`Open ${reference} and continue`);
  });

  it("restores a Skill marker when an external draft also contains file references", async () => {
    await renderComposer();
    const content =
      "[$implement](/skills/implement/SKILL.md) [index.css (line 30)](/code/carrent/index.css:30)";

    await act(async () => {
      root!.render(composerTree({ content, requestId: 1 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container!.querySelector<HTMLElement>("[data-skill-marker='true']")?.textContent).toBe(
      "Implement",
    );
    expect(container!.querySelector<HTMLElement>("[data-file-marker='true']")?.textContent).toBe(
      "index.css (line 30)",
    );
  });
});
