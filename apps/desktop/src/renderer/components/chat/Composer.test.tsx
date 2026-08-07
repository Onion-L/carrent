import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
} from "lexical";

import type {
  ChatRunAuthorityChange,
  ChatRunAuthorityState,
  ChatRunEvent,
} from "../../../shared/chat";
import type { AppStateSnapshot } from "../../../shared/workspacePersistence";
import { createFakeAppStateAuthority } from "../../test/fakeAppStateAuthority";
import { AppStateProvider } from "../../context/AppStateContext";
import { RuntimeModelsProvider } from "../../context/RuntimeModelsContext";
import { ThreadContentProvider, useThreadContent } from "../../context/ThreadContentContext";
import {
  clearThreadDraft,
  enqueueChatMessage,
  getQueuedMessages,
  getThreadDraft,
  removeQueuedChatMessage,
} from "../../hooks/chatMessageQueue";
import {
  Composer,
  type AssociationDraftPromotionInput,
  type ComposerDraftRequest,
} from "./Composer";
import type { ThreadWorkDraftSnapshot } from "../../hooks/chatMessageQueue";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let emitChatEvent: ((event: ChatRunEvent) => void) | null = null;
let emitChatAuthorityChange: ((update: ChatRunAuthorityChange) => void) | null = null;
let activeChatAuthorityState: ChatRunAuthorityState | null = null;
let sentChatMessages: string[] = [];
let sentChatRunIds: string[] = [];
let listedSkillProjectDirs: Array<string | undefined> = [];

function ComposerHarness({
  draftRequest,
  threadId = "thread-1",
}: {
  draftRequest?: ComposerDraftRequest;
  threadId?: string;
}) {
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
      draftRequest={draftRequest}
    />
  );
}

function composerTree(draftRequest?: ComposerDraftRequest, threadId = "thread-1") {
  return (
    <AppStateProvider>
      <ThreadContentProvider>
        <RuntimeModelsProvider>
          <MemoryRouter>
            <ComposerHarness draftRequest={draftRequest} threadId={threadId} />
          </MemoryRouter>
        </RuntimeModelsProvider>
      </ThreadContentProvider>
    </AppStateProvider>
  );
}

function AssociationDraftHarness({
  initialDraft,
  onDraftChange,
}: {
  initialDraft: ThreadWorkDraftSnapshot;
  onDraftChange: (draft: ThreadWorkDraftSnapshot | null) => void;
}) {
  return (
    <Composer
      mode="association-draft"
      placement="centered"
      workspaceId="workspace-1"
      projectId="project-1"
      projectName="Carrent"
      projectPath="/code/carrent"
      threadId="draft-thread-1"
      initialDraft={initialDraft}
      messages={[]}
      runtimeId="kimi"
      runtimeMode="approval-required"
      planMode={false}
      onDraftChange={onDraftChange}
      onPromote={async (_input: AssociationDraftPromotionInput) => false}
      onPromotionRejected={async () => {}}
      onPromoted={() => {}}
    />
  );
}

function associationDraftTree(
  initialDraft: ThreadWorkDraftSnapshot,
  onDraftChange: (draft: ThreadWorkDraftSnapshot | null) => void,
) {
  return (
    <AppStateProvider>
      <ThreadContentProvider>
        <RuntimeModelsProvider>
          <MemoryRouter>
            <AssociationDraftHarness initialDraft={initialDraft} onDraftChange={onDraftChange} />
          </MemoryRouter>
        </RuntimeModelsProvider>
      </ThreadContentProvider>
    </AppStateProvider>
  );
}

async function renderAssociationDraft(initialDraft: ThreadWorkDraftSnapshot) {
  const snapshot = baseSnapshot({});
  const authority = createFakeAppStateAuthority(snapshot);
  installCarrentBridge(authority, snapshot);
  const drafts: Array<ThreadWorkDraftSnapshot | null> = [];
  await mount(associationDraftTree(initialDraft, (draft) => drafts.push(draft)));
  return { authority, drafts };
}

function baseSnapshot(threadWork: AppStateSnapshot["threadWork"]): AppStateSnapshot {
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
      },
    ],
    threadDrafts: [],
    threadMessages: [],
    threadRuns: [],
    threadPromotionIntents: [],
    threadWork,
    lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
    activeWorkspaceId: "workspace-1",
  };
}

