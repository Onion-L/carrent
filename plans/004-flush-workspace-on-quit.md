# Plan 004: Flush the final workspace snapshot on every quit path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When done, update
> this plan's row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `git diff --stat eb5b839..HEAD -- apps/desktop/electron/main.ts apps/desktop/electron/workspace/workspaceShutdown.ts apps/desktop/electron/workspace/workspaceShutdown.test.ts`
> If an in-scope file changed, compare the Current state excerpts with live
> code. A semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug, tests
- **Planned at**: commit `eb5b839`, 2026-07-11

## Why this matters

Renderer saves are debounced and the `beforeunload` IPC call is best-effort.
The main process keeps the latest normalized snapshot specifically so it can
flush during quit, but it only does so while at least one BrowserWindow exists.
Closing the last window before `app.quit()` therefore bypasses the reliable
flush and can lose the final workspace changes.

## Current state

- `apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.ts:43-53` remembers
  every hydrated snapshot immediately but writes it after 500 ms.
- `apps/desktop/electron/workspace/workspaceIpc.ts:16-36` stores the latest
  normalized snapshot in `lastWorkspaceSnapshot` when the renderer sends
  `workspace:remember`.
- `apps/desktop/electron/main.ts:146-161` gates the final flush on window count:

```ts
app.on("before-quit", async (event) => {
  if (isQuitting) return;
  if (BrowserWindow.getAllWindows().length > 0) {
    event.preventDefault();
    isQuitting = true;
    // save last snapshot, then app.quit()
  }
});
```

- `main.ts:164-167` calls `app.quit()` after the last window closes on non-macOS,
  so the condition is false on that normal path. macOS can also quit later with
  zero windows.
- Workspace tests use injected stores and `bun:test`. Main-process lifecycle is
  currently untested; add a small injected coordinator rather than importing
  Electron in a test.
- Preserve the unrelated user change in
  `apps/desktop/src/renderer/lib/runtimeModelsCache.ts`.

## Commands you will need

| Purpose       | Command                                                                                                                                                                          | Expected on success     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Focused tests | `bun test apps/desktop/electron/workspace/workspaceShutdown.test.ts apps/desktop/electron/workspace/workspaceIpc.test.ts apps/desktop/electron/workspace/workspaceStore.test.ts` | all selected tests pass |
| Full tests    | `bun test`                                                                                                                                                                       | all tests pass          |
| Typecheck     | `bun run typecheck`                                                                                                                                                              | exit 0                  |
| Lint          | `bun run lint`                                                                                                                                                                   | exit 0, no findings     |

## Scope

**In scope**:

- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/workspace/workspaceShutdown.ts` (create)
- `apps/desktop/electron/workspace/workspaceShutdown.test.ts` (create)

**Out of scope**:

- Changing the 500 ms debounce or workspace file format.
- Adding synchronous filesystem writes in the renderer.
- Changing window-close behavior or making macOS quit on last-window close.
- Refactoring workspace storage beyond the quit coordinator.
- `apps/desktop/src/renderer/lib/runtimeModelsCache.ts`.

## Git workflow

- Branch: `codex/plan-004-flush-workspace-on-quit`
- Suggested commit: `fix(desktop): flush workspace before every quit`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Extract an injected, one-shot quit coordinator

Create `electron/workspace/workspaceShutdown.ts` with a small factory that owns
the `isQuitting` guard and accepts injected functions:

- get the latest snapshot;
- get the current workspace store;
- request final application quit;
- optionally report a save error.

Its `beforeQuit(event)` method must, on the first call, always call
`event.preventDefault()` regardless of window count, set the guard before any
await, save the latest snapshot when both snapshot and store exist, and request
quit in `finally`. A recursive second `before-quit` call caused by the final
quit request must return without preventing default.

Do not pass window count into this coordinator; persistence is required whether
there are zero, one, or many windows.

Add unit tests for:

- snapshot + store saves exactly once before quit;
- zero-window-equivalent flow behaves identically because no window condition
  exists;
- no snapshot still proceeds to quit;
- save rejection reports the error and still proceeds to quit;
- recursive second invocation is not prevented and does not save twice.

**Verify**: `bun test apps/desktop/electron/workspace/workspaceShutdown.test.ts`
-> all new tests pass.

### Step 2: Wire main.ts to the coordinator

Replace the module-level `isQuitting` block in `main.ts` with one coordinator
instance. Inject `getLastWorkspaceSnapshot`, a getter for the existing nullable
`workspaceStore`, `app.quit`, and the existing workspace error log. Register its
handler with `app.on("before-quit", ...)`.

Keep `window-all-closed` behavior unchanged. Do not call `BrowserWindow` from
the quit handler.

**Verify**: `bun run typecheck && bun test apps/desktop/electron/workspace`
-> typecheck and all workspace tests pass.

### Step 3: Run full repository gates

**Verify**: `bun run lint && bun run typecheck && bun test` -> all commands exit 0.

## Test plan

- New `workspaceShutdown.test.ts` uses fake event/store/quit functions only.
- Existing `workspaceIpc.test.ts` remains the contract for remembering the
  latest normalized snapshot.
- Existing `workspaceStore.test.ts` remains the contract for atomic disk save.
- No Electron window or real app quit should occur during tests.

## Done criteria

- [ ] First `before-quit` always prevents default and attempts the final flush,
      even with no BrowserWindow.
- [ ] Final `app.quit()` happens after save settles or fails.
- [ ] The recursive quit event is allowed through and cannot loop.
- [ ] Save errors retain the existing log behavior and do not block quit.
- [ ] `window-all-closed` platform behavior is unchanged.
- [ ] `bun run lint`, `bun run typecheck`, and `bun test` exit 0.
- [ ] Only in-scope files and `plans/README.md` changed; the pre-existing
      `runtimeModelsCache.ts` diff is unchanged.

## STOP conditions

Stop and report if:

- Electron's current version does not permit awaiting work after
  `preventDefault()` in `before-quit`.
- Another module already owns a competing quit guard or calls `app.exit()`.
- Saving the final snapshot requires changing workspace schema or renderer
  debounce behavior.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Any future shutdown work should be added to the same coordinator or an
  explicitly ordered shutdown sequence; multiple independent `before-quit`
  guards can deadlock each other.
- Reviewers should verify the guard is set before the first await and that the
  second quit event is not prevented.
