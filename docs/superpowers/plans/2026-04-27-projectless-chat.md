# Projectless Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Chat` area under `Projects` for agent conversations that are not tied to any local project folder.

**Architecture:** Keep real projects in `projects` and add a separate persisted `chats` thread collection. Renderer routes project chats through `/thread/:projectId/:threadId` and projectless chats through `/chat/:threadId`. Main process runs projectless provider CLIs from an app-managed safe working directory instead of borrowing any project path.

**Tech Stack:** Electron main/preload, React renderer, React Router, Bun tests, existing JSON workspace persistence.

---

## File Structure

- Modify `apps/desktop/src/renderer/mock/uiShellData.ts`
  - Export a reusable `ThreadRecord` already exists; add no project-specific fields to it.
- Modify `apps/desktop/src/shared/chat.ts`
  - Add a discriminated workspace scope to `ChatTurnRequest`.
- Modify `apps/desktop/electron/chat/chatPrompt.ts`
  - Render project context for project chats and no-project context for projectless chats.
- Modify `apps/desktop/electron/chat/chatSessionManager.ts`
  - Resolve safe `cwd` from request scope and use it for spawn/session keys.
- Modify `apps/desktop/electron/chat/chatRunner.ts`
  - Keep non-stream runner compatible with the new `cwd` resolver.
- Modify `apps/desktop/src/shared/workspacePersistence.ts`
  - Persist `chats` with backward-compatible normalization.
- Modify `apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.ts`
  - Include `chats` in snapshots.
- Modify `apps/desktop/src/renderer/context/WorkspaceContext.tsx`
  - Add `chats`, projectless thread helpers, route resolver, and active thread handling.
- Modify `apps/desktop/src/renderer/components/SidebarNav.tsx`
  - Add `Chat` section below `Projects` with create/open/archive/pin actions.
- Create `apps/desktop/src/renderer/routes/ChatPage.tsx`
  - Render projectless chat thread timeline and composer.
- Modify `apps/desktop/src/renderer/App.tsx`
  - Add `/chat/:threadId` route.
- Modify `apps/desktop/src/renderer/components/chat/Composer.tsx`
  - Add `mode: "chat"` and send projectless requests.
- Modify `apps/desktop/src/renderer/hooks/useChatRun.ts`
  - Should not require changes unless request key assumptions include project.
- Modify tests near touched files:
  - `apps/desktop/electron/chat/chatPrompt.test.ts`
  - `apps/desktop/electron/chat/chatSessionManager.test.ts`
  - `apps/desktop/src/shared/workspacePersistence.test.ts`
  - `apps/desktop/src/renderer/context/WorkspaceContext.test.ts`
  - `apps/desktop/src/renderer/components/SidebarNav.test.ts`
  - `apps/desktop/src/renderer/routes/ThreadPage.test.ts` or new `ChatPage.test.ts`

## Data Model

Use a discriminated request scope:

```ts
export type ChatWorkspaceScope =
  | { kind: "project"; projectPath: string; projectId: string }
  | { kind: "chat" };

export interface ChatTurnRequest {
  requestKey?: string;
  workspace: ChatWorkspaceScope;
  threadId: string;
  draftRef?: {
    draftId: string;
    projectId: string;
    title: string;
  };
  runtimeId: RuntimeId;
  agent: {
    id: string;
    name: string;
    responsibility: string;
  };
  transcript: Array<{
    role: "user" | "assistant";
    content: string;
    agentId?: string;
  }>;
  message: string;
}
```

Workspace snapshot adds:

```ts
export type WorkspaceSnapshot = {
  version: 1;
  projects: ProjectRecord[];
  chats: ThreadRecord[];
  messages: Message[];
  activeThreadId: string | null;
  drafts: DraftThreadRecord[];
  agents?: AgentRecord[];
};
```

Do not increment `WORKSPACE_SNAPSHOT_VERSION` for this change. Treat missing `chats` as `[]` in `normalizeWorkspaceSnapshot()` so existing users keep their data.

## Task 1: Shared Request Scope

**Files:**
- Modify: `apps/desktop/src/shared/chat.ts`
- Modify: `apps/desktop/electron/chat/chatPrompt.ts`
- Test: `apps/desktop/electron/chat/chatPrompt.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Add tests:

```ts
it("includes project context for project chats", () => {
  const prompt = buildChatPrompt(
    makeRequest({
      workspace: {
        kind: "project",
        projectId: "carrent",
        projectPath: "/Users/onion/workbench/carrent",
      },
    }),
  );

  expect(prompt).toContain("Project: /Users/onion/workbench/carrent");
});

