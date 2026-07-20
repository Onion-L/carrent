# Plan 007: Turn workspace diff review into an editable Thread follow-up

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report - do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**:
> `rtk git diff --stat 99f4f84..HEAD -- apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.tsx apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.test.tsx apps/desktop/src/renderer/components/chat/Composer.tsx apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/routes/ThreadPage.tsx`
> If any in-scope source file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. A semantic
> mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/006-view-workspace-diff.md` (DONE)
- **Category**: direction
- **Planned at**: commit `99f4f84`, 2026-07-16

## Why this matters

Carrent can store and display a bounded workspace diff after a project Run, but
review is currently a dead end: a user who notices a problem must close the
viewer and manually reconstruct the affected files and locations in a new
message. This plan adds a small review-to-follow-up path. The user selects whole
files or individual diff hunks, writes one review note, and adds a generated,
editable draft to the same Thread Composer.

This first slice remains deliberately read-only. It does not send the draft,
apply a patch, mutate Git state, or claim that every selected change was made by
the Coding Agent. It proves the shortest useful loop - Run, review workspace
changes, prepare the next instruction - without turning Carrent into a source
control client.

## Required product contract

Implement this exact first-version behavior:

1. The follow-up action exists only in project-scoped Thread pages. General
   chat must not gain workspace review actions.
2. The stored `WorkspaceDiffSnapshot` remains immutable. Opening, selecting,
   and creating a follow-up must not query Git or mutate the workspace, index,
   branch, or persisted snapshot.
3. The user can select either an entire file or one or more individual hunks.
   A selectable target has one of these shapes:

   ```ts
   export type WorkspaceDiffReviewTarget =
     | { path: string; scope: "file" }
     | { path: string; scope: "hunk"; header: string };
   ```

4. Selecting an entire file clears hunk selections for that file. Selecting a
   hunk clears the whole-file selection for that file. Selections from different
   files can coexist.
5. Text patches expose a whole-file checkbox in the file header and a hunk
   checkbox beside each `@@ ... @@` header. Binary, omitted, or otherwise
   summary-only files appear in a compact `Files without visible diff` list and
   can be selected only as whole files.
6. A diff block whose parsed path is `unknown` is not selectable. Keep rendering
   it for inspection, but do not put `unknown` into a follow-up draft.
7. The viewer contains one plain review-note textarea and one primary
   `Add follow-up` button. The button is disabled until at least one target is
   selected and `reviewNote.trim()` is non-empty.
8. Clicking `Add follow-up` creates this exact visible draft shape, using the
   full stored revision and the stored ISO timestamp:

   ```text
   Follow up on this workspace diff review.

   Review note:
   <trimmed review note>

   Snapshot:
   - Base revision: <full baseRevision>
   - Captured at: <capturedAt>
   - This may include pre-existing or external changes.

   Selected changes:
   - Entire file: "src/example.ts"
   - Hunk in "src/other.ts": "@@ -10,2 +10,3 @@"

   Inspect the current workspace before editing because it may have changed since this snapshot.
   ```

   Use `JSON.stringify` for every path and hunk header placed after a label. This
   keeps spaces, quotes, backslashes, and newlines unambiguous. Do not include
   patch bodies or diff line content in the generated draft.

9. Target ordering is deterministic: preserve the `files` summary order; within
   one file, put a whole-file target first or hunks in their patch order. The
   same selection always produces the same draft.
10. The generated text is added to the Composer; it is never submitted
    automatically. If the Composer is empty, use the generated draft as-is. If
    it already contains non-whitespace text, preserve that text and append two
    newlines followed by the generated draft. Whitespace-only input is replaced.
11. Applying the draft must preserve pending Image Attachments, attached Skills,
    Runtime, model, permission mode, and branch selection. The Composer textarea
    receives focus and places the caret at the end of the merged text.
12. Each draft request is applied at most once by `requestId`, matching the
    existing external-submit idempotency convention. Closing and reopening the
    diff must not duplicate an already-applied draft.
13. After a draft is accepted by the Composer, close the diff viewer. Pressing
    Escape or the close button discards the viewer's current note and selection
    without changing the Composer.
14. Truncated snapshots remain reviewable. Preserve the current truncation and
    omission warnings and the wording `Workspace changes`; never relabel the
    content `Agent changes` or `Changes made by this run`.
15. Historical snapshot persistence does not change. The follow-up selection and
    unsent draft are transient renderer state; only the normal sent user message
    enters Thread history.

## Current state

### Product vocabulary and constraints

- `PRODUCT.md:9-17` says Carrent serves software engineers in sustained desktop
  sessions and should be quiet, precise, pragmatic, and trustworthy.
- `apps/desktop/CONTEXT.md:11-21` defines a **Thread** as the project-scoped
  conversation across Runs, and a **Run** as one Coding Agent execution. Use
  these terms in implementation names and copy; do not call this a provider
  session or a new chat.
- `plans/006-view-workspace-diff.md:32-36` records the existing attribution
  boundary: the snapshot may contain pre-existing or external changes and must
  be called **Workspace changes**, not Coding Agent changes.
- `DESIGN.md:220-257` requires compact controls, visible focus, tonal surfaces,
  one-pixel borders, restrained shadows, and the existing Composer as the main
  working surface. `DESIGN.md:263-281` requires Night/Paper parity, Lucide icons,
  text scaling support, and progressive disclosure instead of another modal.

### Workspace Diff viewer

`apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.tsx:5-16`
defines the stored snapshot and the viewer's current read-only props:

```ts
export type WorkspaceDiffSnapshot = {
  baseRevision: string;
  capturedAt: string;
  patch: string;
  truncated: boolean;
};

