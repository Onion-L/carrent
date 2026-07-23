# Plan 011: Persist Thread Work-in-Progress Across Navigation and Restarts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report; do not improvise.
> When done, update this plan's status row in `plans/README.md` unless a
> reviewer owns the index.
>
> **Drift check (run first)**:
> `rtk git diff --stat f7bbbf1..HEAD -- apps/desktop/src/shared/workspacePersistence.ts apps/desktop/src/shared/workspacePersistence.test.ts apps/desktop/src/renderer/context/WorkspaceContext.tsx apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.ts apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.test.ts apps/desktop/src/renderer/hooks/chatMessageQueue.ts apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts apps/desktop/src/renderer/components/chat/Composer.tsx apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/lib/attachments.ts`
> Compare any changed file with the Current state below. A semantic mismatch is
> a STOP condition.
>
> **Dirty-worktree warning**: this plan was authored while the working tree
> already contained user changes in `apps/desktop/src/renderer/components/chat/ThreadHistoryPane.tsx`
> and the untracked `apps/desktop/src/renderer/components/chat/ThreadHistoryPane.test.tsx`.
> Do not overwrite, revert, stage, or include those changes. They are unrelated
> to this plan and may remain present while executing it.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `f7bbbf1`, 2026-07-23
- **Status**: TODO

## Why this matters

Carrent is intended for sustained desktop sessions, but unfinished work is
currently tied to a mounted Composer. Switching Threads remounts the Composer,
and restarting the app clears both the text draft and the FIFO of messages
queued while a run is active. Persisting this work lets users move between
Threads without losing input, while keeping the important safety rule that
recovered queued messages require an explicit Send or Steer action and never
start a Run by themselves.

## Current state

### Relevant files and current behavior

- `apps/desktop/src/renderer/components/chat/Composer.tsx` owns the editable
  text (`:788`), selected Skill records (`:793`), pending attachment `File`
  objects (`:802`), and the queue UI (`:2206`). `ThreadPage.tsx:80-86` gives
  the Composer a `key` equal to the Thread id, so switching Threads remounts
  it.
- `apps/desktop/src/renderer/hooks/chatMessageQueue.ts:10-12` stores queued
  messages in a module-level `Map` and explicitly documents that a restart
  clears every queue. `enqueueChatMessage`, `shiftQueuedChatMessage`,
  `unshiftQueuedChatMessage`, and `updateQueuedChatMessage` are the existing
  queue operations used by Composer.
- `apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.ts:5-20`
  serializes only projects, chats, messages, and `activeThreadId`.
  `WorkspaceContext.tsx:541-543` builds that snapshot after hydration.
- `apps/desktop/src/shared/workspacePersistence.ts:21-27` defines the version-1
  `WorkspaceSnapshot`. `normalizeWorkspaceSnapshot` already drops malformed
  persisted fields and restores interrupted Runs; the new field must remain
  optional so snapshots written before this plan still load.
- `apps/desktop/src/renderer/lib/attachments.ts:13-25` distinguishes a
  metadata-only `AttachmentMetadata` from the renderer-only `File` and preview
  URL. The Electron Attachment Store writes bytes under app data and exposes
  `read`, `resolvePath`, and deletion APIs; never persist `File`, Blob, preview
  URLs, or absolute app-data paths.
- `apps/desktop/src/renderer/context/WorkspaceContext.tsx:308-333` currently
  computes attachment ownership only from sent Messages before deleting a
  Thread or Project. Work-in-progress attachment metadata must be included in
  that ownership calculation so deleting a Thread cannot leave its persisted
  queue/draft state behind or delete a storage key still referenced elsewhere.
- `Composer.tsx:1718-1733` automatically shifts the next live queue item after
  a completed Run, while `Composer.tsx:1816-1837` sends an item immediately when
  the user clicks Send/Steer. Recovered items must be marked so the completion
  callback skips them; the explicit button path must continue to work.

### Persisted shape to implement

Add an optional `threadWork` field to the existing version-1
`WorkspaceSnapshot`. Do not bump the snapshot version for this additive field.
Use these semantics (names may follow local casing, but the serialized meaning
must remain stable):