function installCarrentBridge(
  authority: ReturnType<typeof createFakeAppStateAuthority>,
  snapshot: AppStateSnapshot,
  options: { authorityState?: ChatRunAuthorityState } = {},
) {
  emitChatEvent = null;
  emitChatAuthorityChange = null;
  activeChatAuthorityState = options.authorityState ?? null;
  sentChatMessages = [];
  sentChatRunIds = [];
  listedSkillProjectDirs = [];
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
    skills: {
      list: async (projectDir) => {
        listedSkillProjectDirs.push(projectDir);
        return [
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
        ];
      },
    },
    mcpServer: {
      getStatus: async () => ({ enabled: true, running: true }),
    },
    git: {
      workspaceSnapshot: async () => ({ state: "ready", baseRevision: "base" }),
      workspaceDiff: async () => ({ state: "ready", files: [] }),
    },
    chat: {
      send: async (request: { message: string; requestKey?: string }) => {
        const runId = `run-${sentChatRunIds.length + 1}`;
        sentChatMessages.push(request.message);
        sentChatRunIds.push(runId);
        if (activeChatAuthorityState) {
          queueMicrotask(() => {
            const baseRevision = activeChatAuthorityState!.revision;
            const completedEvent: ChatRunEvent = {
              type: "completed",
              runId,
              requestKey: request.requestKey,
              text: "done",
              finishedAt: "2026-08-07T00:00:02.000Z",
            };
            const completedRun = {
              runId,
              requestKey: request.requestKey,
              threadId: "thread-2",
              status: "completed" as const,
              stopRequested: false,
              eventCount: 1,
              events: [completedEvent],
              pendingPermissions: [],
              pendingQuestions: [],
            };
            activeChatAuthorityState = {
              revision: baseRevision + 1,
              runs: [...activeChatAuthorityState!.runs, completedRun],
            };
            emitChatAuthorityChange?.({
              baseRevision,
              revision: baseRevision + 1,
              run: completedRun,
              event: completedEvent,
            });
          });
        }
        return { runId };
      },
      stop: async () => {},
      deleteThreadData: async () => {},
      respondToPermission: async () => {},
      respondToQuestion: async () => {},
      getKimiStatus: async () => null,
      ...(activeChatAuthorityState
        ? {
            onChanged: (listener: (update: ChatRunAuthorityChange) => void) => {
              emitChatAuthorityChange = listener;
              return () => {
                if (emitChatAuthorityChange === listener) emitChatAuthorityChange = null;
              };
            },
            subscribe: async () => activeChatAuthorityState!,
            unsubscribe: async () => {},
          }
        : {
            onEvent: (listener: (event: ChatRunEvent) => void) => {
              emitChatEvent = listener;
              return () => {
                if (emitChatEvent === listener) emitChatEvent = null;
              };
            },
          }),
    },
  } as unknown as Window["carrent"];
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