type WorkspaceDiffViewerProps = {
  snapshot: WorkspaceDiffSnapshot;
  files: ChangedFile[];
  onClose: () => void;
};
```

Do not add review fields to `WorkspaceDiffSnapshot`. Add an optional renderer
callback such as `onCreateFollowUp?: (content: string) => void` to the viewer.
Keeping the callback optional lets the existing General chat route compile
without exposing the feature there.

`WorkspaceDiffViewer.tsx:55-104` parses only file blocks today:

```ts
export type DiffFileBlock = {
  path: string;
  lines: string[];
};

export function splitPatchIntoFileBlocks(patch: string): DiffFileBlock[] {
  // Splits whenever a line starts with "diff --git ".
}
```

Extend this locally with a small hunk parser. Do not add a parser dependency or
create a generic Git model. A hunk begins at a line whose value starts with
`@@`; it ends immediately before the next hunk header or the end of that file
block. File header lines before the first hunk remain display-only.

`WorkspaceDiffViewer.tsx:234-283` renders immutable metadata and the warning:

```tsx
<p className="mt-1 text-app-12 text-subtle">
  Snapshot against HEAD after the run; may include pre-existing or external changes.
</p>
```

Keep this text visible. The review footer supplements it; it does not replace
or weaken the disclaimer.

`WorkspaceDiffViewer.tsx:287-331` currently renders a 32rem side pane with only
a close command and `WorkspaceDiffContent`. Extend this same pane. Do not open a
second dialog or nest a card inside it.

### Thread-to-Composer state flow

`apps/desktop/src/renderer/routes/ThreadPage.tsx:29-79` owns a page-local
`submitRequest` and passes it into `Composer`. Lines 104-109 render the open
viewer:

```tsx
{
  diffState.open && (
    <WorkspaceDiffViewer
      snapshot={diffState.snapshot}
      files={diffState.files}
      onClose={closeDiff}
    />
  );
}
```

Add a second, distinct page-local state value for a Composer draft request. Do
not route the follow-up through `submitRequest`: that path intentionally starts
a replacement Run immediately after a historical user message edit.

`apps/desktop/src/renderer/components/chat/Composer.tsx:159-193` defines the
external-submit request and duplicates the optional prop across Thread and chat
variants. Add a separate shared request type:

```ts
export type ComposerDraftRequest = {
  content: string;
  requestId: number;
};
```

Only the Thread variant needs to receive it from `ThreadPage`, but the simplest
local shape is to allow the optional prop on both variants while passing it only
from the project Thread route.

`Composer.tsx:638-679` keeps input, Skills, attachments, and the submit request
id in local state/refs:

```ts
const [input, setInput] = useState("");
const [attachedSkills, setAttachedSkills] = useState<SkillRecord[]>([]);
const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
const textareaRef = useRef<HTMLTextAreaElement>(null);
const lastSubmitRequestIdRef = useRef<number | null>(null);
```

The draft effect must update only `input`, `textareaCursor`, focus, and its own
`lastDraftRequestIdRef`. Do not clear or recreate Skill/attachment state.

`Composer.tsx:1489-1500` shows why the existing request cannot be reused:

```ts
useEffect(() => {
  if (!props.submitRequest || lastSubmitRequestIdRef.current === props.submitRequest.requestId) {
    return;
  }

  lastSubmitRequestIdRef.current = props.submitRequest.requestId;
  void handleSend({
    messageId: props.submitRequest.messageId,
    content: props.submitRequest.content,
    attachments: props.submitRequest.attachments,
  });
}, [props.submitRequest?.requestId, props.submitRequest?.content]);
```

Place the new draft-consumption effect near this effect, but it must call
`setInput`, not `handleSend`.

### Test conventions

- `WorkspaceDiffViewer.test.tsx` uses `bun:test`, exported pure helpers, and
  `renderToStaticMarkup`. Extend that pattern; do not add a DOM test framework.
- `Composer.test.ts` imports exported local helpers and tests behavior by input
  and output. Export one small `mergeComposerDraftContent` helper and test it
  there.
- The focused baseline command passed at plan time with 67 tests and 0 failures:
  `rtk bun test apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.test.tsx apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/routes/ThreadPage.test.ts`.

## Commands you will need

| Purpose                | Command                                                                                                                                                                                              | Expected on success                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Focused renderer tests | `rtk bun test apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.test.tsx apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/routes/ThreadPage.test.ts` | all selected tests pass; at least 8 new assertions/cases cover this plan |
| Full tests             | `rtk bun test`                                                                                                                                                                                       | all tests pass                                                           |
| Typecheck              | `rtk bun run typecheck`                                                                                                                                                                              | exit 0, no type errors in any workspace                                  |
| Lint                   | `rtk bun run lint`                                                                                                                                                                                   | exit 0, no findings                                                      |
| Build                  | `rtk bun run build`                                                                                                                                                                                  | exit 0 for every workspace                                               |
| Diff hygiene           | `rtk git diff --check`                                                                                                                                                                               | exit 0, no whitespace errors                                             |
| Scope check            | `rtk git status --short`                                                                                                                                                                             | only files in **Scope** are listed                                       |

## Scope

**In scope** (the only files the executor should modify):

- `apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.tsx`
- `apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.test.tsx`
- `apps/desktop/src/renderer/components/chat/Composer.tsx`
- `apps/desktop/src/renderer/components/chat/Composer.test.ts`
- `apps/desktop/src/renderer/routes/ThreadPage.tsx`
- `plans/README.md` only for the final status update

**Out of scope** (do not touch, even if related):

- `apps/desktop/electron/git/gitIpc.ts` and its tests - the stored snapshot is
  already sufficient; this plan performs no Git operation.
- `apps/desktop/src/renderer/context/WorkspaceDiffContext.tsx` - it already owns
  the open snapshot; review form state stays inside the viewer.
- `apps/desktop/src/renderer/routes/ChatPage.tsx` - General chat has no project
  workspace and must not receive the follow-up action.
- `apps/desktop/src/shared/workspacePersistence.ts` and
  `apps/desktop/src/renderer/mock/uiShellData.ts` - no persisted shape changes.
- `apps/desktop/src/renderer/components/chat/ChangedFilesCard.tsx` - `View diff`
  remains the single entry point.
- Any IPC, preload, Runtime, ACP, permission, attachment, Skill, branch, or
  provider-session code.
- Full patch or diff content in the generated message.
- Exact before/after Run attribution or separation of pre-existing, Coding
  Agent, and external-editor changes.
- Stage, unstage, apply, discard, revert, checkout, stash, commit, or push.
- Per-line comments, multiple independent comments, review approval state,
  pull-request integration, editor integration, or a persistent review model.
- New dependencies, a new state-management abstraction, or a new shared package.

## Git workflow

- Branch: `codex/plan-007-workspace-diff-follow-up`
- Suggested commit: `feat(desktop): add workspace diff follow-ups`
- Keep one focused commit unless the operator requests otherwise.
- Do not push or open a PR unless the operator instructed it.
- Include screenshots of selection, validation-disabled, and populated-review
  states in the PR description because this changes desktop UI.

## Steps

### Step 1: Add pure hunk parsing and draft formatting

In `WorkspaceDiffViewer.tsx`, add the local review target type from the product
contract and a small exported hunk parser, for example:

```ts
export type DiffHunk = {
  header: string;
  lines: string[];
};