it("includes no-project context for chat-only threads", () => {
  const prompt = buildChatPrompt(
    makeRequest({
      workspace: { kind: "chat" },
    }),
  );

  expect(prompt).toContain("Context: General chat. No project folder is selected.");
  expect(prompt).not.toContain("Project:");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bun test apps/desktop/electron/chat/chatPrompt.test.ts
```

Expected: TypeScript/test failure because `workspace` does not exist.

- [ ] **Step 3: Implement request scope**

In `apps/desktop/src/shared/chat.ts`, replace top-level `projectPath: string` with `workspace: ChatWorkspaceScope`.

In tests, update existing `makeRequest()` helpers from:

```ts
projectPath: "/Users/onion/workbench/timbre",
```

to:

```ts
workspace: {
  kind: "project",
  projectId: "timbre",
  projectPath: "/Users/onion/workbench/timbre",
},
```

In `chatPrompt.ts`, change prompt setup to:

```ts
const contextLine =
  request.workspace.kind === "project"
    ? `Project: ${request.workspace.projectPath}`
    : "Context: General chat. No project folder is selected.";
```

- [ ] **Step 4: Run tests**

Run:

```bash
bun test apps/desktop/electron/chat/chatPrompt.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/chat.ts apps/desktop/electron/chat/chatPrompt.ts apps/desktop/electron/chat/chatPrompt.test.ts
git commit -m "feat(desktop): add chat workspace scope"
```

## Task 2: Main Process Safe CWD

**Files:**
- Modify: `apps/desktop/electron/chat/chatSessionManager.ts`
- Modify: `apps/desktop/electron/chat/chatRunner.ts`
- Test: `apps/desktop/electron/chat/chatSessionManager.test.ts`
- Test: `apps/desktop/electron/chat/chatRunner.test.ts`

- [ ] **Step 1: Write failing manager tests**

Add coverage:

```ts
it("accepts projectless chat requests", () => {
  manager.start("run-chat", makeRequest({ workspace: { kind: "chat" } }));

  expect(events.some((event) => event.type === "failed")).toBe(false);
  expect(spawnCalls[0]?.options.cwd).toContain("carrent-chat");
});

it("separates provider session keys for project and chat scopes", () => {
  const project = makeRequest({
    workspace: {
      kind: "project",
      projectId: "carrent",
      projectPath: "/Users/onion/workbench/carrent",
    },
  });
  const chat = makeRequest({ workspace: { kind: "chat" } });

  expect(buildRequestSessionKey(project)).not.toBe(buildRequestSessionKey(chat));
});
```

If `buildRequestSessionKey` is not exported, either test through `providerSessions.get()` keys or export it only if existing test style already exports internals.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bun test apps/desktop/electron/chat/chatSessionManager.test.ts
```

Expected: failure because projectless requests are rejected or `cwd` is undefined.

- [ ] **Step 3: Add cwd resolver**

In `chatSessionManager.ts`, add a small resolver near session key helpers:

```ts
const PROJECTLESS_CHAT_CWD = path.join(app.getPath("userData"), "carrent-chat");

function resolveRequestCwd(request: ChatTurnRequest) {
  return request.workspace.kind === "project"
    ? request.workspace.projectPath
    : PROJECTLESS_CHAT_CWD;
}
```

Use `fs.mkdirSync(PROJECTLESS_CHAT_CWD, { recursive: true })` before spawning a projectless request.

If importing `app` directly makes tests awkward, inject `resolveChatCwd?: (request) => string` into `createChatSessionManager()` with a default implementation in production. Prefer injection if tests currently avoid Electron imports.

- [ ] **Step 4: Replace project path validation**

Replace:

```ts
if (!request.projectPath) {
  // failed
}
```

with:

```ts
if (request.workspace.kind === "project" && !request.workspace.projectPath) {
  // failed: Project path is missing. Select a project to chat.
}
```

Projectless chat must not fail this validation.

- [ ] **Step 5: Update session key**

Use scope-specific keys:

```ts
function buildRequestSessionKey(request: ChatTurnRequest) {
  const scope =
    request.workspace.kind === "project"
      ? `project:${request.workspace.projectPath}`
      : "chat";

  return `${request.runtimeId}:${scope}:${request.threadId}:${request.agent.id}`;
}
```

- [ ] **Step 6: Update spawn cwd**

Replace:

```ts
cwd: request.projectPath,
```

with:

```ts
cwd: resolveRequestCwd(request),
```

- [ ] **Step 7: Update chat runner**

Apply the same cwd resolution in `chatRunner.ts` for consistency. If `chatRunner` is unused legacy code, still keep it compiling with `ChatTurnRequest`.

- [ ] **Step 8: Run tests**

Run:

```bash
bun test apps/desktop/electron/chat/chatSessionManager.test.ts apps/desktop/electron/chat/chatRunner.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/electron/chat/chatSessionManager.ts apps/desktop/electron/chat/chatSessionManager.test.ts apps/desktop/electron/chat/chatRunner.ts apps/desktop/electron/chat/chatRunner.test.ts
git commit -m "feat(desktop): run projectless chat in safe cwd"
```

## Task 3: Persist Chat Threads

**Files:**
- Modify: `apps/desktop/src/shared/workspacePersistence.ts`
- Modify: `apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.ts`
- Test: `apps/desktop/src/shared/workspacePersistence.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Add:

```ts
it("normalizes snapshots without chats as an empty list", () => {
  const snapshot = normalizeWorkspaceSnapshot({
    version: 1,
    projects: [],
    messages: [],
    activeThreadId: null,
    drafts: [],
  });

  expect(snapshot?.chats).toEqual([]);
});

it("rejects snapshots with invalid chats", () => {
  expect(
    normalizeWorkspaceSnapshot({
      version: 1,
      projects: [],
      chats: "bad",
      messages: [],
      activeThreadId: null,
      drafts: [],
    }),
  ).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bun test apps/desktop/src/shared/workspacePersistence.test.ts
```

Expected: failure because `chats` is absent from the type/normalizer.

- [ ] **Step 3: Add `chats` to snapshot**

Import `ThreadRecord` and add `chats: ThreadRecord[]` to `WorkspaceSnapshot`.

Normalize with:

```ts
const chats = value.chats === undefined ? [] : value.chats;
if (!Array.isArray(chats)) return null;

return {
  ...(value as WorkspaceSnapshot),
  chats,
};
```

- [ ] **Step 4: Update snapshot builder**

In `useDebouncedWorkspaceSave.ts`, add `chats` to function input and output.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test apps/desktop/src/shared/workspacePersistence.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/workspacePersistence.ts apps/desktop/src/shared/workspacePersistence.test.ts apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.ts
git commit -m "feat(desktop): persist projectless chat threads"
```

## Task 4: Workspace State Helpers

**Files:**
- Modify: `apps/desktop/src/renderer/context/WorkspaceContext.tsx`
- Modify: `apps/desktop/src/renderer/lib/workspaceState.ts`
- Test: `apps/desktop/src/renderer/context/WorkspaceContext.test.ts`

- [ ] **Step 1: Write failing pure helper tests**

Add tests for:

```ts
createChatThread("Product vision")
upsertChatThread(existingChats, thread)
toggleChatThreadPin(existingChats, threadId)
archiveChatThread(existingChats, activeThreadId)
resolveChatThreadRouteData(chats, messages, threadId)
```

Expected behaviors:

```ts
expect(createChatThread("  Product vision  ")?.title).toBe("Product vision");
expect(createChatThread("   ")).toBeNull();
expect(resolveChatThreadRouteData(chats, messages, "chat-1")?.messages).toEqual([
  expect.objectContaining({ threadId: "chat-1" }),
]);
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bun test apps/desktop/src/renderer/context/WorkspaceContext.test.ts
```

Expected: failure because helpers do not exist.

- [ ] **Step 3: Implement chat state**

In `WorkspaceContextValue`, add:

```ts
chats: ThreadRecord[];
getChatRouteData: (threadId: string) => {
  thread: ThreadRecord;
  messages: Message[];
} | null;
createChat: (title: string) => ThreadRecord | null;
upsertChat: (thread: ThreadRecord) => void;
toggleChatPin: (threadId: string) => void;
archiveChat: (threadId: string) => string | null;
```

In provider state:

```ts
const [chats, setChats] = useState<ThreadRecord[]>([]);
```

Hydration:

```ts
setChats(snapshot.chats ?? []);
```

Seed fallback:

```ts
setChats([]);
```

Snapshot:

```ts
buildWorkspaceSnapshot({ projects, chats, messages, activeThreadId, drafts, agents })
```

- [ ] **Step 4: Implement helper logic**

Either add small focused helpers in `workspaceState.ts` or keep pure exported helpers in `WorkspaceContext.tsx` if that matches existing test style. Reuse `ThreadRecord` shape and `formatRelativeTime` conventions.

Use `updatedAt: new Date().toISOString()` for new chat threads, matching recent persistence behavior.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test apps/desktop/src/renderer/context/WorkspaceContext.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/context/WorkspaceContext.tsx apps/desktop/src/renderer/lib/workspaceState.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts
git commit -m "feat(desktop): add projectless chat state"
```

## Task 5: Chat Route

**Files:**
- Create: `apps/desktop/src/renderer/routes/ChatPage.tsx`
- Create: `apps/desktop/src/renderer/routes/ChatPage.test.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [ ] **Step 1: Write failing route tests**

Test pure resolver:

```ts
it("returns null without a thread id", () => {
  expect(resolveChatRouteData(() => null)).toBeNull();
});

it("returns chat route data for a thread id", () => {
  expect(resolveChatRouteData(getChatRouteData, "chat-1")?.thread.id).toBe("chat-1");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bun test apps/desktop/src/renderer/routes/ChatPage.test.ts
```

Expected: failure because file does not exist.

- [ ] **Step 3: Create page**

Implement:

```tsx
export function ChatPage() {
  const { threadId } = useParams();
  const { getChatRouteData, setActiveThreadId } = useWorkspace();
  const routeData = resolveChatRouteData(getChatRouteData, threadId);

  useEffect(() => {
    setActiveThreadId(routeData?.thread.id ?? null);
  }, [routeData?.thread.id, setActiveThreadId]);

  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader title={routeData?.thread.title ?? "Chat not found"} />
      <MessageTimeline messages={routeData?.messages ?? []} />
      {routeData ? (
        <Composer mode="chat" threadId={routeData.thread.id} messages={routeData.messages} />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Register route**

In `App.tsx` add:

```tsx
<Route element={<ChatPage />} path="/chat/:threadId" />
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test apps/desktop/src/renderer/routes/ChatPage.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/routes/ChatPage.tsx apps/desktop/src/renderer/routes/ChatPage.test.ts apps/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): add projectless chat route"
```

## Task 6: Sidebar Chat Section

**Files:**
- Modify: `apps/desktop/src/renderer/components/SidebarNav.tsx`
- Modify: `apps/desktop/src/renderer/components/SidebarNav.test.ts`

- [ ] **Step 1: Write failing path tests**

Add:

```ts
expect(buildChatPath("chat-1")).toBe("/chat/chat-1");
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bun test apps/desktop/src/renderer/components/SidebarNav.test.ts
```

Expected: failure because `buildChatPath` does not exist.

- [ ] **Step 3: Add path helper**

```ts
export function buildChatPath(threadId: string) {
  return `/chat/${threadId}`;
}
```

- [ ] **Step 4: Add `Chat` section below `Projects`**

Use existing sidebar styles. Structure:

```tsx
<div className="flex flex-col shrink-0">
  <div className="flex items-center justify-between px-4 py-1.5">
    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#666]">
      Chat
    </span>
    <button title="New chat">...</button>
  </div>
  <div className="px-2 pb-2">
    {chats.map(...)}
  </div>
</div>
```

New chat behavior:

```ts
const thread = createChat("New chat");
if (thread) {
  navigate(buildChatPath(thread.id));
}
```

Thread click:

```ts
setActiveThreadId(thread.id);
navigate(buildChatPath(thread.id));
```

Menu actions:

```ts
toggleChatPin(thread.id);
archiveChat(thread.id);
```

Keep project menu actions project-only.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test apps/desktop/src/renderer/components/SidebarNav.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/SidebarNav.tsx apps/desktop/src/renderer/components/SidebarNav.test.ts
git commit -m "feat(desktop): add sidebar chat section"
```

## Task 7: Composer Projectless Mode

**Files:**
- Modify: `apps/desktop/src/renderer/components/chat/Composer.tsx`
- Test: existing composer-related tests if present, otherwise `bun test apps/desktop/src/renderer/components/chat`

- [ ] **Step 1: Write failing type/behavior test**

If there is an existing Composer test harness, assert that chat mode can send without a project. If not, rely on TypeScript and add focused pure helper tests only if extracting a helper is cleaner.

Target behavior:

```ts
const canSend = mode === "chat"
  ? !!input.trim() && !!selectedAgent
  : !!input.trim() && !!project && !!selectedAgent;
```

- [ ] **Step 2: Update props**

Change `ComposerProps` to include:

```ts
| {
    mode: "chat";
    threadId: string;
    messages: Message[];
  }
```

Derive project only for project/draft:

```ts
const projectId = props.mode === "chat" ? null : props.projectId;
const project = projectId ? projects.find((item) => item.id === projectId) ?? null : null;
```

- [ ] **Step 3: Route local message writes**

For `mode === "chat"`, use normal workspace message writes:

```ts
if (props.mode === "thread" || props.mode === "chat") {
  return appendMessage({ threadId, role, agentId, content });
}
```

Same for `updateLocalMessage`, text parts, reasoning parts, and shell parts.

- [ ] **Step 4: Send scoped request**

Build request:

```ts
workspace:
  props.mode === "chat"
    ? { kind: "chat" }
    : {
        kind: "project",
        projectId: props.projectId,
        projectPath: project.path,
      },
```

Keep `draftRef` only for draft mode.

- [ ] **Step 5: Update chat title after first user message**

If `mode === "chat"` and thread title is `"New chat"`, update it to first message preview via `upsertChat()`. Keep this minimal; no AI title generation.

- [ ] **Step 6: Run targeted tests**

Run:

```bash
bun test apps/desktop/src/renderer/components/chat apps/desktop/src/renderer/hooks/useChatRun.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/chat/Composer.tsx
git commit -m "feat(desktop): send projectless chat requests"
```

## Task 8: Update Remaining Request Call Sites

**Files:**
- Modify any tests or runtime files found by `rg "projectPath" apps/desktop`

- [ ] **Step 1: Find stale usage**

Run:

```bash
rg -n "projectPath|request\\.workspace|workspace:" apps/desktop
```

Expected: no production code should read `request.projectPath`.

- [ ] **Step 2: Update IPC tests**

Update:

```ts
apps/desktop/electron/chat/chatIpc.test.ts
apps/desktop/electron/chat/chatRunner.test.ts
apps/desktop/electron/chat/chatSessionManager.test.ts
```

All `makeRequest()` helpers should use `workspace.kind === "project"` unless explicitly testing projectless chat.

- [ ] **Step 3: Run chat tests**

Run:

```bash
bun test apps/desktop/electron/chat apps/desktop/src/renderer/hooks/useChatRun.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron/chat apps/desktop/src/renderer/hooks/useChatRun.test.ts
git commit -m "test(desktop): update chat request scope coverage"
```

## Task 9: End-to-End Verification

**Files:**
- No planned source changes unless verification finds issues.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun test apps/desktop/electron apps/desktop/src
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: all workspace typechecks pass.

- [ ] **Step 3: Run lint**

Run:

```bash
bun run lint
```

Expected: 0 errors and no new warnings.

- [ ] **Step 4: Run build**

Run:

```bash
bun run build
```

Expected: desktop and landing builds pass.

- [ ] **Step 5: Check diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Only intended files changed.

- [ ] **Step 6: Manual QA**

Run:

```bash
bun run dev:desktop
```

Verify:

- A `Chat` section appears below `Projects`.
- New chat creates a `/chat/:threadId` route.
- Sending a message in `/chat/:threadId` does not require a project.
- Agent response streams, reasoning blocks still render, shell blocks still render collapsed.
- Stop button only stops the active chat thread run.
- Project threads still send with project context.
- Claude resume does not collide between project thread and projectless chat with same thread id.
- Restart app and confirm projectless chat thread/messages persist.

- [ ] **Step 7: Final commit if verification fixes were needed**

```bash
git add <changed-files>
git commit -m "fix(desktop): verify projectless chat flow"
```

## Notes

- Do not store projectless chats inside `projects`; it will make project-only UI actions leak into general chat.
- Do not spawn provider CLIs without a deterministic `cwd`.
- Do not use a random existing project path as the projectless chat `cwd`.
- Keep draft threads project-only for this iteration. If users later need drafts under `Chat`, add that separately.
- Keep the title simple: first user message preview is enough for now.
