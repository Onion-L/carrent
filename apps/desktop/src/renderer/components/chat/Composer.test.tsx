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
  ChatTurnRequest,
  ChatRunAuthorityChange,
  ChatRunAuthorityState,
  ChatRunEvent,
} from "../../../shared/chat";
import type { AppStateSnapshot } from "../../../shared/workspacePersistence";
import { createFakeAppStateAuthority } from "../../test/fakeAppStateAuthority";
import { chunkStreamingAnswer, LONG_STREAMING_ANSWER } from "../../test/streamingFixture";
import { AppStateProvider } from "../../context/AppStateContext";
import { RuntimeModelsProvider } from "../../context/RuntimeModelsContext";
import { ThreadContentProvider, useThreadContent } from "../../context/ThreadContentContext";
import { ToastProvider } from "../toast/ToastContext";
import {
  clearThreadDraft,
  enqueueChatMessage,
  getQueuedMessages,
  getThreadDraft,
  removeQueuedChatMessage,
} from "../../hooks/chatMessageQueue";
import {
  Composer,
  ConversationDropSurface,
  type AssociationDraftPromotionInput,
  type ComposerDraftRequest,
  type ImageFileDropRef,
  type LocalPathContextAddRef,
} from "./Composer";
import { MessageTimeline } from "./MessageTimeline";
import type { ThreadWorkDraftSnapshot } from "../../hooks/chatMessageQueue";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let emitChatEvent: ((event: ChatRunEvent) => void) | null = null;
let emitChatAuthorityChange: ((update: ChatRunAuthorityChange) => void) | null = null;
let activeChatAuthorityState: ChatRunAuthorityState | null = null;
let sentChatMessages: string[] = [];
let sentChatRunIds: string[] = [];
let sentChatRequestKeys: Array<string | undefined> = [];
let sentChatRequests: ChatTurnRequest[] = [];
let listedSkillProjectDirs: Array<string | undefined> = [];
let revealedPaths: string[] = [];
let latestAssistantMessage: { content: string; runStatus?: string } | null = null;