export function splitFileBlockIntoHunks(block: DiffFileBlock): DiffHunk[] {
  // Start a hunk only at a line beginning with "@@".
  // Ignore file-header lines before the first hunk.
  // Preserve hunk and line order exactly.
}
```

Add an exported pure formatter such as:

```ts
export function buildWorkspaceDiffFollowUp(options: {
  snapshot: WorkspaceDiffSnapshot;
  reviewNote: string;
  targets: WorkspaceDiffReviewTarget[];
}): string;
```

The formatter must implement the exact draft shown in **Required product
contract**, trim only the outer whitespace of the note, use the full revision
and stored timestamp, serialize paths/headers with `JSON.stringify`, include no
patch body, and preserve target order. It may throw for an empty trimmed note or
empty target list because the UI prevents those calls; tests must cover the
chosen behavior.

Extend `WorkspaceDiffViewer.test.tsx` with behavior-named tests for:

- one file with two hunks, preserving both headers and their order;
- file header lines before the first hunk are not returned as a hunk;
- a file with no hunk marker returns no hunks;
- formatting mixed file and hunk targets in deterministic order;
- full `baseRevision` and `capturedAt` are present;
- paths and hunk headers containing quotes/backslashes are JSON-escaped;
- patch body lines are absent from the generated draft;
- the note is outer-trimmed without rewriting its internal newlines.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.test.tsx`
-> all tests pass, including the new parser and formatter cases.