```ts
type ThreadWorkSnapshot = {
  draft?: {
    content: string;
    attachedSkillNames: string[];
    attachments: AttachmentMetadata[];
  };
  queuedMessages: Array<{
    id: string;
    content: string;
    attachments?: AttachmentMetadata[];
    requiresConfirmation?: boolean;
  }>;
};

type WorkspaceSnapshot = {
  version: 1;
  projects: ProjectRecord[];
  chats: ThreadRecord[];
  messages: Message[];
  activeThreadId: string | null;
  threadWork?: Record<string, ThreadWorkSnapshot>;
};
```

`attachedSkillNames` is intentional: do not persist Skill Catalog absolute
paths. On hydration, resolve names against the current `useSkills()` catalog;
missing Skills are omitted from the restored chips and must not prevent the
text draft from loading. Persist only metadata for attachments.

When `normalizeWorkspaceSnapshot` reads a saved queue, it must set
`requiresConfirmation: true` in memory for every recovered item. Newly queued
items created during the current process may omit the flag. The normal queue
completion path may shift only a queue head that does not require confirmation.
Explicit Send/Steer removes the recovered item and invokes the existing
`handleSend` path; if that send is rejected, the item must be put back.

Bound the new data during normalization: reject a draft or queue item whose
text exceeds 256 KiB UTF-8, cap each Thread's queue at 50 items, and reuse the
existing attachment metadata validation and per-message attachment limits.
Malformed `threadWork` entries should be dropped without rejecting the entire
workspace snapshot. An absent field means no draft and an empty queue.

### Vocabulary and repository conventions

Use the Desktop App terms from `apps/desktop/CONTEXT.md`: **Thread**, **Run**,
**Thread Attachment**, **File Attachment**, and **Image Attachment**. A restored
queued message is not a Run and must not be described as one in UI copy.
Follow the existing React external-store pattern in
`apps/desktop/src/renderer/hooks/chatMessageQueue.ts` and the workspace
mutation/persistence ownership in `WorkspaceContext.tsx`; do not add a state
library. Keep the existing quiet, compact Composer rows and icon actions from
`DESIGN.md`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Targeted tests | `rtk bun test apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.test.ts apps/desktop/src/shared/workspacePersistence.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/renderer/components/chat/Composer.test.ts` | exit 0; all targeted tests pass |
| Typecheck | `rtk bun run typecheck` | exit 0, no TypeScript errors |
| Lint | `rtk bun run lint` | exit 0, no lint errors |
| Build | `rtk bun run build` | exit 0; Turbo builds all packages |
| Diff hygiene | `rtk git diff --check` | no output and exit 0 |

## Scope

**In scope (the only files to modify):**

- `apps/desktop/src/shared/workspacePersistence.ts`
- `apps/desktop/src/shared/workspacePersistence.test.ts`
- `apps/desktop/src/renderer/context/WorkspaceContext.tsx`
- `apps/desktop/src/renderer/context/WorkspaceContext.test.ts`
- `apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.ts`
- `apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.test.ts`
- `apps/desktop/src/renderer/hooks/chatMessageQueue.ts`
- `apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts`
- `apps/desktop/src/renderer/components/chat/Composer.tsx`
- `apps/desktop/src/renderer/components/chat/Composer.test.ts`
- `apps/desktop/src/renderer/lib/attachments.ts` (only if a metadata-to-File
  hydration helper is needed)