async function renderComposer(
  options: {
    threadWork?: AppStateSnapshot["threadWork"];
    threadId?: string;
    authorityOptions?: Parameters<typeof createFakeAppStateAuthority>[1];
    authorityState?: ChatRunAuthorityState;
  } = {},
) {
  const snapshot = baseSnapshot(options.threadWork ?? {});
  const authority = createFakeAppStateAuthority(snapshot, options.authorityOptions);
  installCarrentBridge(authority, snapshot, { authorityState: options.authorityState });
  await mount(composerTree(undefined, options.threadId));
  return authority;
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

async function submitComposer() {
  await act(async () => {
    getLexicalEditor().dispatchCommand(
      KEY_ENTER_COMMAND,
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForQueueFlush(threadId: string, expectedSentCount: number) {
  const deadline = Date.now() + 500;
  while (
    Date.now() < deadline &&
    (sentChatMessages.length !== expectedSentCount || getQueuedMessages(threadId).length > 0)
  ) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
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

function composerTextElement() {
  return container!.querySelector<HTMLElement>("[data-composer-text='true']")!;
}

async function startComposition() {
  const text = composerTextElement();
  await act(async () => {
    text.dispatchEvent(new window.CompositionEvent("compositionstart", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function endComposition() {
  const text = composerTextElement();
  await act(async () => {
    text.dispatchEvent(new window.CompositionEvent("compositionend", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function commitComposerText(next: string) {
  // Simulates IME commit: replace the editor text the way a committed candidate
  // would and let Lexical's OnChangePlugin publish the final snapshot.
  await act(async () => {
    getLexicalEditor().update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(next));
      root.append(paragraph);
      paragraph.selectEnd();
    });
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

describe("Composer inline Skills", () => {
  it("automatically sends the next queued message when a Run completes", async () => {
    const threadId = "thread-2";
    await renderComposer({ threadId });

    try {
      await setComposerText("first message");
      await submitComposer();
      expect(sentChatMessages).toEqual(["first message"]);

      await setComposerText("queued message");
      await submitComposer();
      expect(sentChatMessages).toEqual(["first message"]);
      expect(getQueuedMessages(threadId).map((item) => item.content)).toEqual(["queued message"]);

      await act(async () => {
        emitChatEvent?.({
          type: "completed",
          runId: sentChatRunIds[0]!,
          text: "done",
          finishedAt: "2026-08-07T00:00:00.000Z",
        });
      });
      await waitForQueueFlush(threadId, 2);

      expect(sentChatMessages).toEqual(["first message", "queued message"]);
      expect(getQueuedMessages(threadId)).toEqual([]);
    } finally {
      const latestRunId = sentChatRunIds.at(-1);
      if (latestRunId) {
        await act(async () => {
          emitChatEvent?.({
            type: "completed",
            runId: latestRunId,
            text: "done",
            finishedAt: "2026-08-07T00:00:01.000Z",
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
      getQueuedMessages(threadId).forEach((item) => removeQueuedChatMessage(threadId, item.id));
    }
  });

  it("automatically sends a queued message when a shared Run completes", async () => {
    const threadId = "thread-2";
    const sharedRun = {
      runId: "shared-run",
      requestKey: "shared-request",
      threadId,
      status: "running" as const,
      stopRequested: false,
      eventCount: 0,
      events: [],
      pendingPermissions: [],
      pendingQuestions: [],
    };
    const completedEvent: ChatRunEvent = {
      type: "completed",
      runId: sharedRun.runId,
      requestKey: sharedRun.requestKey,
      text: "done",
      finishedAt: "2026-08-07T00:00:00.000Z",
    };

    await renderComposer({
      threadId,
      authorityState: { revision: 1, runs: [sharedRun] },
    });

    try {
      await setComposerText("queued message");
      await submitComposer();
      expect(sentChatMessages).toEqual([]);
      expect(getQueuedMessages(threadId).map((item) => item.content)).toEqual(["queued message"]);

      await act(async () => {
        emitChatAuthorityChange?.({
          baseRevision: 1,
          revision: 2,
          run: {
            ...sharedRun,
            status: "completed",
            eventCount: 1,
            events: [completedEvent],
          },
          event: completedEvent,
        });
      });
      await waitForQueueFlush(threadId, 1);

      expect(sentChatMessages).toEqual(["queued message"]);
      expect(getQueuedMessages(threadId)).toEqual([]);
    } finally {
      getQueuedMessages(threadId).forEach((item) => removeQueuedChatMessage(threadId, item.id));
    }
  });

  it("clears a persisted draft when the Composer is emptied immediately before switching Threads", async () => {
    await renderComposer();
    await setComposerText("old draft");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(getThreadDraft("thread-1")?.content).toBe("old draft");

    await setComposerText("");
    await act(async () => {
      root!.render(composerTree(undefined, "thread-2"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getThreadDraft("thread-1")).toBe(null);
    expect(getThreadDraft("thread-2")).toBe(null);
    expect(getComposerText()).toBe("");

    await act(async () => {
      root!.render(composerTree(undefined, "thread-1"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getComposerText()).toBe("");
  });

  it("keeps a cleared draft when another Thread work command broadcasts first", async () => {
    await renderComposer({
      threadId: "thread-2",
      authorityOptions: {
        commandHook: async (command) => {
          if (command.type === "thread-work:update" && command.payload.threadId === "thread-2") {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          return null;
        },
      },
      threadWork: {
        "thread-1": {
          draft: { content: "unchanged", attachedSkillNames: [], attachments: [] },
          queuedMessages: [],
        },
        "thread-2": {
          draft: { content: "old target", attachedSkillNames: [], attachments: [] },
          queuedMessages: [],
        },
      },
    });
    expect(getComposerText()).toBe("old target");

    await setComposerText("");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650));
    });
    expect(getComposerText()).toBe("");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });

    expect(getComposerText()).toBe("");
    expect(getThreadDraft("thread-2")).toBe(null);
    expect(getThreadDraft("thread-1")?.content).toBe("unchanged");
  });

  it("applies a Thread Composer draft broadcast by another Renderer", async () => {
    const authority = await renderComposer();

    await act(async () => {
      await authority.command({
        commandId: "peer-composer-update",
        type: "thread-work:update",
        payload: {
          threadId: "thread-1",
          work: {
            draft: {
              content: "draft from peer window",
              attachedSkillNames: [],
              attachments: [],
            },
            queuedMessages: [],
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getComposerText()).toBe("draft from peer window");
  });

  it("keeps unpersisted input when the Thread queue changes", async () => {
    await renderComposer();
    await setComposerText("local input in progress");

    await act(async () => {
      enqueueChatMessage("thread-1", { id: "queued-1", content: "queued from peer" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getComposerText()).toBe("local input in progress");
  });

  it("restores initial draft attachments once", async () => {
    const attachment = {
      id: "attachment-1",
      kind: "file" as const,
      name: "notes.txt",
      mimeType: "text/plain",
      size: 1,
      storageKey: "attachment-1.txt",
    };
    await renderComposer({
      threadWork: {
        "thread-1": {
          draft: {
            content: "with attachment",
            attachedSkillNames: [],
            attachments: [attachment],
          },
          queuedMessages: [],
        },
      },
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(getThreadDraft("thread-1")?.attachments).toEqual([attachment]);
  });

  it("keeps first input inside the text editor and opens the slash menu", async () => {
    await renderComposer();

    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
    const text = editor.querySelector<HTMLElement>("[data-composer-text='true']")!;

    expect(editor.contentEditable).not.toBe("true");
    expect(text.contentEditable).toBe("true");

    await setComposerText("/");

    expect(container!.textContent).toContain("Plan mode");
  });

  it("loads and refreshes Skills for the current project", async () => {
    await renderComposer();

    expect(listedSkillProjectDirs).toEqual(["/code/carrent"]);

    await setComposerText("/");

    expect(listedSkillProjectDirs).toEqual(["/code/carrent", "/code/carrent"]);
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

describe("Composer IME composition", () => {
  async function broadcastPeerDraft(content: string, authority: ReturnType<typeof renderComposer>) {
    await act(async () => {
      await authority.command({
        commandId: "peer-composer-update",
        type: "thread-work:update",
        payload: {
          threadId: "thread-1",
          work: {
            draft: { content, attachedSkillNames: [], attachments: [] },
            queuedMessages: [],
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("persists a committed IME candidate when composition starts from an empty Composer", async () => {
    await renderComposer();

    await startComposition();
    await endComposition();
    await commitComposerText("你好");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(getComposerText()).toBe("你好");
    expect(getThreadDraft("thread-1")?.content).toBe("你好");
  });

  it("cancels a queued persistence timer when IME composition starts", async () => {
    await renderComposer();
    await setComposerText("unconfirmed input");

    await startComposition();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(getThreadDraft("thread-1")).toBe(null);
    await endComposition();
    await commitComposerText("已确认");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    // The cancelled timer must not suppress a later commit: once the candidate
    // is confirmed, persistence runs and saves it.
    expect(getThreadDraft("thread-1")?.content).toBe("已确认");
  });

  it("does not replace the editor while IME composition is active past the persistence debounce", async () => {
    const authority = await renderComposer();
    await setComposerText("local input");

    await startComposition();
    await broadcastPeerDraft("draft from peer window", authority);
    // Past the 300 ms persistence debounce — confirms the readback no longer
    // races with an active composition.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(getComposerText()).toBe("local input");
    await endComposition();
  });

  it("does not persist unconfirmed IME text into shared Thread Composer State", async () => {
    await renderComposer();
    await setComposerText("local input");
    // Persist the baseline before starting composition.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(getThreadDraft("thread-1")?.content).toBe("local input");

    await startComposition();
    await commitComposerText("local input 你好");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(getThreadDraft("thread-1")?.content).toBe("local input");
    await endComposition();
    // Lexical publishes a final snapshot after compositionend (its
    // onCompositionEnd handler re-reads the DOM). happy-dom does not reproduce
    // that event chain, so drive the editor once more to publish the post-
    // composition snapshot, which resolves composition state and lets the
    // debounced persistence save the committed text.
    await commitComposerText("local input 你好");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(getThreadDraft("thread-1")?.content).toBe("local input 你好");
  });

  it("keeps the committed candidate when a single shared draft arrived during composition", async () => {
    const authority = await renderComposer();
    await setComposerText("local input");

    await startComposition();
    await broadcastPeerDraft("draft from peer window", authority);
    await endComposition();
    await commitComposerText("local input 你好");

    expect(getComposerText()).toBe("local input 你好");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(getThreadDraft("thread-1")?.content).toBe("local input 你好");
  });

  it("applies the last shared draft when composition is cancelled and the local draft is unchanged", async () => {
    const authority = await renderComposer();
    await setComposerText("local input");

    await startComposition();
    await broadcastPeerDraft("peer one", authority);
    await broadcastPeerDraft("peer two", authority);
    await endComposition();
    // No commitComposerText: the composition is cancelled, so trigger the final
    // no-op snapshot the way Lexical does after a cancelled composition.
    await commitComposerText("local input");

    expect(getComposerText()).toBe("peer two");
  });

  it("applies a shared draft clear when composition is cancelled", async () => {
    await renderComposer();
    await setComposerText("local input");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(getThreadDraft("thread-1")?.content).toBe("local input");

    await startComposition();
    await act(async () => {
      clearThreadDraft("thread-1");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(getThreadDraft("thread-1")).toBe(null);
    await endComposition();
    await commitComposerText("local input");

    expect(getComposerText()).toBe("");
  });

  it("keeps existing sync behavior for a different shared draft outside composition", async () => {
    const authority = await renderComposer();
    await setComposerText("local input");

    await broadcastPeerDraft("draft from peer window", authority);

    expect(getComposerText()).toBe("draft from peer window");
  });

  it("ignores an identical shared-draft echo without touching the editor", async () => {
    const authority = await renderComposer();
    await setComposerText("echo text");
    // Persist locally so the authority echoes the same draft back.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    let replaceDraftCalls = 0;
    const editor = getLexicalEditor();
    const setEditorState = editor.setEditorState.bind(editor);
    editor.setEditorState = (state) => {
      replaceDraftCalls += 1;
      return setEditorState(state);
    };

    await broadcastPeerDraft("echo text", authority);

    expect(getComposerText()).toBe("echo text");
    expect(replaceDraftCalls).toBe(0);
  });

  it("clears composition state on unmount so a remount does not carry it over", async () => {
    const authority = await renderComposer();
    await setComposerText("local input");
    await startComposition();
    await broadcastPeerDraft("draft from peer window", authority);

    await act(async () => {
      root!.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(composerTree());
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    });

    // The remounted Composer has no active composition, so a fresh shared draft
    // applies immediately instead of being buffered.
    await broadcastPeerDraft("fresh draft after remount", authority);
    expect(getComposerText()).toBe("fresh draft after remount");
  });
});

describe("Composer association-draft composition", () => {
  it("persists input through onDraftChange during IME composition", async () => {
    const initialDraft: ThreadWorkDraftSnapshot = {
      content: "",
      attachedSkillNames: [],
      attachments: [],
    };
    const { drafts } = await renderAssociationDraft(initialDraft);
    await setComposerText("draft input");

    await startComposition();
    await endComposition();
    await commitComposerText("draft input 你好");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(getComposerText()).toBe("draft input 你好");
    const last = drafts[drafts.length - 1];
    expect(last?.content).toBe("draft input 你好");
    // Association drafts never subscribe to shared Thread Composer State, so the
    // composition coordination must not leave a draft behind.
    expect(getThreadDraft("draft-thread-1")).toBe(null);
  });
});