### Step 2: Add selectable review controls to the existing side pane

Extend `WorkspaceDiffViewerProps` with optional
`onCreateFollowUp?: (content: string) => void`. Review state belongs inside
`WorkspaceDiffViewer`:

- `reviewNote: string`
- selected whole-file targets and hunk targets, represented without duplicates
- no global context or persistence

Keep `WorkspaceDiffContent` usable by the current static-render tests. Either
add optional controlled selection props or introduce one small local selectable
wrapper in the same file. Do not duplicate the diff parser or rendering tree.

Required controls and behavior:

- When `onCreateFollowUp` is absent, render the current read-only viewer without
  checkboxes, note field, or action footer.
- When it is present, place a native checkbox in every parsed file header and
  beside every parsed hunk header. Give each checkbox an accessible label that
  includes the file path and, for hunks, the hunk header.
- Whole-file and hunk selection must follow the mutual-exclusion rules in the
  product contract. Use immutable `Set`/array state updates; do not mutate React
  state in place.
- Treat selection state as membership only. When the action runs, rebuild the
  `WorkspaceDiffReviewTarget[]` by iterating `files` in summary order and each
  parsed block's hunks in patch order. Do not pass `Set` insertion/click order
  into `buildWorkspaceDiffFollowUp`.
- Compute summary-only files by comparing `files` paths with parsed block paths.
  Render binary, omitted, and missing-block summaries in one flat section after
  visible blocks. Do not render a card inside the existing diff blocks.
- Keep `unknown` parsed blocks read-only and exclude them from the selectable
  target list.
- Add a footer separated by one top border. It contains a compact textarea with
  placeholder `What should change?` and a primary Lucide-icon + text button
  labelled `Add follow-up`.
- Use existing semantic Tailwind tokens (`bg-bg`, `bg-surface`, `text-fg`,
  `text-muted`, `border-border`, `border-border-strong`), not new literal colors.
- Use visible `focus-visible` styling for checkboxes, textarea, and action. Keep
  the 32rem pane width and make the diff body, not the footer, own vertical
  scrolling.
- On action, call `buildWorkspaceDiffFollowUp`, pass the result to
  `onCreateFollowUp`, and do not call `onClose` inside the viewer. The route owns
  the close-after-accept sequence.
- Escape and the close button keep their current behavior and never call
  `onCreateFollowUp`.

Add static-render coverage for the two capability states:

- no callback -> current read-only markup and no `Add follow-up` text;
- callback supplied -> review textarea and disabled `Add follow-up` button are
  present before a note/selection;
- summary-only binary/omitted files have selectable whole-file controls;
- the attribution disclaimer remains present.

