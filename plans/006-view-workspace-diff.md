# Plan 006: Review a real workspace diff from the thread timeline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When done, update
> this plan's row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `rtk git diff --stat 7590967..HEAD -- apps/desktop/electron/git/gitIpc.ts apps/desktop/electron/git/gitIpc.test.ts apps/desktop/electron/preload.ts apps/desktop/src/renderer/env.d.ts apps/desktop/src/renderer/mock/uiShellData.ts apps/desktop/src/renderer/context/WorkspaceContext.tsx apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/renderer/components/chat/Composer.tsx apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/components/chat/ChangedFilesCard.tsx apps/desktop/src/renderer/components/chat/ChangedFilesCard.test.tsx apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.tsx apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.test.tsx apps/desktop/src/shared/workspacePersistence.ts apps/desktop/src/shared/workspacePersistence.test.ts`
> If an existing in-scope file changed, compare the Current state excerpts with
> the live code. A semantic mismatch is a STOP condition. New files named in the
> command are expected not to exist yet.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `7590967`, 2026-07-12

## Why this matters

Carrent can show Kimi's Agent Activity, but it cannot verify the resulting
workspace changes inside the thread. The existing Changed Files card is backed
only by seed data, and its `View diff` button has no behavior. This plan makes a
project run capture a bounded, immutable snapshot of the current Git worktree
relative to `HEAD`, stores that snapshot in the thread, and lets the user review
the unified diff without leaving Carrent.

This first version is deliberately honest about attribution: the snapshot may
contain changes that existed before the run or were made by another process
during the run. UI copy must say **Workspace changes**, not Agent changes or
Changes made by this run. Exact before/after run attribution is a separate
follow-up.

## Current state

- `apps/desktop/electron/git/gitIpc.ts:27-55` registers only branch operations:

```ts
export function registerGitIpc(ipcMainLike: IpcMainLike): void {
  ipcMainLike.handle("git:branches", async (_event, projectPath) => {
    // ...
  });
  ipcMainLike.handle("git:checkout", async (_event, projectPath, branch) => {
    // ...
  });
  ipcMainLike.handle("git:createBranch", async (_event, projectPath, branch) => {
    // ...
  });
}
```

- `apps/desktop/electron/git/gitIpc.test.ts:78-145` uses temporary real Git
  repositories and direct registered-handler calls. Extend this pattern; do not
  require the user's repository or network access.
- `apps/desktop/electron/preload.ts:113-120` and
  `apps/desktop/src/renderer/env.d.ts:99-103` expose only `branches`, `checkout`,
  and `createBranch`. Add the diff operation through the same typed preload
  boundary.
- `apps/desktop/src/renderer/mock/uiShellData.ts:69-75` defines a minimal file
  summary, and lines 113-118 define a Changed Files message with no diff:

```ts
type ChangedFile = {
  path: string;
  additions: number;
  deletions: number;
  isFolder?: boolean;
  fileType?: "swift" | "markdown" | "other";
};

type ChangedFilesMessage = Omit<MessageBase, "role"> & {
  role: "assistant";
  type: "changed_files";
  content?: string;
  changedFiles: ChangedFile[];
};
```

- `apps/desktop/src/renderer/context/WorkspaceContext.tsx:617-634` can append
  only text messages. Add a dedicated Changed Files append operation rather
  than weakening the existing text-message input type.
- `apps/desktop/src/renderer/components/chat/Composer.tsx:1369-1399` has three
  terminal callbacks: `onComplete`, `onError`, and `onStop`. Each updates the
  assistant message and thread activity, but none queries the worktree.
- `apps/desktop/src/renderer/components/chat/MessageTimeline.tsx:570-574`
  already renders `ChangedFilesMessageItem`, so this plan does not need a new
  timeline branch.
- `apps/desktop/src/renderer/components/chat/ChangedFilesCard.tsx:41-46`
  renders two inert controls:

```tsx
<button>Collapse all</button>
<button>View diff</button>
```

  The card already has a working single expand/collapse control. Remove the
  redundant inert `Collapse all` button and make `View diff` open the snapshot.