function ComposerHarness({
  draftRequest,
  threadId = "thread-1",
  withTimeline = false,
}: {
  draftRequest?: ComposerDraftRequest;
  threadId?: string;
  withTimeline?: boolean;
}) {
  const { hasHydrated, getThreadRouteData } = useThreadContent();
  const localPathContextAddRef = React.useRef(null) as LocalPathContextAddRef;
  const imageFileDropRef = React.useRef(null) as ImageFileDropRef;
  const routeData = getThreadRouteData("project-1", threadId);
  if (!hasHydrated || !routeData) {
    return null;
  }

  const assistantMessage = [...routeData.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  latestAssistantMessage = assistantMessage
    ? { content: assistantMessage.content, runStatus: assistantMessage.runStatus }
    : null;

  return (
    <ConversationDropSurface
      localPathContextAddRef={localPathContextAddRef}
      imageFileDropRef={imageFileDropRef}
    >
      {withTimeline ? <MessageTimeline messages={routeData.messages} threadId={threadId} /> : null}
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
        localPathContextAddRef={localPathContextAddRef}
        imageFileDropRef={imageFileDropRef}
      />
    </ConversationDropSurface>
  );
}

function composerTree(
  draftRequest?: ComposerDraftRequest,
  threadId = "thread-1",
  withTimeline = false,
) {
  return (
    <ToastProvider>
      <AppStateProvider>
        <ThreadContentProvider>
          <RuntimeModelsProvider>
            <MemoryRouter>
              <ComposerHarness
                draftRequest={draftRequest}
                threadId={threadId}
                withTimeline={withTimeline}
              />
            </MemoryRouter>
          </RuntimeModelsProvider>
        </ThreadContentProvider>
      </AppStateProvider>
    </ToastProvider>
  );
}

function AssociationDraftHarness({
  initialDraft,
  onDraftChange,
}: {
  initialDraft: ThreadWorkDraftSnapshot;
  onDraftChange: (draft: ThreadWorkDraftSnapshot | null) => void;
}) {
  const localPathContextAddRef = React.useRef(null) as LocalPathContextAddRef;
  return (
    <ConversationDropSurface localPathContextAddRef={localPathContextAddRef}>
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
        localPathContextAddRef={localPathContextAddRef}
        onDraftChange={onDraftChange}
        onPromote={async (_input: AssociationDraftPromotionInput) => false}
        onPromotionRejected={async () => {}}
        onPromoted={() => {}}
      />
    </ConversationDropSurface>
  );
}

function associationDraftTree(
  initialDraft: ThreadWorkDraftSnapshot,
  onDraftChange: (draft: ThreadWorkDraftSnapshot | null) => void,
) {
  return (
    <ToastProvider>
      <AppStateProvider>
        <ThreadContentProvider>
          <RuntimeModelsProvider>
            <MemoryRouter>
              <AssociationDraftHarness initialDraft={initialDraft} onDraftChange={onDraftChange} />
            </MemoryRouter>
          </RuntimeModelsProvider>
        </ThreadContentProvider>
      </AppStateProvider>
    </ToastProvider>
  );
}

async function renderAssociationDraft(
  initialDraft: ThreadWorkDraftSnapshot,
  options: { readAttachment?: () => Promise<Uint8Array> } = {},
) {
  const snapshot = baseSnapshot({});
  const authority = createFakeAppStateAuthority(snapshot);
  installCarrentBridge(authority, snapshot, options);
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
  options: {
    authorityState?: ChatRunAuthorityState;
    disableAutoComplete?: boolean;
    getKimiStatus?: (request: Record<string, unknown>) => Promise<unknown>;
    readAttachment?: () => Promise<Uint8Array>;
    workspaceDiff?: () => Promise<unknown>;
  } = {},
) {
  emitChatEvent = null;
  emitChatAuthorityChange = null;
  activeChatAuthorityState = options.authorityState ?? null;
  sentChatMessages = [];
  sentChatRunIds = [];
  sentChatRequestKeys = [];
  sentChatRequests = [];
  listedSkillProjectDirs = [];
  revealedPaths = [];
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
    attachments: {
      read: options.readAttachment ?? (async () => new Uint8Array([1])),
      store: async (input: { name: string; mimeType: string; data: Uint8Array }) => ({
        id: `stored-${input.name}`,
        kind: input.mimeType.startsWith("image/") ? ("image" as const) : ("file" as const),
        name: input.name,
        mimeType: input.mimeType,
        size: input.data.length,
        storageKey: input.name,
      }),
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
      workspaceDiff: options.workspaceDiff ?? (async () => ({ state: "ready", files: [] })),
    },
    chat: {
      send: async (request: ChatTurnRequest) => {
        const runId = `run-${sentChatRunIds.length + 1}`;
        sentChatMessages.push(request.message);
        sentChatRunIds.push(runId);
        sentChatRequestKeys.push(request.requestKey);
        sentChatRequests.push(request);
        if (activeChatAuthorityState && !options.disableAutoComplete) {
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
      getKimiStatus: options.getKimiStatus ?? (async () => null),
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
    shell: {
      openPath: async () => {},
      revealPath: async (path) => {
        revealedPaths.push(path);
        return { revealed: true };
      },
      openExternal: async () => {},
    },
    localPaths: {
      resolveDroppedItems: async (files) => ({
        items: files.map((file) => ({
          path: `/Users/test/${file.name}`,
          basename: file.name,
          kind: "file" as const,
        })),
        rejections: [],
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
    disableAutoComplete?: boolean;
    getKimiStatus?: (request: Record<string, unknown>) => Promise<unknown>;
    readAttachment?: () => Promise<Uint8Array>;
    workspaceDiff?: () => Promise<unknown>;
    withTimeline?: boolean;
  } = {},
) {
  const snapshot = baseSnapshot(options.threadWork ?? {});
  const authority = createFakeAppStateAuthority(snapshot, options.authorityOptions);
  installCarrentBridge(authority, snapshot, {
    authorityState: options.authorityState,
    disableAutoComplete: options.disableAutoComplete,
    getKimiStatus: options.getKimiStatus,
    readAttachment: options.readAttachment,
    workspaceDiff: options.workspaceDiff,
  });
  await mount(composerTree(undefined, options.threadId, options.withTimeline));
  return authority;
}

async function dispatchFileDrag(
  type: "dragenter" | "dragleave" | "dragover" | "drop",
  files: File[],
  types = ["Files"],
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files,
      items: files.map(() => ({ kind: "file" })),
      types,
    },
  });
  await act(async () => {
    container!.querySelector<HTMLElement>("[data-local-path-drop-surface]")!.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return event;
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

describe("Composer Local Path Context", () => {
  it("drops a file anywhere on the conversation surface, sends it separately, and renders a badge", async () => {
    await renderComposer({ withTimeline: true });
    const file = new File(["hello"], "My Notes (draft) [v2].md", { type: "text/markdown" });

    const enter = await dispatchFileDrag("dragenter", [file]);
    expect(enter.defaultPrevented).toBe(true);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).not.toBeNull();

    const drop = await dispatchFileDrag("drop", [file]);
    expect(drop.defaultPrevented).toBe(true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const card = container!.querySelector<HTMLElement>("[data-local-path-context-card]");
    expect(card?.textContent).toContain("My Notes (draft) [v2].md");
    expect(card?.textContent).toContain("File");
    expect(card?.getAttribute("title")).toBe("/Users/test/My Notes (draft) [v2].md");
    expect(card?.querySelector('[aria-label="Remove My Notes (draft) [v2].md"]')).not.toBeNull();

    await act(async () => {
      card?.querySelector<HTMLButtonElement>('[aria-label^="Reveal "]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(revealedPaths).toEqual(["/Users/test/My Notes (draft) [v2].md"]);

    await setComposerText("Review this file");
    await submitComposer();

    expect(sentChatRequests[0]?.message).toBe("Review this file");
    expect(sentChatRequests[0]?.localPathContexts).toEqual([
      {
        path: "/Users/test/My Notes (draft) [v2].md",
        basename: "My Notes (draft) [v2].md",
        kind: "file",
      },
    ]);
    expect(container!.querySelector("[data-local-path-context-card]")).toBeNull();

    const badge = container!.querySelector<HTMLElement>("[data-local-path-context-badge]");
    expect(badge?.textContent).toContain("My Notes (draft) [v2].md");
    expect(badge?.getAttribute("title")).toBe("/Users/test/My Notes (draft) [v2].md");
    // The badge sits below the message bubble, not inside it.
    expect(badge?.closest(".bg-user-bubble")).toBeNull();
    expect(container!.textContent).not.toContain("/Users/test/My Notes (draft) [v2].md");
    await act(async () => {
      badge?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(revealedPaths).toEqual([
      "/Users/test/My Notes (draft) [v2].md",
      "/Users/test/My Notes (draft) [v2].md",
    ]);
  });

  it("renders, sends, and reveals a dropped folder as folder context", async () => {
    await renderComposer({ withTimeline: true });
    window.carrent.localPaths.resolveDroppedItems = async () => ({
      items: [
        {
          path: "/Users/test/reference docs",
          basename: "reference docs",
          kind: "directory",
        },
      ],
      rejections: [],
    });

    await dispatchFileDrag("drop", [new File([], "reference docs")]);

    const card = container!.querySelector<HTMLElement>("[data-local-path-context-card]");
    expect(card?.textContent).toContain("reference docs");
    expect(card?.textContent).toContain("Folder");
    expect(card?.getAttribute("title")).toBe("/Users/test/reference docs");
    expect(card?.querySelector(".lucide-folder")).not.toBeNull();
    expect(card?.querySelector('[aria-label="Reveal reference docs in Finder"]')).not.toBeNull();
    expect(card?.querySelector('[aria-label="Remove reference docs"]')).not.toBeNull();

    await act(async () => {
      card?.querySelector<HTMLButtonElement>('[aria-label^="Reveal "]')?.click();
      await Promise.resolve();
    });
    expect(revealedPaths).toEqual(["/Users/test/reference docs"]);

    await setComposerText("Review these references");
    await submitComposer();

    expect(sentChatRequests[0]?.message).toBe("Review these references");
    expect(sentChatRequests[0]?.localPathContexts).toEqual([
      {
        path: "/Users/test/reference docs",
        basename: "reference docs",
        kind: "directory",
      },
    ]);
    const badge = container!.querySelector<HTMLElement>("[data-local-path-context-badge]");
    expect(badge?.textContent).toContain("reference docs");
    expect(badge?.textContent).toContain("Folder");
    expect(badge?.querySelector(".lucide-folder")).not.toBeNull();
    expect(container!.textContent).not.toContain("/Users/test/reference docs");

    await act(async () => {
      badge?.click();
      await Promise.resolve();
    });
    expect(revealedPaths).toEqual(["/Users/test/reference docs", "/Users/test/reference docs"]);
  });

  it("deduplicates within the current composition and removes a card independently", async () => {
    await renderComposer();
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });

    await dispatchFileDrag("drop", [file]);
    await dispatchFileDrag("drop", [file]);
    expect(container!.querySelectorAll("[data-local-path-context-card]")).toHaveLength(1);

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[aria-label="Remove notes.md"]')!.click();
    });
    expect(container!.querySelector("[data-local-path-context-card]")).toBeNull();
  });

  it("keeps the overlay active across nested dragenter and dragleave events", async () => {
    await renderComposer();
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });

    await dispatchFileDrag("dragenter", [file]);
    await dispatchFileDrag("dragenter", [file]);
    await dispatchFileDrag("dragleave", [file]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).not.toBeNull();

    await dispatchFileDrag("dragleave", [file]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).toBeNull();
  });

  it("restores Local Path Context cards from a persisted draft", async () => {
    const { drafts } = await renderAssociationDraft({
      content: "Review this",
      attachedSkillNames: [],
      attachments: [],
      localPathContexts: [
        {
          path: "/Users/test/notes.md",
          basename: "notes.md",
          kind: "file",
        },
      ],
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(container!.querySelector("[data-local-path-context-card]")?.textContent).toContain(
      "notes.md",
    );
    expect(drafts.at(-1)?.localPathContexts).toEqual([
      {
        path: "/Users/test/notes.md",
        basename: "notes.md",
        kind: "file",
      },
    ]);
  });

  it("drops a file into a new Thread Draft and persists it", async () => {
    const { drafts } = await renderAssociationDraft({
      content: "",
      attachedSkillNames: [],
      attachments: [],
    });
    const file = new File(["hello"], "draft-notes.md", { type: "text/markdown" });

    await dispatchFileDrag("drop", [file]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(drafts.at(-1)?.localPathContexts).toEqual([
      {
        path: "/Users/test/draft-notes.md",
        basename: "draft-notes.md",
        kind: "file",
      },
    ]);
  });

  it("persists a newly dropped path when the Thread Draft Composer unmounts before debounce", async () => {
    const attachment = {
      id: "existing-attachment",
      kind: "file" as const,
      name: "existing.txt",
      mimeType: "text/plain",
      size: 5,
      storageKey: "existing.txt",
    };
    const { drafts } = await renderAssociationDraft(
      {
        content: "",
        attachedSkillNames: ["tdd"],
        attachments: [attachment],
      },
      { readAttachment: () => new Promise<Uint8Array>(() => {}) },
    );

    await dispatchFileDrag("drop", [new File(["hello"], "draft-notes.md")]);
    await act(async () => {
      root!.unmount();
    });
    root = null;

    expect(drafts.at(-1)).toMatchObject({
      attachedSkillNames: ["tdd"],
      attachments: [attachment],
      localPathContexts: [
        {
          path: "/Users/test/draft-notes.md",
          basename: "draft-notes.md",
          kind: "file",
        },
      ],
    });
  });

  it("persists a newly dropped path when the Thread Composer unmounts before debounce", async () => {
    const attachment = {
      id: "existing-attachment",
      kind: "file" as const,
      name: "existing.txt",
      mimeType: "text/plain",
      size: 5,
      storageKey: "existing.txt",
    };
    await renderComposer({
      threadWork: {
        "thread-1": {
          draft: {
            content: "",
            attachedSkillNames: ["tdd"],
            attachments: [attachment],
          },
          queuedMessages: [],
        },
      },
      readAttachment: async () => {
        throw new Error("missing");
      },
    });

    await dispatchFileDrag("drop", [new File(["hello"], "thread-notes.md")]);
    await act(async () => {
      root!.unmount();
    });
    root = null;

    expect(getThreadDraft("thread-1")).toMatchObject({
      attachedSkillNames: ["tdd"],
      attachments: [attachment],
      localPathContexts: [
        {
          path: "/Users/test/thread-notes.md",
          basename: "thread-notes.md",
          kind: "file",
        },
      ],
    });
  });

  it("leaves text and URL drags untouched", async () => {
    await renderComposer();
    const browserImage = new File(["image"], "remote.png", { type: "image/png" });
    const event = await dispatchFileDrag(
      "dragover",
      [browserImage],
      ["Files", "text/uri-list", "text/html"],
    );

    expect(event.defaultPrevented).toBe(false);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).toBeNull();
  });

  it("shows one error toast and ignores a rejected local path", async () => {
    await renderComposer();
    window.carrent.localPaths.resolveDroppedItems = async () => ({
      items: [],
      rejections: [{ index: 0, reason: "unavailable" }],
    });

    await dispatchFileDrag("drop", [new File(["hello"], "missing.md")]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });

    const errorToasts = [...container!.querySelectorAll('[role="alert"]')].filter((alert) =>
      alert.textContent?.includes("One dropped item is not an available local file or folder."),
    );
    expect(errorToasts).toHaveLength(1);
    expect(container!.querySelector("[data-local-path-context-card]")).toBeNull();
  });

  it("preserves Local Path Context while a message waits in the live-run queue", async () => {
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
    await renderComposer({
      threadId,
      authorityState: { revision: 1, runs: [sharedRun] },
    });
    const file = new File(["hello"], "queued-notes.md", { type: "text/markdown" });

    await dispatchFileDrag("drop", [file]);
    await setComposerText("queued request");
    await submitComposer();

    expect(getQueuedMessages(threadId)[0]?.localPathContexts).toEqual([
      {
        path: "/Users/test/queued-notes.md",
        basename: "queued-notes.md",
        kind: "file",
      },
    ]);

    const completedEvent: ChatRunEvent = {
      type: "completed",
      runId: sharedRun.runId,
      requestKey: sharedRun.requestKey,
      text: "done",
      finishedAt: "2026-08-07T00:00:00.000Z",
    };
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

    expect(sentChatRequests[0]?.localPathContexts).toEqual([
      {
        path: "/Users/test/queued-notes.md",
        basename: "queued-notes.md",
        kind: "file",
      },
    ]);
  });

  it("authorizes Local Path Context retained in Thread history for a later Run", async () => {
    const threadId = "thread-1";
    await renderComposer({ threadId });
    const file = new File(["hello"], "historical-context.md", { type: "text/markdown" });

    await dispatchFileDrag("drop", [file]);
    await setComposerText("first request");
    await submitComposer();
    await act(async () => {
      emitChatEvent?.({
        type: "completed",
        runId: sentChatRunIds[0]!,
        text: "done",
        finishedAt: "2026-08-07T00:00:00.000Z",
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await setComposerText("follow up using the same context");
    await submitComposer();

    expect(sentChatRequests[1]?.localPathContexts).toEqual([
      {
        path: "/Users/test/historical-context.md",
        basename: "historical-context.md",
        kind: "file",
      },
    ]);

    await act(async () => {
      emitChatEvent?.({
        type: "completed",
        runId: sentChatRunIds[1]!,
        text: "done",
        finishedAt: "2026-08-07T00:00:01.000Z",
      });
    });
  });

  it("accepts a mixed multi-item drop in Finder order and wraps the cards", async () => {
    await renderComposer();
    window.carrent.localPaths.resolveDroppedItems = async () => ({
      items: [
        {
          path: "/Users/test/docs/references",
          basename: "references",
          kind: "directory" as const,
        },
        { path: "/Users/test/a/report.md", basename: "report.md", kind: "file" as const },
        { path: "/Users/test/b/report.md", basename: "report.md", kind: "file" as const },
        {
          path: "/Users/test/资料/设计 稿 (终版) [v3].png",
          basename: "设计 稿 (终版) [v3].png",
          kind: "file" as const,
        },
      ],
      rejections: [],
    });

    await dispatchFileDrag("drop", [
      new File([], "references"),
      new File([], "report.md"),
      new File([], "report.md"),
      new File([], "设计 稿 (终版) [v3].png"),
    ]);

    const cards = [...container!.querySelectorAll<HTMLElement>("[data-local-path-context-card]")];
    expect(cards.map((card) => card.getAttribute("title"))).toEqual([
      "/Users/test/docs/references",
      "/Users/test/a/report.md",
      "/Users/test/b/report.md",
      "/Users/test/资料/设计 稿 (终版) [v3].png",
    ]);
    // Duplicate basenames stay distinguishable through the full-path tooltip.
    expect(cards[1]!.textContent).toContain("report.md");
    expect(cards[2]!.textContent).toContain("report.md");
    expect(cards[1]!.getAttribute("title")).not.toBe(cards[2]!.getAttribute("title"));
    // The row wraps instead of overlapping or resizing the conversation layout.
    expect(cards[0]!.parentElement!.className).toContain("flex-wrap");
    expect(cards[0]!.className).toContain("max-w-full");
  });

  it("keeps valid items from a partially rejected drop and shows one error toast", async () => {
    await renderComposer();
    window.carrent.localPaths.resolveDroppedItems = async () => ({
      items: [
        { path: "/Users/test/kept.md", basename: "kept.md", kind: "file" as const },
        { path: "/Users/test/assets", basename: "assets", kind: "directory" as const },
      ],
      rejections: [{ index: 1, reason: "unavailable" as const }],
    });

    await dispatchFileDrag("drop", [
      new File([], "kept.md"),
      new File([], "missing.md"),
      new File([], "assets"),
    ]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });

    const cards = [...container!.querySelectorAll<HTMLElement>("[data-local-path-context-card]")];
    expect(cards.map((card) => card.getAttribute("title"))).toEqual([
      "/Users/test/kept.md",
      "/Users/test/assets",
    ]);
    const errorToasts = [...container!.querySelectorAll('[role="alert"]')].filter((alert) =>
      alert.textContent?.includes("One dropped item is not an available local file or folder."),
    );
    expect(errorToasts).toHaveLength(1);
  });

  it("ignores nested dragleave events from non-filesystem drags", async () => {
    await renderComposer();
    const file = new File([], "notes.md");

    await dispatchFileDrag("dragenter", [file]);
    await dispatchFileDrag("dragleave", [file], ["Files", "text/uri-list", "text/html"]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).not.toBeNull();

    await dispatchFileDrag("dragleave", [file]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).toBeNull();
  });

  it("clears a stuck overlay when the drag ends without a final dragleave", async () => {
    await renderComposer();
    const file = new File([], "notes.md");

    await dispatchFileDrag("dragenter", [file]);
    await dispatchFileDrag("dragenter", [file]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.querySelector("[data-local-path-drop-overlay]")).toBeNull();

    await dispatchFileDrag("dragenter", [file]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event("drop", { cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.querySelector("[data-local-path-drop-overlay]")).toBeNull();
  });

  it("exposes keyboard-focusable cards and badges with accessible names", async () => {
    await renderComposer({ withTimeline: true });
    window.carrent.localPaths.resolveDroppedItems = async () => ({
      items: [
        { path: "/Users/test/docs/handbook.md", basename: "handbook.md", kind: "file" as const },
      ],
      rejections: [],
    });

    await dispatchFileDrag("drop", [new File([], "handbook.md")]);

    const card = container!.querySelector<HTMLElement>("[data-local-path-context-card]")!;
    expect(card.getAttribute("title")).toBe("/Users/test/docs/handbook.md");
    // Kind is conveyed as text, not color alone.
    expect(card.textContent).toContain("File");

    const revealButton = card.querySelector<HTMLButtonElement>(
      '[aria-label="Reveal handbook.md in Finder"]',
    )!;
    const removeButton = card.querySelector<HTMLButtonElement>(
      '[aria-label="Remove handbook.md"]',
    )!;
    expect(revealButton.tabIndex).not.toBe(-1);
    expect(removeButton.tabIndex).not.toBe(-1);
    // Native buttons: Enter/Space activates them for keyboard users.
    expect(revealButton.type).toBe("button");
    expect(removeButton.type).toBe("button");

    await act(async () => {
      revealButton.focus();
    });
    expect(document.activeElement).toBe(revealButton);
    await act(async () => {
      removeButton.focus();
    });
    expect(document.activeElement).toBe(removeButton);

    await setComposerText("Check this");
    await submitComposer();

    const badge = container!.querySelector<HTMLElement>("[data-local-path-context-badge]")!;
    expect(badge.tagName).toBe("BUTTON");
    expect(badge.getAttribute("aria-label")).toBe("Reveal handbook.md in Finder");
    expect(badge.getAttribute("title")).toBe("/Users/test/docs/handbook.md");
  });

  it("routes dropped images to thumbnail attachments instead of Local Path Context", async () => {
    URL.createObjectURL = () => "blob:mock-preview";
    URL.revokeObjectURL = () => {};
    await renderComposer();
    const image = new File(["fake-png"], "carrent-usage.png", { type: "image/png" });
    const notes = new File(["hello"], "notes.md", { type: "text/markdown" });

    await dispatchFileDrag("drop", [image, notes]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });

    // The image becomes a thumbnail attachment with click-to-preview wiring.
    const thumbnail = container!.querySelector<HTMLElement>('img[alt="carrent-usage.png"]');
    expect(thumbnail).not.toBeNull();
    expect(thumbnail?.getAttribute("src")).toBe("blob:mock-preview");
    // The non-image file still becomes a Local Path Context card.
    const cards = [...container!.querySelectorAll<HTMLElement>("[data-local-path-context-card]")];
    expect(cards.map((card) => card.getAttribute("title"))).toEqual(["/Users/test/notes.md"]);
  });
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

  it("sends only one queued message per completed Run", async () => {
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
      await setComposerText("queued one");
      await submitComposer();
      await setComposerText("queued two");
      await submitComposer();
      expect(sentChatMessages).toEqual([]);
      expect(getQueuedMessages(threadId).map((item) => item.content)).toEqual([
        "queued one",
        "queued two",
      ]);

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
      const sentDeadline = Date.now() + 500;
      while (Date.now() < sentDeadline && sentChatMessages.length < 1) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
      // Let any erroneously admitted extra drain settle before asserting.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      // The completed run record lingers in the shared state; it must not
      // re-admit the drain effect and flush the rest of the queue.
      expect(sentChatMessages).toEqual(["queued one"]);
      expect(getQueuedMessages(threadId).map((item) => item.content)).toEqual(["queued two"]);
    } finally {
      const latestRunId = sentChatRunIds.at(-1);
      if (latestRunId) {
        await act(async () => {
          emitChatEvent?.({
            type: "completed",
            runId: latestRunId,
            text: "done",
            finishedAt: "2026-08-07T00:00:02.000Z",
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
      getQueuedMessages(threadId).forEach((item) => removeQueuedChatMessage(threadId, item.id));
    }
  });
  it("waits for workspace diff capture before sending the next queued message", async () => {
    const threadId = "thread-2";
    let resolveWorkspaceDiff!: (result: unknown) => void;
    await renderComposer({
      threadId,
      workspaceDiff: () =>
        new Promise((resolve) => {
          resolveWorkspaceDiff = resolve;
        }),
    });

    try {
      await setComposerText("first message");
      await submitComposer();
      await setComposerText("queued message");
      await submitComposer();

      await act(async () => {
        emitChatEvent?.({
          type: "completed",
          runId: sentChatRunIds[0]!,
          text: "done",
          writtenFiles: ["src/changed.ts"],
          finishedAt: "2026-08-07T00:00:00.000Z",
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(sentChatMessages).toEqual(["first message"]);

      resolveWorkspaceDiff({
        state: "ready",
        baseRevision: "base",
        capturedAt: "2026-08-07T00:00:00.000Z",
        projectRelativeRoot: ".",
        files: [
          {
            path: "src/changed.ts",
            additions: 1,
            deletions: 0,
            binary: false,
            untracked: false,
          },
        ],
        patch: "diff --git a/src/changed.ts b/src/changed.ts\n",
        truncated: false,
      });
      await waitForQueueFlush(threadId, 2);

      expect(sentChatMessages).toEqual(["first message", "queued message"]);
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

  it("waits for a pending workspace diff capture before sending a new message", async () => {
    const threadId = "thread-2";
    let resolveWorkspaceDiff!: (result: unknown) => void;
    await renderComposer({
      threadId,
      workspaceDiff: () =>
        new Promise((resolve) => {
          resolveWorkspaceDiff = resolve;
        }),
    });

    try {
      await setComposerText("first message");
      await submitComposer();

      await act(async () => {
        emitChatEvent?.({
          type: "completed",
          runId: sentChatRunIds[0]!,
          text: "done",
          writtenFiles: ["src/changed.ts"],
          finishedAt: "2026-08-07T00:00:00.000Z",
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(sentChatMessages).toEqual(["first message"]);

      // Send the next message manually while the previous Run's capture is
      // still in flight; it must wait so the Workspace Changes block lands
      // ahead of this turn's messages.
      await setComposerText("next message");
      await submitComposer();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(sentChatMessages).toEqual(["first message"]);

      resolveWorkspaceDiff({
        state: "ready",
        baseRevision: "base",
        capturedAt: "2026-08-07T00:00:00.000Z",
        projectRelativeRoot: ".",
        files: [
          {
            path: "src/changed.ts",
            additions: 1,
            deletions: 0,
            binary: false,
            untracked: false,
          },
        ],
        patch: "diff --git a/src/changed.ts b/src/changed.ts\n",
        truncated: false,
      });
      await waitForQueueFlush(threadId, 2);

      expect(sentChatMessages).toEqual(["first message", "next message"]);
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

  it("drains the queue after a Run completes even while a passive status refresh is in flight", async () => {
    const threadId = "thread-2";
    // The passive Kimi status refresh stays pending so the renderer's drain
    // effect runs while a status request is notionally active — the queue-drain
    // race that used to surface as a failed message.
    let resolveKimiStatus!: (value: unknown) => void;
    let kimiStatusCalls = 0;
    await renderComposer({
      threadId,
      getKimiStatus: () => {
        kimiStatusCalls += 1;
        return new Promise((resolve) => {
          resolveKimiStatus = resolve;
        });
      },
    });

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

      // The passive status refresh fired as part of completion, yet the queued
      // message was still sent — the drain is not blocked by the in-flight
      // status request.
      expect(kimiStatusCalls).toBeGreaterThan(0);
      expect(sentChatMessages).toEqual(["first message", "queued message"]);
      expect(getQueuedMessages(threadId)).toEqual([]);
    } finally {
      resolveKimiStatus?.(null);
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

describe("Composer streaming text reveal", () => {
  const threadId = "thread-1";

  let realRequestAnimationFrame: typeof window.requestAnimationFrame;
  let realCancelAnimationFrame: typeof window.cancelAnimationFrame;
  let frameCallbacks = new Map<number, FrameRequestCallback>();

  function stubAnimationFrames() {
    realRequestAnimationFrame = window.requestAnimationFrame;
    realCancelAnimationFrame = window.cancelAnimationFrame;
    frameCallbacks = new Map();
    let nextId = 1;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = nextId;
      nextId += 1;
      frameCallbacks.set(id, callback);
      return id;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) => {
      frameCallbacks.delete(id);
    }) as typeof window.cancelAnimationFrame;
  }

  function restoreAnimationFrames() {
    window.requestAnimationFrame = realRequestAnimationFrame;
    window.cancelAnimationFrame = realCancelAnimationFrame;
    frameCallbacks = new Map();
  }

  async function runAnimationFrame() {
    const callbacks = [...frameCallbacks.values()];
    frameCallbacks.clear();
    await act(async () => {
      callbacks.forEach((callback) => callback(0));
    });
  }

  async function runAllAnimationFrames() {
    let guard = 0;
    while (frameCallbacks.size > 0 && guard < 10_000) {
      await runAnimationFrame();
      guard += 1;
    }
  }

  function runEvent(event: Omit<ChatRunEvent, "runId" | "requestKey">): ChatRunEvent {
    return {
      ...event,
      runId: sentChatRunIds[0]!,
      requestKey: sentChatRequestKeys[0]!,
    } as ChatRunEvent;
  }

  function createAuthorityRunDriver() {
    let revision = 1;
    const events: ChatRunEvent[] = [];
    return {
      emit(
        event: ChatRunEvent,
        status: "running" | "completed" | "failed" | "cancelled" = "running",
      ) {
        events.push(event);
        emitChatAuthorityChange?.({
          baseRevision: revision,
          revision: revision + 1,
          run: {
            runId: sentChatRunIds[0]!,
            requestKey: sentChatRequestKeys[0]!,
            threadId,
            status,
            stopRequested: false,
            eventCount: events.length,
            events: [...events],
            pendingPermissions: [],
            pendingQuestions: [],
          },
          event,
        });
        revision += 1;
      },
    };
  }

  async function renderStreamingComposer() {
    await renderComposer({
      threadId,
      authorityState: { revision: 1, runs: [] },
      disableAutoComplete: true,
    });
    await setComposerText("stream please");
    await submitComposer();
    expect(sentChatMessages).toEqual(["stream please"]);
    stubAnimationFrames();
    return createAuthorityRunDriver();
  }

  afterEach(() => {
    restoreAnimationFrames();
  });

  it("does not reveal the whole chunk when its authoritative event is applied", async () => {
    const driver = await renderStreamingComposer();
    const chunk = "chunky streaming text ".repeat(10);

    await act(async () => {
      driver.emit(runEvent({ type: "delta", text: chunk }));
    });
    expect(latestAssistantMessage?.content.length ?? 0).toBeLessThan(chunk.length);

    await runAnimationFrame();
    expect(latestAssistantMessage?.content.length ?? 0).toBeGreaterThan(0);
    expect(latestAssistantMessage?.content.length ?? 0).toBeLessThan(chunk.length);

    await runAllAnimationFrames();
    expect(latestAssistantMessage?.content).toBe(chunk);
  });

  it("coalesces several deltas into one progressive step per frame", async () => {
    const driver = await renderStreamingComposer();
    const parts = ["alpha ".repeat(20), "beta ".repeat(20), "gamma ".repeat(20)];
    const fullText = parts.join("");

    await act(async () => {
      parts.forEach((part) => driver.emit(runEvent({ type: "delta", text: part })));
    });
    await runAnimationFrame();

    const visible = latestAssistantMessage?.content ?? "";
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(fullText.length);
    expect(fullText.startsWith(visible)).toBe(true);

    await runAllAnimationFrames();
    expect(latestAssistantMessage?.content).toBe(fullText);
  });

  it("flushes buffered text before agent activity parts appear", async () => {
    const driver = await renderStreamingComposer();
    const text = "the answer so far";

    await act(async () => {
      driver.emit(runEvent({ type: "delta", text }));
    });
    expect(latestAssistantMessage?.content).not.toBe(text);

    await act(async () => {
      driver.emit(
        runEvent({
          type: "reasoning",
          reasoning: { id: "reasoning-1", content: "thinking", status: "running" },
        }),
      );
    });
    expect(latestAssistantMessage?.content).toBe(text);

    await act(async () => {
      driver.emit(
        runEvent({ type: "completed", text, finishedAt: "2026-08-07T00:00:00.000Z" }),
        "completed",
      );
    });
    await runAllAnimationFrames();
    expect(latestAssistantMessage?.content).toBe(text);
  });

  it("completes the Run without waiting for the remaining text animation", async () => {
    const driver = await renderStreamingComposer();
    const text = "short final answer text";

    await act(async () => {
      driver.emit(runEvent({ type: "delta", text }));
      driver.emit(
        runEvent({ type: "completed", text, finishedAt: "2026-08-07T00:00:00.000Z" }),
        "completed",
      );
    });

    // The terminal state is applied immediately even though the reveal is
    // still animating within its catch-up ceiling.
    expect(latestAssistantMessage?.runStatus).toBe("completed");
    expect(latestAssistantMessage?.content.length ?? 0).toBeLessThan(text.length);

    await runAllAnimationFrames();
    expect(latestAssistantMessage?.content).toBe(text);
  });

  it("shows a huge remaining backlog immediately when the Run completes", async () => {
    const driver = await renderStreamingComposer();
    const text = "x".repeat(50_000);

    await act(async () => {
      driver.emit(
        runEvent({ type: "completed", text, finishedAt: "2026-08-07T00:00:00.000Z" }),
        "completed",
      );
    });

    expect(latestAssistantMessage?.content).toBe(text);
  });

  it("replaces buffered text atomically when a snapshot arrives", async () => {
    const driver = await renderStreamingComposer();
    const snapshotText = "authoritative replacement text";

    await act(async () => {
      driver.emit(runEvent({ type: "delta", text: "stale incremental text" }));
    });
    await act(async () => {
      driver.emit(runEvent({ type: "text-snapshot", text: snapshotText }));
    });

    expect(latestAssistantMessage?.content).toBe(snapshotText);

    await runAllAnimationFrames();
    expect(latestAssistantMessage?.content).toBe(snapshotText);

    await act(async () => {
      driver.emit(
        runEvent({
          type: "completed",
          text: snapshotText,
          finishedAt: "2026-08-07T00:00:00.000Z",
        }),
        "completed",
      );
    });
    await runAllAnimationFrames();
    expect(latestAssistantMessage?.content).toBe(snapshotText);
  });

  it("flushes all received text when the Run fails", async () => {
    const driver = await renderStreamingComposer();
    const text = "partial answer before the failure";

    await act(async () => {
      driver.emit(runEvent({ type: "delta", text }));
    });
    await act(async () => {
      driver.emit(runEvent({ type: "failed", error: "boom" }), "failed");
    });

    expect(latestAssistantMessage?.runStatus).toBe("failed");
    expect(latestAssistantMessage?.content).toBe(text);

    await runAllAnimationFrames();
    expect(latestAssistantMessage?.content).toBe(text);
  });

  it("flushes all received text when the Run is cancelled", async () => {
    const driver = await renderStreamingComposer();
    const text = "partial answer before the stop";

    await act(async () => {
      driver.emit(runEvent({ type: "delta", text }));
    });
    await act(async () => {
      driver.emit(runEvent({ type: "stopped" }), "cancelled");
    });

    expect(latestAssistantMessage?.runStatus).toBe("cancelled");
    expect(latestAssistantMessage?.content).toBe(text);
  });

  it("stops local reveal scheduling when the composer unmounts mid-animation", async () => {
    const driver = await renderStreamingComposer();
    const text = "answer that must survive unmount";

    await act(async () => {
      driver.emit(runEvent({ type: "delta", text }));
      driver.emit(
        runEvent({ type: "completed", text, finishedAt: "2026-08-07T00:00:00.000Z" }),
        "completed",
      );
    });
    expect(latestAssistantMessage?.content.length ?? 0).toBeLessThan(text.length);
    expect(frameCallbacks.size).toBeGreaterThan(0);

    await act(async () => {
      root!.unmount();
    });
    root = null;

    expect(frameCallbacks.size).toBe(0);
    await runAllAnimationFrames();
  });

  it("bounds visible commits to one per frame across the long-answer fixture", async () => {
    const driver = await renderStreamingComposer();
    const chunks = chunkStreamingAnswer(LONG_STREAMING_ANSWER);
    const chunksPerFrame = 2;

    const visibleSnapshots: string[] = [];
    let frames = 0;
    for (let i = 0; i < chunks.length; i += chunksPerFrame) {
      // Sample after every single delta: while Runtime deltas arrive inside
      // one animation frame nothing new may become visible. A regression to
      // per-delta synchronous commits would show up here immediately.
      let contentBeforeBatch: string | null = null;
      for (const chunk of chunks.slice(i, i + chunksPerFrame)) {
        await act(async () => {
          driver.emit(runEvent({ type: "delta", text: chunk }));
        });
        const content = latestAssistantMessage?.content ?? "";
        if (contentBeforeBatch === null) {
          contentBeforeBatch = content;
        } else {
          expect(content).toBe(contentBeforeBatch);
        }
      }
      await runAnimationFrame();
      frames += 1;
      visibleSnapshots.push(latestAssistantMessage?.content ?? "");
    }

    // Visible text only ever grows as a prefix of the authoritative answer.
    let visibleCommits = 0;
    let previous = "";
    for (const visible of visibleSnapshots) {
      expect(LONG_STREAMING_ANSWER.startsWith(visible)).toBe(true);
      expect(visible.length).toBeGreaterThanOrEqual(previous.length);
      if (visible !== previous) {
        visibleCommits += 1;
      }
      previous = visible;
    }
    expect(visibleCommits).toBeLessThanOrEqual(frames);

    await act(async () => {
      driver.emit(
        runEvent({
          type: "completed",
          text: LONG_STREAMING_ANSWER,
          finishedAt: "2026-08-07T00:00:00.000Z",
        }),
        "completed",
      );
    });
    // The terminal state is never delayed by the remaining reveal animation.
    expect(latestAssistantMessage?.runStatus).toBe("completed");

    await runAllAnimationFrames();
    expect(latestAssistantMessage?.content).toBe(LONG_STREAMING_ANSWER);

    // Deliberate baseline telemetry for the epic: compare future runs against
    // these counts to spot reveal regressions.
    console.log(
      `[streaming-baseline] deltas=${chunks.length} frames=${frames} visibleCommits=${visibleCommits}`,
    );
  });

  it("resynchronizes from a snapshot mid-stream without duplication or reordering", async () => {
    const driver = await renderStreamingComposer();
    const chunks = chunkStreamingAnswer(LONG_STREAMING_ANSWER);
    const half = Math.floor(chunks.length / 2);
    const firstHalf = chunks.slice(0, half).join("");

    await act(async () => {
      chunks.slice(0, half).forEach((chunk) => {
        driver.emit(runEvent({ type: "delta", text: chunk }));
      });
    });
    await runAnimationFrame();

    // The authority replaces the streamed text with a corrected snapshot.
    const corrected = firstHalf.replace("Streaming", "Checked");
    expect(corrected).not.toBe(firstHalf);
    const authoritativeAnswer = corrected + chunks.slice(half).join("");

    await act(async () => {
      driver.emit(runEvent({ type: "text-snapshot", text: corrected }));
    });
    expect(latestAssistantMessage?.content).toBe(corrected);

    // Sample visible text between the snapshot and completion: it must stay a
    // monotonically growing prefix of the authoritative answer — a duplicated
    // stale suffix would break the prefix property here, not just at the end.
    let previous = corrected;
    for (const chunk of chunks.slice(half)) {
      await act(async () => {
        driver.emit(runEvent({ type: "delta", text: chunk }));
      });
      // No new commit while the delta waits for its frame.
      expect(latestAssistantMessage?.content).toBe(previous);
      await runAnimationFrame();
      const visible = latestAssistantMessage?.content ?? "";
      expect(authoritativeAnswer.startsWith(visible)).toBe(true);
      expect(visible.length).toBeGreaterThanOrEqual(previous.length);
      previous = visible;
    }

    await act(async () => {
      driver.emit(
        runEvent({
          type: "completed",
          text: authoritativeAnswer,
          finishedAt: "2026-08-07T00:00:00.000Z",
        }),
        "completed",
      );
    });
    await runAllAnimationFrames();

    expect(latestAssistantMessage?.runStatus).toBe("completed");
    expect(latestAssistantMessage?.content).toBe(authoritativeAnswer);
  });

  it("keeps all received fixture text when a long stream is cancelled", async () => {
    const driver = await renderStreamingComposer();
    const chunks = chunkStreamingAnswer(LONG_STREAMING_ANSWER);
    const half = Math.floor(chunks.length / 2);
    const received = chunks.slice(0, half).join("");

    await act(async () => {
      chunks.slice(0, half).forEach((chunk) => {
        driver.emit(runEvent({ type: "delta", text: chunk }));
      });
    });
    await runAnimationFrame();
    expect(latestAssistantMessage?.content.length ?? 0).toBeLessThan(received.length);

    await act(async () => {
      driver.emit(runEvent({ type: "stopped" }), "cancelled");
    });

    expect(latestAssistantMessage?.runStatus).toBe("cancelled");
    expect(latestAssistantMessage?.content).toBe(received);

    await runAllAnimationFrames();
    expect(latestAssistantMessage?.content).toBe(received);
  });
});