Static rendering cannot exercise stateful clicks in the current test stack.
Keep the state transitions small and built on the pure parser/formatter tested
in Step 1; do not add a DOM test dependency for this plan.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/chat/WorkspaceDiffViewer.test.tsx`
-> all tests pass and both read-only and review-capable markup are covered.

### Step 3: Add an idempotent Composer draft-input channel

In `Composer.tsx`, export `ComposerDraftRequest` with `content` and `requestId`,
and add optional `draftRequest` to the local prop shape. Keep it separate from
`ComposerSubmitRequest`.

Export and use one pure helper:

```ts
export function mergeComposerDraftContent(current: string, incoming: string): string {
  // Empty/whitespace-only current input -> incoming.
  // Otherwise preserve current input and append "\n\n" + incoming.
}
```

Add `lastDraftRequestIdRef`. In an effect near the existing submit effect:

1. Return when there is no draft or its `requestId` was already applied.
2. Record the new id before scheduling focus.
3. Merge through the functional form of `setInput`; do not read a stale closure.
4. In `requestAnimationFrame`, focus `textareaRef.current`, set its selection to
   the current value length, and update `textareaCursor` to the same value.
5. Do not call `handleSend`, `setAttachedSkills`, `setPendingAttachments`, or any
   Runtime/Git operation.

Extend `Composer.test.ts` using its existing pure-helper style. Cover:

- empty input receives the generated draft unchanged;
- whitespace-only input is replaced;
- existing text is preserved and separated by exactly two newlines;
- trailing whitespace in existing non-empty text does not create extra blank
  lines;
- incoming multiline content is not rewritten.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/chat/Composer.test.ts`
-> all tests pass, including all merge cases.

### Step 4: Wire project Thread review to the draft channel

In `ThreadPage.tsx`:

- import `ComposerDraftRequest` alongside `ComposerSubmitRequest`;
- add `draftRequest` state next to `submitRequest`;
- reset both transient request states when `routeData?.thread.id` changes;
- pass `draftRequest` into the Thread Composer;
- pass `onCreateFollowUp` into `WorkspaceDiffViewer`;
- in that callback, create a request with the supplied content and a fresh
  numeric `requestId`, update `draftRequest`, then call `closeDiff()`.

Do not edit `ChatPage.tsx`. The viewer callback is optional, so its existing
render remains read-only and its Composer receives no draft request.

Do not add the generated draft directly to `WorkspaceContext` messages. It must
remain editable and unsent until the user explicitly submits through the normal
Composer path.

**Verify**:
`rtk bun run typecheck`
-> exit 0; `ThreadPage` supplies the new optional props and `ChatPage` compiles
unchanged.

### Step 5: Exercise the desktop workflow manually

Run `rtk bun run dev:desktop` and use a disposable Git project with a committed
baseline and at least two changed text files. One file must have two separated
hunks; also include one untracked or binary file if convenient.

Verify this sequence:

1. Finish a project Run so Carrent appends a Workspace changes card, or use an
   existing stored card with the required snapshot.
2. Open `View diff`; confirm no Git state changes merely from opening it.
3. Select one entire file and one hunk in a different file.
4. Confirm the same file cannot remain selected as both entire-file and hunk
   scope.
5. Confirm `Add follow-up` is disabled without a non-empty note.
6. Enter a note and add the follow-up.
7. Confirm the viewer closes, the Composer contains the exact generated shape,
   no message was sent, and the caret is at the end.
8. Repeat with pre-existing Composer text and confirm it is preserved above the
   review draft.
9. Repeat while an Image Attachment or Skill is pending and confirm it remains.
10. Close with Escape and confirm the Composer does not change.
11. Confirm binary/omitted summary files can be selected only as whole files.
12. Confirm the UI is usable in Night and Paper themes at the minimum window
    size and with a large text setting.

Stop the dev process before continuing.

**Verify**:
`rtk git status --short`
-> the disposable project may be dirty by setup, but Carrent review actions add
no new workspace/index changes; the Carrent repo lists only in-scope source/test
files and `plans/README.md`.

### Step 6: Run repository gates and update the plan index

Run the focused tests, full tests, typecheck, lint, build, and diff hygiene
commands from **Commands you will need**. Fix only failures caused by this plan.

After all gates pass, change Plan 007's status in `plans/README.md` from `TODO`
to `DONE`. Do not alter older plan statuses or findings.