- `apps/desktop/src/shared/workspacePersistence.ts:53-64` normalizes image
  attachment metadata but otherwise trusts message objects. Extend this seam so
  malformed persisted diff fields are dropped and cannot crash the renderer;
  existing Changed Files messages without a diff must continue to load.
- `PRODUCT.md:9-17` describes sustained local coding work and a focused,
  trustworthy desktop tool. `apps/desktop/CONTEXT.md:19-21` defines a **Run** as
  one Coding Agent execution. Use `Run`, `Thread`, `Coding Agent`, and
  `Workspace changes`; do not call this a provider log or claim Agent ownership
  of every file change.
- `DESIGN.md:205-240` reserves shadows for temporary layers and requires compact
  controls, tonal surfaces, hairline borders, Night/Paper parity, and visible
  focus. Follow `ImageAttachmentLightbox.tsx` for a portal, Escape handling,
  accessible dialog semantics, and Electron titlebar-safe controls. The diff
  viewer must remain a work surface, not a decorative nested card.

## Required product contract

The implementation must use this exact first-version meaning:

1. Only project-scoped runs can capture a workspace diff. General chats have no
   project path and never create a Changed Files message.
2. On completion, failure, or cancellation, query the current Git worktree
   relative to its current `HEAD`.
3. Include staged and unstaged tracked changes plus non-ignored untracked files.
4. Persist the returned file summary and bounded unified patch in one Changed
   Files message. Opening it later shows the stored snapshot, not a fresh diff.
5. A clean worktree creates no Changed Files message.
6. A non-Git directory or repository without `HEAD` creates no message and does
   not fail the Coding Agent run.
7. An unexpected capture error is non-fatal. Preserve the run result and show
   one concise toast; never append an error as Agent answer text.
8. The card and viewer say `Workspace changes` and `Snapshot against HEAD after
   the run`. They must not say or imply `Changes made by the Agent`.
9. Stored patch text is capped at 256 KiB per message. At most 200 files are
   summarized, and at most 100 untracked files are expanded into patches.
   Truncation must be explicit in both the result and viewer.
10. Git commands must use `execFile` argument arrays, `--no-ext-diff`,
    `--no-textconv`, and `--no-color`. Do not use a shell command string, the
    real Git index, `git add`, temporary commits, stash, checkout, or any
    worktree mutation.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Git IPC tests | `rtk bun test apps/desktop/electron/git/gitIpc.test.ts` | all selected tests pass |
| Renderer and persistence tests | `rtk bun test apps/desktop/src/renderer/components/chat/ChangedFilesCard.test.tsx apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.test.tsx apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/shared/workspacePersistence.test.ts` | all selected tests pass |
| Full tests | `rtk bun test` | all tests pass |
| Typecheck | `rtk bun run typecheck` | exit 0, no errors |
| Lint | `rtk bun run lint` | exit 0, no findings |
| Build | `rtk bun run build` | exit 0 for every workspace |
| Diff hygiene | `rtk git diff --check` | exit 0, no whitespace errors |

## Scope

**In scope**:

- `apps/desktop/electron/git/gitIpc.ts`
- `apps/desktop/electron/git/gitIpc.test.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/src/renderer/env.d.ts`
- `apps/desktop/src/renderer/mock/uiShellData.ts`
- `apps/desktop/src/renderer/context/WorkspaceContext.tsx`
- `apps/desktop/src/renderer/context/WorkspaceContext.test.ts`
- `apps/desktop/src/renderer/components/chat/Composer.tsx`
- `apps/desktop/src/renderer/components/chat/Composer.test.ts`
- `apps/desktop/src/renderer/components/chat/ChangedFilesCard.tsx`
- `apps/desktop/src/renderer/components/chat/ChangedFilesCard.test.tsx` (create)
- `apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.tsx` (create)
- `apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.test.tsx` (create)
- `apps/desktop/src/shared/workspacePersistence.ts`
- `apps/desktop/src/shared/workspacePersistence.test.ts`
- `plans/README.md` only for the final status update