- `plans/README.md` (only to update Plan 011's status row after verification)

**Out of scope:**

- Electron IPC protocol changes, Attachment Store schema changes, or storing
  attachment bytes in `workspace.json`.
- Automatic orphan-attachment garbage collection or expiry. Existing app-data
  cleanup remains owned by Thread/Project deletion; do not invent a background
  scanner in this plan.
- Automatic sending of any restored queue item, retry timers, cloud sync, or
  cross-device draft state.
- Changes to Runtime Session continuity, transcript history, Plan Mode, Git
  worktrees, or the visible message schema.
- New state-management dependencies or a workspace snapshot version bump.
- Unrelated Composer redesign, attachment format support, or drag-and-drop.

## Steps

### Step 1: Add and validate the persisted Thread Work-in-Progress shape

Extend `WorkspaceSnapshot` and `normalizeWorkspaceSnapshot` with optional
`threadWork`. Add small validation helpers that accept only string Thread ids,
draft text, Skill names, and valid metadata-only attachments. Enforce the
256 KiB text and 50-item queue bounds above; normalize missing queues to `[]`,
set `requiresConfirmation: true` on recovered queue items, and drop malformed
Thread entries without invalidating otherwise valid projects/messages. Keep
old snapshots without `threadWork` byte-for-byte compatible after normalization
except for the new empty field if the existing normalizer convention requires
it.

**Verify**: `rtk bun test apps/desktop/src/shared/workspacePersistence.test.ts` ->
existing tests pass plus cases for absent, valid, malformed, oversized, and
recovered queue data.

### Step 2: Make the existing queue store snapshot-aware

Extend `chatMessageQueue.ts` instead of creating a second state system. Keep the
current FIFO API used by Composer, and add:

1. hydration from `threadWork` after `WorkspaceContext` loads a snapshot;
2. a stable serialized snapshot getter for all project/chat Thread ids;
3. a store-version hook or equivalent subscription that lets
   `WorkspaceContext` rebuild the debounced workspace snapshot when a draft or
   queue changes;
4. draft get/set/clear operations keyed by Thread id; and
5. queue behavior that never auto-shifts a `requiresConfirmation` head item,
   while explicit removal, edit, unshift, and Send/Steer retain their current
   semantics.

Do not expose mutable Maps to callers. Ensure hydration replaces stale in-memory
state exactly once per loaded snapshot and an empty/no-snapshot load clears old
state (important for tests and app logout-like reloads).

**Verify**: `rtk bun test apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts`
-> FIFO, per-Thread isolation, snapshot round-trip, recovered-head blocking,
explicit removal, edit, and unshift tests pass.

### Step 3: Include Thread Work-in-Progress in workspace hydration and saves

In `WorkspaceContext.tsx`, hydrate the queue/draft store before setting
`hasHydrated`, and subscribe to its version so draft/queue mutations trigger the
existing 500 ms `useDebouncedWorkspaceSave` path. Extend
`buildWorkspaceSnapshot` to include a metadata-only `threadWork` record for all
known project and chat Threads. Preserve the current pre-hydration guard and
`beforeunload` flush; never save a snapshot built from the seed data before the
loaded WIP has been applied.

Update the deletion preparation path so deleting a Thread or Project removes
its `threadWork` entry and includes its draft/queue attachment storage keys in
the existing ownership calculation. Shared storage keys must remain protected;
do not delete a key still referenced by a remaining Message, draft, or queue.

**Verify**: `rtk bun test apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.test.ts` ->
hydration, snapshot inclusion, deletion cleanup, and pre-hydration save tests
pass.

### Step 4: Restore Composer drafts without restoring runtime-only objects

On Thread Composer mount, initialize the local text, Skill chips, and pending
attachment metadata from the hydrated draft exactly once. Resolve
`attachedSkillNames` against the current `useSkills()` result; silently omit
missing Skills while keeping the text. For each persisted attachment, read the
bytes through the existing `window.carrent.attachments.read(storageKey)` bridge
and reconstruct a renderer `File` plus preview URL using the existing
`pendingAttachmentFromFile` helper. If a stored attachment is missing or unreadable,
keep the draft text/Skills, omit only that attachment, and show the existing
attachment error surface rather than blocking the Composer.

Debounce draft writes from Composer state changes (content, Skill selection,
attachment add/remove) into the new store. On a successful normal send or queue
enqueue, clear the persisted draft after the current local cleanup. On a failed
send, keep the draft or restore the queued item exactly as the current failure
path does. Do not persist preview URLs or `File` instances.

**Verify**: `rtk bun test apps/desktop/src/renderer/components/chat/Composer.test.ts`
-> tests cover restoring text/Skills, reconstructing image and File Attachment
previews, missing attachment fallback, draft clearing after send, and keeping
draft state after a rejected send.

### Step 5: Make recovered queues explicit and safe in the Composer UI

Keep the existing compact queue rows and Send/Steer/Edit/Delete controls. A
recovered row may show a concise restored indicator or accessible label, but it
must not auto-send from `onComplete`, `onStop`, or `onError`. The live queue
continues to auto-send in FIFO order after completion. Clicking Send/Steer on a
recovered item must use the existing explicit path and reinsert the item if the
new Run cannot start. Ensure switching Threads or unmounting while a steer is in
flight still returns the item to the correct Thread queue.

**Verify**: `rtk bun test apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts` ->
recovered items remain queued after completion/stop/failure events, while live
items preserve current auto-send behavior and explicit Send/Steer works.

### Step 6: Run the full verification gates and inspect the diff

Run the Commands table in order. Confirm the diff contains only the Scope
files, no `File`/Blob/preview URL is serialized by `threadWork`, and no IPC or
Runtime request shape changed. Update the status row in `plans/README.md` only
after all gates pass.

**Verify**: `rtk bun run typecheck`, `rtk bun run lint`, `rtk bun run build`, and
`rtk git diff --check` -> all exit 0.

## Test plan

- `workspacePersistence.test.ts`: absent field, valid round-trip, malformed
  entries, text/queue bounds, metadata-only attachment validation, and the
  `requiresConfirmation` normalization rule.
- `chatMessageQueue.test.ts`: store hydration/replacement, draft updates,
  snapshot serialization, queue isolation, recovered-head blocking, and live
  FIFO behavior.
- `useDebouncedWorkspaceSave.test.ts`: snapshot includes `threadWork` and still
  refuses writes before hydration.
- `WorkspaceContext.test.ts`: loaded WIP appears before the hydrated UI,
  Thread/Project deletion removes WIP and owned attachment keys, and shared
  attachment ownership is not deleted.
- `Composer.test.ts`: draft restoration, Skill resolution, attachment byte
  reconstruction, missing-file fallback, draft clearing, recovered queue
  non-auto-send, and explicit Send/Steer retry behavior.

Follow existing `bun:test` and renderer test patterns in the named files. Do not
add browser automation or a real filesystem fixture when a fake
`window.carrent.attachments.read` bridge can assert the same behavior.

## Done criteria

- [ ] A text draft, selected Skill names, and pending attachment metadata survive
  Thread navigation and app restart; attachment previews are reconstructed from
  the existing read bridge.
- [ ] Queued messages survive app restart and remain visible, editable, and
  removable; recovered messages never auto-send after Run completion, stop, or
  failure.
- [ ] Explicit Send/Steer of a recovered item starts the same Chat Run path as a
  live item and restores the item if the send is rejected.
- [ ] Old version-1 snapshots without `threadWork` still load, malformed WIP is
  ignored safely, and all new persisted text/queues are bounded.
- [ ] Thread/Project deletion removes WIP state and only deletes attachment
  storage keys with no remaining Message, draft, or queue owner.
- [ ] `rtk bun test apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.test.ts apps/desktop/src/shared/workspacePersistence.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/renderer/components/chat/Composer.test.ts` exits 0.
- [ ] `rtk bun run typecheck`, `rtk bun run lint`, `rtk bun run build`, and
  `rtk git diff --check` all exit 0.
- [ ] `git status --short` shows only the pre-existing ThreadHistoryPane changes
  plus files in the Scope list, and the `plans/README.md` status row is updated.

## STOP conditions

Stop and report instead of improvising if:

- The live `WorkspaceSnapshot` version or attachment metadata contract has
  changed from the excerpts, or existing tests require a version bump.
- Reconstructing a pending attachment requires a new IPC channel, exposes an
  app-data path to the renderer, or cannot preserve the original bytes.
- The existing deletion ownership rule cannot represent draft/queue owners
  without changing the public `DeleteThreadDataRequest` outside Scope.
- A recovered queue item can only be distinguished by auto-sending it or by
  changing Runtime/IPC event semantics.
- Any verification command fails twice after a reasonable local fix, or the
  implementation requires touching Electron Runtime, persistence-store, or UI
  files outside Scope.

## Maintenance notes

- Any future workspace snapshot migration must preserve optional `threadWork`
  normalization and the rule that recovered queue items require confirmation.
- Attachment deletion changes must treat Messages, drafts, and queues as one
  ownership graph; do not reintroduce message-only cleanup.
- If a future queue feature adds scheduled or automatic retries, it must define
  whether the item is live or requires confirmation after restart before touching
  the completion callback.
- Automatic orphan attachment cleanup remains intentionally deferred. If it is
  later added, it must scan all persisted Message and Thread Work-in-Progress
  references before deleting app-data files.
- Reviewers should verify that typing does not cause unbounded synchronous IPC
  writes; draft persistence should remain debounced through the existing
  workspace save path.