**Verify**:

- `rtk bun test` -> all tests pass.
- `rtk bun run typecheck` -> exit 0.
- `rtk bun run lint` -> exit 0.
- `rtk bun run build` -> exit 0 for every workspace.
- `rtk git diff --check` -> exit 0.
- `rtk git status --short` -> only the in-scope files are listed.

## Test plan

Use existing `bun:test` tests; add no test dependency.

`WorkspaceDiffViewer.test.tsx` must cover:

- hunk parsing with zero, one, and multiple hunks;
- deterministic file/hunk target formatting;
- full snapshot metadata and attribution disclaimer in generated text;
- JSON-safe path/header rendering and no patch body in the draft;
- review controls absent without the callback;
- review controls present and initially disabled with the callback;
- summary-only file selection markup;
- existing truncation, omission, escaping, and file-block behavior remains.

`Composer.test.ts` must cover:

- empty, whitespace-only, and existing Composer input merge behavior;
- exactly one blank line between existing input and incoming draft;
- multiline incoming content preservation.

The route wiring is guarded by TypeScript plus the manual workflow. Do not add a
renderer DOM test framework solely to simulate checkbox clicks.

## Done criteria

All criteria must hold:

- [ ] The focused renderer command passes with at least 8 new behavior cases
      across `WorkspaceDiffViewer.test.tsx` and `Composer.test.ts`.
- [ ] `rtk bun test` passes.
- [ ] `rtk bun run typecheck` exits 0.
- [ ] `rtk bun run lint` exits 0.
- [ ] `rtk bun run build` exits 0 for every workspace.
- [ ] `rtk git diff --check` exits 0.
- [ ] Project Thread diffs expose file/hunk review and `Add follow-up`.
- [ ] General chat remains read-only and `ChatPage.tsx` is unchanged.
- [ ] The action populates but never sends the Composer.
- [ ] Existing Composer text, Image Attachments, Skills, Runtime/model/mode, and
      branch selection survive draft application.
- [ ] The generated draft contains full stored snapshot metadata and only file
      paths/hunk headers, not patch bodies.
- [ ] Opening, selecting, closing, and adding a draft perform no Git/IPC action.
- [ ] No persisted workspace/message/snapshot type changes were made.
- [ ] Only files listed under **In scope** changed.
- [ ] Plan 007 is marked `DONE` in `plans/README.md` after verification.

## STOP conditions

Stop and report back; do not improvise if:

- Any in-scope code no longer matches the Current state excerpts or the drift
  check shows semantic changes to the viewer, Composer request effects, or
  Thread route wiring.
- A correct follow-up appears to require changing `WorkspaceDiffSnapshot`,
  persisted `Message` types, workspace snapshot version, IPC, preload, or Git
  capture behavior.
- The stored patch cannot identify file paths and hunk headers without querying
  the live repository.
- The implementation would need to auto-send a message or invoke a Git mutation
  to complete the workflow.
- The action cannot preserve pending Composer text, Image Attachments, and
  attached Skills without moving Composer state into a new global store.
- General chat must be modified to make project Thread follow-up work.
- A new parser, editor, state-management, or DOM-testing dependency appears
  necessary.
- The existing attribution disclaimer would need to be removed or the UI would
  imply the selected changes belong exclusively to the Coding Agent.
- A verification command fails twice after reasonable fixes limited to in-scope
  files.

## Maintenance notes

- A follow-up draft references a historical snapshot, while the Runtime reads
  current workspace files. Keep the final stale-snapshot instruction unless a
  future feature adds verified live correspondence.
- Reviewers should scrutinize that no patch body, hidden diff payload, or local
  Git mutation entered the send path. The visible draft is the complete context
  added by this feature.
- If exact per-Run attribution is added later, update the disclaimer and draft
  vocabulary only after that attribution contract is proven; do not infer it
  from Kimi tool-call text.
- If future review UX adds per-line comments or structured Runtime context,
  migrate from the visible-text tracer bullet deliberately. Do not silently add
  hidden context that the user cannot inspect before sending.
- Whole-file and hunk selection is transient by design. Persistence belongs to
  a future review model, not `WorkspaceDiffSnapshot`.
- Preserve the optional viewer callback. It is the capability boundary that
  keeps General chat read-only while project Threads can create follow-ups.