**Out of scope**:

- Exact before/after Run attribution or separating pre-existing, Coding Agent,
  and external-editor changes.
- Commit, stage, unstage, discard, revert, checkout, stash, patch application,
  or any other Git mutation.
- A side-by-side editor, syntax highlighting library, Monaco, CodeMirror, or a
  new dependency. Render a readable unified diff with existing React/Tailwind.
- Live-refreshing a historical snapshot when files change after capture.
- Capturing diffs for General chat, non-Git projects, or repositories without a
  commit.
- Changing ACP event shapes or deriving truth from Kimi tool-call text. Git is
  the source of truth for this feature.
- Opening files in an external editor, line commenting, review approvals, or
  pull-request integration.
- Moving `Message` types out of `mock/uiShellData.ts`; that broader cleanup is
  unrelated to this feature.
- Changing workspace snapshot version solely for additive optional fields.
- Storing patches in attachment storage or adding patch garbage collection.

## Git workflow

- Branch: `codex/plan-006-view-workspace-diff`
- Suggested commit: `feat(desktop): add workspace diff review`
- Keep the commit focused on this plan.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a bounded, read-only workspace diff Git operation

In `gitIpc.ts`, export shared types used by preload and renderer. Use this
semantic shape; names may differ, but fields and meanings must not:

```ts
export type GitWorkspaceDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
  untracked: boolean;
  omitted?: boolean;
};

export type GitWorkspaceDiffResult =
  | {
      state: "ready";
      baseRevision: string;
      capturedAt: string;
      files: GitWorkspaceDiffFile[];
      patch: string;
      truncated: boolean;
    }
  | {
      state: "clean";
      baseRevision: string;
      capturedAt: string;
    }
  | {
      state: "unavailable";
      reason: "not-git" | "no-head";
    };
```

Register `git:workspace-diff`. Validate `projectPath` with the same non-empty
string rule as existing handlers. Implement the operation with small helpers in
the same module; do not introduce a generic Git service abstraction.

Required command behavior:

- Resolve the repository root with `git rev-parse --show-toplevel` and the base
  revision with `git rev-parse --verify HEAD`. Return `unavailable` for expected
  not-a-repository or no-HEAD outcomes.
- Run tracked summary with:
  `git diff --numstat --no-renames --no-ext-diff --no-textconv -z HEAD -- <project-pathspec>`.
- Run tracked patch with:
  `git diff --no-color --no-renames --no-ext-diff --no-textconv --unified=3 HEAD -- <project-pathspec>`.
- List non-ignored untracked files with:
  `git ls-files --others --exclude-standard -z -- <project-pathspec>`.
- Commands run from the resolved repository root. Derive a repository-relative
  pathspec from the selected project path so projects opened at a repository
  subdirectory do not leak sibling changes.
- Parse all path lists as NUL-delimited data. Do not split paths by newline.
- Disable rename detection for this first version. A rename may appear as one
  deletion and one addition; that is an accepted limitation.
- Parse `-` numstat fields as binary with zero numeric additions/deletions.
- For each untracked regular file up to the stated limits, run read-only
  `git diff --no-index --no-color --no-ext-diff --no-textconv --unified=3 -- /dev/null <relative-path>`
  and the corresponding `--numstat` form. Exit code 1 means a diff exists and is
  expected; any other non-zero result is an error for that file. Directories,
  symlinks, oversized files, and files beyond the limit stay in the summary as
  `omitted: true` and set `truncated: true`; do not follow symlinks.
- Cap each child-process buffer, set a finite timeout, cap the combined patch at
  256 KiB by byte count (not JavaScript character count), and cap summaries at
  200 files. Append a plain marker such as `[diff truncated by Carrent]` when
  patch content is cut.
- Never log patch content or include it in thrown error messages.

Return `clean` only when tracked and untracked summaries are both empty. Sort
the final file list by path for stable persistence and tests.

Extend `gitIpc.test.ts` using its real temporary-repository pattern. Cover:

- handler registration and missing-path validation;
- clean repository;
- staged plus unstaged tracked changes relative to HEAD;
- non-ignored untracked text file included in summary and patch;
- ignored file excluded;
- binary numstat represented without `NaN`;
- filenames containing spaces;
- non-Git directory returns `unavailable/not-git`;
- repository without a commit returns `unavailable/no-head`;
- patch/file limits set `truncated` without modifying the real Git index.

For the last assertion, compare `git status --porcelain=v1` before and after the
handler call.

**Verify**:
`rtk bun test apps/desktop/electron/git/gitIpc.test.ts`
-> all tests pass, including at least the ten cases above.

### Step 2: Expose the typed operation through preload

In `electron/preload.ts`, import `GitWorkspaceDiffResult` next to
`GitBranchInfo` and add:

```ts
workspaceDiff: (projectPath: string) =>
  ipcRenderer.invoke("git:workspace-diff", projectPath) as Promise<GitWorkspaceDiffResult>
```

Mirror the exact signature in `src/renderer/env.d.ts`. Do not expose a generic
command runner or raw `ipcRenderer` to the renderer.

Update the existing git-bridge shape check in `Composer.tsx` and its pure-helper
tests so a stale preload produces the existing clear restart error instead of a
late `workspaceDiff is not a function` exception. Preserve compatibility only
for the already-optional `createBranch`; `workspaceDiff` is required by the new
renderer bundle.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/chat/Composer.test.ts && rtk bun run typecheck`
-> tests pass and TypeScript reports no preload contract mismatch.

### Step 3: Persist an immutable Changed Files snapshot

Extend the types in `mock/uiShellData.ts`:

- Export the Changed File and Changed Files message types if needed by the
  context.
- Add `binary`, `untracked`, and optional `omitted` to each file entry.
- Add an optional structured snapshot to `ChangedFilesMessage` containing
  `baseRevision`, `capturedAt`, `patch`, and `truncated`.
- Keep the snapshot optional so seed data and previously persisted messages
  continue to load.

In `WorkspaceContext.tsx`, add a dedicated
`appendWorkspaceDiffMessage(threadId, result)` operation. It accepts only the
`ready` result, returns the created Changed Files message, uses the existing
message id/timestamp conventions, and maps Git file records without changing
their paths or counts. Do not route this through `appendMessage`, whose input is
correctly limited to text messages.

Extract the record-construction logic as an exported pure function and test it
in `WorkspaceContext.test.ts`. Assert that it preserves base revision, capture
time, patch, truncation, binary/untracked/omitted flags, and creates an
assistant `changed_files` message for the requested thread.

In `workspacePersistence.ts`, normalize optional Changed Files snapshot data:

- accept existing messages that have no snapshot;
- retain only correctly typed file entries and snapshot fields;
- drop malformed snapshot data rather than rejecting the entire workspace;
- do not execute, parse as HTML, or log patch content;
- retain the 256 KiB backend cap as the source of truth, but defensively drop a
  persisted patch larger than that cap if old/corrupt data bypasses IPC.

Add persistence tests for a valid snapshot, an old Changed Files message with no
snapshot, malformed fields, and an oversized patch. Do not increment
`WORKSPACE_SNAPSHOT_VERSION`; these fields are optional and backward-compatible.

**Verify**:
`rtk bun test apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/shared/workspacePersistence.test.ts`
-> all tests pass, including the four persistence cases and message-construction
case.

### Step 4: Capture workspace changes at every terminal Run outcome

In `Composer.tsx`, add one local `captureWorkspaceDiff` closure inside
`handleSend`, next to the existing assistant-message callbacks. Required
behavior:

- Return immediately for `props.mode === "chat"`.
- Guard with a closure boolean so only one terminal callback can capture.
- Call `window.carrent.git.workspaceDiff(project.path)` after completion,
  failure, or cancellation state has been applied.
- On `ready` with one or more files, call the context's
  `appendWorkspaceDiffMessage`.
- On `clean` or `unavailable`, do nothing.
- On an unexpected rejection, keep the assistant result unchanged and use the
  existing toast surface for `Run finished, but workspace diff could not be captured.`
  Log only a bounded error message, never patch content.
- Fire the asynchronous capture with `void`; terminal callbacks must not remain
  pending and must not block chat-run coordinator cleanup.

Call the closure exactly once from each of `onComplete`, `onError`, and
`onStop`. It is acceptable that the snapshot is taken just after the terminal
event and may include pre-existing or external changes; the UI contract makes
that limitation explicit.

Add exported pure decision helpers in `Composer.tsx` only where needed for
testability; do not create a new hook or coordinator for this feature. Extend
`Composer.test.ts` to cover project versus General chat, clean/unavailable
results, ready-with-files, and duplicate terminal notification suppression.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts`
-> all tests pass, including the capture decision cases.

