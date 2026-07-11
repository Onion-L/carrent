# Plan 003: Make thread and project deletion remove owned data

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When done, update
> this plan's row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `git diff --stat eb5b839..HEAD -- apps/desktop/src/shared/chat.ts apps/desktop/src/renderer/context/WorkspaceContext.tsx apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/renderer/components/SidebarNav.tsx apps/desktop/src/renderer/components/chat/ThreadHistoryPane.tsx apps/desktop/src/renderer/env.d.ts apps/desktop/electron/preload.ts apps/desktop/electron/main.ts apps/desktop/electron/chat/chatIpc.ts apps/desktop/electron/chat/chatIpc.test.ts apps/desktop/electron/chat/chatSessionManager.ts apps/desktop/electron/chat/chatSessionManager.test.ts apps/desktop/electron/chat/providerSessionStore.ts apps/desktop/electron/chat/providerSessionStore.test.ts apps/desktop/electron/attachments/attachmentStore.ts apps/desktop/electron/attachments/attachmentStore.test.ts`
> If an in-scope file changed, compare the Current state excerpts with live
> code. A semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: bug, security, tests
- **Planned at**: commit `eb5b839`, 2026-07-11

## Why this matters

The UI calls thread and project removal permanent, but only navigation records
are removed. Messages remain in `workspace.json`, image files remain in app
data, and provider-session mappings remain available for resume. Users therefore
cannot rely on deletion to remove conversation data, and disk use grows with
every deleted attachment. Deletion must cover all Carrent-owned data or fail
without hiding the thread.

## Current state

- `apps/desktop/src/renderer/context/WorkspaceContext.tsx:373-375`, `:458-471`
  only update `projects` or `chats`; they never update `messages` or call a
  cleanup IPC:

```ts
const deleteChat = (threadId: string) => {
  setChats((prev) => deleteChatThread(prev, threadId));
};
const deleteThread = (projectId: string, threadId: string) => {
  const result = deleteThreadInProjects(projects, projectId, threadId);
  setProjects(result.projects);
};
```

- `apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.ts:16-22` persists
  the complete `messages` array, including messages whose thread record is gone.
- ADR `docs/adr/0003-store-image-attachments-for-history-and-agent-access.md`
  says attachment files are retained while their messages remain and defers
  expiry until deletion semantics exist. Permanent deletion now exists, so this
  deferred cleanup condition has been reached.
- `apps/desktop/electron/attachments/attachmentStore.ts:7-15` exposes store,
  read, and resolve only; there is no validated delete operation.
- `apps/desktop/electron/chat/providerSessionStore.ts:21-40` serializes set and
  single-key delete operations. Preserve that write queue so deletion cannot
  race a session save and restore stale keys.
- Provider session keys end with `:<threadId>` by construction in
  `chatSessionManager.ts:569-574`. Runtime changes can leave more than one key
  for a thread, so cleanup must remove every matching key, not only the current
  runtime's key.
- `ThreadHistoryPane.tsx:57-75` reports success immediately after synchronous
  renderer deletion. Change it to report success only after persistent cleanup.
- Tests use pure helper assertions in `WorkspaceContext.test.ts`, temporary
  directories in `attachmentStore.test.ts`, and injected stores/transports in
  chat tests. Match those patterns.
- Preserve the unrelated user change in
  `apps/desktop/src/renderer/lib/runtimeModelsCache.ts`.

## Commands you will need

| Purpose       | Command                                                                                                                                                                                                                                                          | Expected on success             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Focused tests | `bun test apps/desktop/electron/attachments apps/desktop/electron/chat/providerSessionStore.test.ts apps/desktop/electron/chat/chatIpc.test.ts apps/desktop/electron/chat/chatSessionManager.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts` | all selected tests pass         |
| Full tests    | `bun test`                                                                                                                                                                                                                                                       | all existing and new tests pass |
| Typecheck     | `bun run typecheck`                                                                                                                                                                                                                                              | exit 0                          |
| Lint          | `bun run lint`                                                                                                                                                                                                                                                   | exit 0, no findings             |

## Scope

**In scope**:

- `apps/desktop/src/shared/chat.ts`
- `apps/desktop/src/renderer/context/WorkspaceContext.tsx`
- `apps/desktop/src/renderer/context/WorkspaceContext.test.ts`
- `apps/desktop/src/renderer/components/SidebarNav.tsx`
- `apps/desktop/src/renderer/components/chat/ThreadHistoryPane.tsx`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/chat/chatIpc.ts`
- `apps/desktop/electron/chat/chatIpc.test.ts`
- `apps/desktop/electron/chat/chatSessionManager.ts`
- `apps/desktop/electron/chat/chatSessionManager.test.ts`
- `apps/desktop/electron/chat/providerSessionStore.ts`
- `apps/desktop/electron/chat/providerSessionStore.test.ts`
- `apps/desktop/electron/attachments/attachmentStore.ts`
- `apps/desktop/electron/attachments/attachmentStore.test.ts`
- `apps/desktop/src/renderer/env.d.ts` if the preload type is declared there

**Out of scope**:

- Deleting files in the user's project.
- Deleting Kimi-owned session files; only remove Carrent's resume mapping.
- General attachment expiry, quotas, or deduplication.
- Changing workspace snapshot version or migrating unrelated orphan data.
- Adding a chat-delete UI; make the existing context method correct, but do not
  add a new surface.
- `apps/desktop/src/renderer/lib/runtimeModelsCache.ts`.

## Git workflow

- Branch: `codex/plan-003-delete-owned-thread-data`
- Suggested commit: `fix(desktop): delete thread-owned persisted data`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add validated attachment and session cleanup primitives

Add `deleteAttachments(storageKeys: string[])` to `AttachmentStore`. Validate
every key with the existing safe-key function before deleting anything. Delete
with `unlink`; ignore `ENOENT` so retries are idempotent, but propagate other
filesystem errors. Deduplicate keys before I/O.

Extend `ProviderSessionStore` with a bulk thread cleanup operation. In the
persistent implementation, enqueue one write that removes every key ending in
`:<threadId>` for the requested thread IDs. Update the in-memory snapshot only
after `saveProviderSessions` succeeds, matching existing set/delete semantics.
Use exact delimiter-aware suffix matching; plain `endsWith(threadId)` is not
safe enough.

Add tests for valid deletion, missing attachment idempotency, traversal-key
rejection before any delete, multiple runtime/scope session keys for one thread,
unrelated session preservation, and persistence failure preserving memory.

**Verify**: `bun test apps/desktop/electron/attachments/attachmentStore.test.ts apps/desktop/electron/chat/providerSessionStore.test.ts`
-> all tests pass.

### Step 2: Add one main-process thread-data deletion operation

Define a shared request with bounded arrays of non-empty `threadIds` and
`attachmentStorageKeys`. Add one IPC method, preferably under the existing chat
service because it owns provider sessions and the attachment store. Validate
the request in `chatIpc.ts`; do not rely on TypeScript casts at the IPC boundary.
Expose only this method through preload.

Add `deleteThreadData(request)` to `ChatSessionManager`. It must:

1. Mark requested thread IDs as deleted for the lifetime of the manager.
2. Stop any active CLI or Kimi runs for those threads.
3. Remove matching entries from both `runtimeSessions` and the persistent
   provider-session store.
4. Delete the validated attachment keys.
5. Prevent a stopped/late-completing run from re-persisting a provider session
   for a deleted thread.

Track the thread ID alongside active run handles rather than guessing it from a
run ID. Preserve existing `started`, `stopped`, and `failed` event behavior. The
operation must be idempotent so a user can retry after a renderer interruption.

Add chat manager and IPC tests for malformed input, two runtimes for one thread,
unrelated sessions, active-run stop, and a late completion that attempts to
persist after deletion.

**Verify**: `bun test apps/desktop/electron/chat/chatIpc.test.ts apps/desktop/electron/chat/chatSessionManager.test.ts`
-> all selected tests pass.

### Step 3: Prune renderer state only after persistent cleanup succeeds

Add pure helpers in `WorkspaceContext.tsx` (or an existing local workspace
module if no new abstraction is needed) to collect:

- all thread IDs owned by a deleted project/chat/thread;
- all unique attachment storage keys from messages in those threads;
- remaining messages whose `threadId` is not being deleted.

Change `deleteThread`, `deleteChat`, and `removeProject` to await the preload
cleanup operation before mutating projects/chats/messages. If cleanup rejects,
leave visible state unchanged and propagate the error to the caller. On success,
clear or select `activeThreadId` consistently when its owner was deleted.

Update `ThreadHistoryPane` to await deletion and show the success toast only on
success; show an error toast on failure. Update project deletion in `SidebarNav`
the same way and navigate away if the current project was removed. Keep the
existing confirmation for project deletion.

Add pure tests covering thread deletion, chat deletion, whole-project deletion,
unrelated messages, duplicate attachment references, and the failure path that
preserves renderer state.

**Verify**: `bun test apps/desktop/src/renderer/context/WorkspaceContext.test.ts`
-> all tests pass with the new pruning cases.

### Step 4: Run full gates and inspect ownership boundaries

Run full verification. Review the final diff for any deletion outside Carrent's
app-data attachment directory or provider-session snapshot; none is allowed.

**Verify**: `bun run lint && bun run typecheck && bun test` -> all commands exit 0.

## Test plan

- Attachment store: successful, missing, invalid, duplicate keys.
- Provider store: bulk delete, unrelated retention, serialization failure.
- Chat manager/IPC: validation, active-run cleanup, late persistence guard.
- Workspace helpers: thread/chat/project pruning and attachment-key collection.
- UI callers: keep changes simple; if existing setup cannot render these
  components without a new test framework, cover their async result contract via
  exported helpers and do not add a browser framework solely for this plan.

## Done criteria

- [ ] Deleted thread/project/chat messages are absent from the next persisted
      workspace snapshot.
- [ ] Their Carrent-owned attachment files are removed; missing files are safe
      to retry.
- [ ] All Carrent provider-session mappings for deleted thread IDs are removed.
- [ ] An active or late-completing run cannot restore a deleted session mapping.
- [ ] Cleanup failure leaves the visible thread/project available and shows an
      error instead of a success toast.
- [ ] Unrelated threads, messages, attachments, and sessions remain unchanged.
- [ ] `bun run lint`, `bun run typecheck`, and `bun test` exit 0.
- [ ] Only in-scope files and `plans/README.md` changed; the pre-existing
      `runtimeModelsCache.ts` diff is unchanged.

## STOP conditions

Stop and report if:

- Any attachment storage key is referenced by messages in more than one thread;
  shared ownership requires reference counting or a product decision.
- Provider session keys no longer have an unambiguous `:<threadId>` suffix.
- Cleanup requires deleting provider-owned Kimi files or user project files.
- The renderer cannot wait for cleanup without losing the current navigation
  contract; do not silently switch back to fire-and-forget deletion.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Future attachment types must participate in the same ownership collection.
- Reviewers should focus on partial-failure ordering and late async run events.
- Migration cleanup for orphan data created before this fix is intentionally
  deferred. It requires scanning live workspace references before deleting any
  historical attachment file.