### Step 5: Implement the read-only unified diff viewer

Create `WorkspaceDiffViewer.tsx`. Follow the portal and keyboard-cleanup pattern
from `ImageAttachmentLightbox.tsx`, but use the existing semantic surface,
border, foreground, muted, success, and danger tokens in both themes instead of
a black image overlay.

Required UI:

- full-window temporary layer with `role="dialog"`, `aria-modal="true"`, a
  visible title `Workspace diff`, and Escape/close-button behavior;
- stable header containing abbreviated `baseRevision`, captured time, file
  count, additions, and deletions;
- a visible note: `Snapshot against HEAD after the run; may include pre-existing or external changes.`;
- one scrollable monospace unified-diff surface;
- line classification that distinguishes file headers/hunks, additions,
  deletions, and context without treating `+++`/`---` headers as content lines;
- a non-color cue for every line class, such as the `+`, `-`, and `@@` prefixes;
- a warning band when `truncated` is true or any file is `omitted`;
- sensible empty-patch copy when every changed file is binary or omitted;
- no HTML injection and no `dangerouslySetInnerHTML`; render patch lines as
  React text nodes.

Export the pure line-classification helper and a non-portal diff-content
component so `WorkspaceDiffViewer.test.tsx` can use `renderToStaticMarkup`, as
existing renderer tests do. Test addition/deletion/header/hunk/context
classification, escaping of source-like `<script>` text, truncation warning,
and empty-patch state.

In `ChangedFilesCard.tsx`:

- rename the visible heading to `WORKSPACE CHANGES`;
- keep the existing header expand/collapse behavior;
- remove the redundant inert `Collapse all` button;
- show an enabled `View diff` command only when a valid stored snapshot exists;
- for old messages without a snapshot, show a disabled `Diff unavailable`
  control or omit the command, with an accessible explanation;
- open `WorkspaceDiffViewer` with local state and the stored immutable snapshot;
- keep file rows readable when additions/deletions are zero for binary or
  omitted entries, and show a concise non-color label such as `Binary` or
  `Omitted`.

Create `ChangedFilesCard.test.tsx` following the static-render pattern. Cover a
new message with View diff available, an old message with no snapshot, binary
and omitted labels, and honest Workspace changes copy.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/chat/ChangedFilesCard.test.tsx apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.test.tsx && rtk bun run typecheck`
-> all tests pass and typecheck exits 0.

### Step 6: Run repository gates and inspect scope

Run all focused tests first, then the full repository checks. Do not update
unrelated snapshots or reformat unrelated files to make gates pass.

**Verify**:
`rtk bun test apps/desktop/electron/git/gitIpc.test.ts apps/desktop/src/renderer/components/chat/ChangedFilesCard.test.tsx apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.test.tsx apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/shared/workspacePersistence.test.ts && rtk bun test && rtk bun run lint && rtk bun run typecheck && rtk bun run build && rtk git diff --check`
-> every command exits 0.

Then run:

`rtk git status --short`

Expected: only files listed under **In scope** plus `plans/README.md` are
modified or newly created.

## Test plan

- `gitIpc.test.ts`: use real temporary Git repositories; test clean, tracked,
  staged, unstaged, untracked, ignored, binary, spaces in filenames, non-Git,
  no-HEAD, truncation, and unchanged index behavior.
- `WorkspaceContext.test.ts`: test pure construction of the persisted Changed
  Files message from a ready Git snapshot.
- `workspacePersistence.test.ts`: test backward compatibility and rejection of
  malformed/oversized diff payloads.
- `Composer.test.ts`: test capture decisions and exactly-once terminal behavior
  without launching Electron or Git.
- `WorkspaceDiffViewer.test.tsx`: test pure line classification and escaped,
  accessible static content.
- `ChangedFilesCard.test.tsx`: test availability and labels for new and legacy
  messages.
- No test may use the user's project, network, real Kimi process, credentials,
  or modify the real Git index.

## Done criteria

- [ ] A project Run ending as completed, failed, or cancelled appends at most
      one Workspace Changes message when the worktree is dirty.
- [ ] General chat, clean repositories, non-Git paths, and repositories without
      `HEAD` append no Changed Files message and preserve the Run result.
- [ ] Staged, unstaged, and non-ignored untracked changes appear in the stored
      summary and unified patch.
- [ ] Ignored files are excluded; binary/oversized/over-limit content degrades
      to bounded summary metadata.
- [ ] Capture never mutates the worktree, index, branch, stash, commits, or
      repository configuration.
- [ ] Every stored patch is at most 256 KiB by byte count and visibly reports
      truncation or omission.
- [ ] `View diff` opens the stored snapshot after restart; it does not query a
      live diff when opened.
- [ ] Legacy Changed Files messages without a snapshot still render safely and
      do not offer a misleading working View diff command.
- [ ] UI copy consistently says Workspace changes and discloses that the
      snapshot may include pre-existing or external changes.
- [ ] Diff source text is rendered as escaped React text; no HTML sink or new
      rendering dependency is introduced.
- [ ] Focused tests, full tests, lint, typecheck, build, and `git diff --check`
      all exit 0.
- [ ] Only in-scope files and `plans/README.md` are modified.
- [ ] Plan 006 is marked DONE in `plans/README.md` by the executor.

## STOP conditions

Stop and report; do not improvise if:

- Product requirements actually require exact per-Run attribution. This plan
  intentionally stores the current workspace-versus-HEAD snapshot and cannot
  distinguish pre-existing or external edits.
- The implementation would need `git add`, a temporary/real index, stash,
  checkout, commit, reset, clean, or any other repository mutation.
- A correct renderer implementation requires exposing `ipcRenderer`, a shell,
  or arbitrary Git arguments to untrusted renderer code.
- Supporting untracked files requires following symlinks or reading outside the
  resolved repository/project boundary.
- Patch output cannot be bounded before it crosses IPC, or a test demonstrates
  that source content is included in an error/log path.
- `MessageTimeline` no longer renders Changed Files messages, or the active
  project Run no longer terminates through the three Composer callbacks named
  in Current state.
- The feature requires changing ACP event contracts, Kimi session behavior, or
  permission handling.
- A verification command fails twice after a reasonable in-scope fix attempt.
- An unrelated dirty-worktree change overlaps an in-scope file and cannot be
  preserved safely.

## Maintenance notes

- Reviewers should inspect every Git invocation for argument-array use,
  repository-bound path handling, disabled external/text-conversion helpers,
  timeouts, and byte limits.
- A Changed Files message is a historical snapshot. Future live refresh must be
  a separate command and must not silently replace its stored patch.
- The 256 KiB patch cap limits individual messages, not total workspace history.
  If real usage makes `workspace.json` large, move patches to Carrent-owned
  attachment-style storage with thread-deletion cleanup in a separate plan.
- Exact Run attribution requires a before/after design that handles dirty
  worktrees, concurrent editors, parallel threads, branches, and untracked
  files. Do not infer attribution later from this snapshot.
- Rename detection is intentionally disabled. A future improvement may add
  structured rename parsing without changing the stored snapshot contract.
- Commit/revert/stage actions should be designed separately with explicit
  confirmation and tests; this viewer remains read-only.
