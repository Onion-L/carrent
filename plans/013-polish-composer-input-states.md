# Plan 013: Make the Composer input and transient states read as one surface

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**:
> `git diff --stat eb682ff..HEAD -- apps/desktop/src/renderer/components/chat/Composer.tsx && git diff --stat -- apps/desktop/src/renderer/components/chat/Composer.tsx`
> At planning time, `Composer.tsx` already had uncommitted Plan 012 Subagent
> Task integration changes (import/callback/message-part updates, not input
> presentation changes). Preserve them. If committed or uncommitted changes
> alter the JSX described under "Current state", compare the excerpts against
> the live code and treat a mismatch as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/012-kimi-subagent-inspector.md`
- **Category**: tech-debt
- **Planned at**: commit `eb682ff`, 2026-07-23

## Why this matters

The Composer is Carrent's primary working surface, but its Approval Requests,
queued messages, text field, and toolbar currently read as separate nested
boxes. The target is the composition in the user-provided Codex reference: a
queued/status row attached above a single broad input panel, with the message
field left visually open and controls aligned along the bottom. Borrow that
structure, not Codex's exact dimensions, colors, copy, or controls; Carrent must
keep its own quiet palette, compact density, and existing workflows.

## Current state

- `apps/desktop/src/renderer/components/chat/Composer.tsx` owns the complete
  Composer UI and behavior. Keep the work local to this file.
- The outer surface at `Composer.tsx:2190` is:

  ```tsx
  <div className="rounded-xl border border-border bg-surface-raised/90 p-3 shadow-[0_18px_60px_rgb(0_0_0/0.18)]">
  ```

  It has no visible `focus-within` treatment, so keyboard focus is carried by
  the caret rather than by the input surface.
- Approval Requests at `Composer.tsx:2191-2240` render above the input as
  individually bordered `rounded-xl` rows with a second background:

  ```tsx
  <div className="mb-2 space-y-2">
    ...
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border-strong bg-bg/45 px-3 py-2">
  ```

  The title and detail both truncate. The approve and deny controls are
  icon-only circular buttons with `title` text but no `aria-label`.
- Queued messages at `Composer.tsx:2354-2465` use another set of bordered,
  rounded rows:

  ```tsx
  <div className="mb-2 space-y-1.5">
    ...
    <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-bg/45 px-2.5 py-1.5">
  ```

  Each row repeats the `CornerDownRight` icon and keeps all metadata and
  actions on one line. Long text and several actions compete for width.
- The actual message field at `Composer.tsx:2466-2559` is unframed within the
  Composer. Attached Skill references and the textarea share a wrapping flex
  row; preserve that behavior and all keyboard handling.
- The control toolbar begins at `Composer.tsx:2561`. It is separated only by
  `mt-3`; retain all control ordering, menus, disabled states, and send/stop
  behavior.
- The user-provided Codex reference establishes these visual requirements,
  inlined here because the clipboard image is not a stable repository asset:
  - A queued/status row is a full-width sibling layer directly above the main
    input, not a small card nested inside it.
  - The status layer and main input share an edge and width so they read as one
    stacked control. The main input remains the visually dominant foreground
    layer.
  - The row uses a leading turn/queue icon, one-line content, and quiet actions
    aligned at the right.
  - The input panel uses one neutral background, one subtle border, generous
    message space, and an unframed toolbar along the bottom.
  - The reference is dark-only, but this implementation must retain Carrent's
    equivalent hierarchy in both Night and Paper themes.
- `DESIGN.md:134-279` defines the applicable visual rules: Quiet Workbench,
  warm neutral tokens, semantic warning color only for actionable attention,
  tonal layers and 1px hairlines before shadows, compact controls, visible
  focus, and no nested cards or decorative gradients.
- `DESIGN.md:255-257` specifically defines the Composer as a raised,
  large-radius tool capped at `48rem`, with the message field first and controls
  grouped below. Preserve the `max-w-[48rem]` wrapper at `Composer.tsx:2109`.
- `PRODUCT.md:23-33` requires execution state and approvals to remain clear,
  keyboard focus to be visible, and controls to work with text scaling and
  constrained windows.
- `apps/desktop/CONTEXT.md:31-34` names the user-facing concept **Approval
  Request**. Do not introduce "permission request" in visible copy; permission
  remains implementation terminology.
- Match existing Tailwind token usage in this same component: `bg-surface-raised`,
  `bg-bg`, `border-border`, `border-border-strong`, `text-fg`, `text-muted`,
  `text-subtle`, and `text-warning`. Do not add literal colors.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Focused tests | `bun test apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts` | exit 0; all tests pass |
| Typecheck | `bun run typecheck` | exit 0; Turbo reports all workspace typechecks successful |
| Lint | `bun run lint` | exit 0; no lint errors |
| Visual check | `bun run dev:desktop` | Electron window opens and the Composer is usable |

## Scope

**In scope** (the only source file to modify):

- `apps/desktop/src/renderer/components/chat/Composer.tsx`
- `plans/README.md` only for the final status update

**Out of scope** (do not touch):

- Queue storage, recovery, ordering, steering, editing, or send behavior in
  `apps/desktop/src/renderer/hooks/chatMessageQueue.ts`.
- Approval filtering, protocol types, response handling, or Plan Review logic.
- Attachment presentation, Slash menus, Runtime Setup warnings, runtime/model/
  mode/branch menus, and their copy.
- Route layout, the `48rem` Composer width cap, and centered empty-thread
  placement.
- Shared CSS tokens, `DESIGN.md`, and `packages/ui`.
- New component files, style abstractions, animation libraries, or snapshot
  tests that assert complete Tailwind class strings.
- The in-progress Plan 012 Subagent Task changes already present in the working
  tree.

## Git workflow

- Branch: `codex/013-polish-composer-input-states`
- Keep this as one focused UI commit. Use the repository's Conventional Commit
  style, for example `fix(desktop): refine skill reference styling`.
- Do not push or open a PR unless the operator instructs you.

## Steps

### Step 1: Establish the Codex-inspired stacked Composer structure

In `Composer.tsx`, move only the rendered Approval Request and queued-message
blocks so they are siblings immediately above the main Composer surface inside
the existing `max-w-[48rem]` wrapper. Do not move their state, callbacks, or
helper logic.

- Render transient rows in one attached status layer. When both kinds are
  present, keep Approval Requests first and visually stronger, followed by
  queued messages. Separate rows with hairlines rather than independent boxes.
- Join the status layer to the main Composer with a shared width and a collapsed
  1px edge (for example `-mb-px`). A small layered offset is acceptable only if
  padding fully protects row content; no text or control may be covered.
- Keep one `rounded-xl`, one outer border, the raised neutral background, and
  the existing shadow on the main Composer. Keep the main Composer in front of
  the status layer without clipping Slash menus or control popovers.
- Add a 150-260 ms border/ring transition and a visible, low-contrast
  `focus-within` state using `border-border-strong` and existing tokens. The
  focus treatment must not change dimensions.
- Keep the textarea visually open inside the Composer rather than putting it in
  another rounded bordered box.
- Increase the textarea's resting message area modestly from the current 48px
  minimum to roughly 80-96px. Do not copy the screenshot's exact height or add
  viewport-based sizing. The input should remain compact enough for Carrent's
  sustained desktop workflow.
- Keep the toolbar unframed, as in the reference. Use spacing rather than a
  divider or a second background to separate it from the message field.
- Do not change textarea value handling, keyboard shortcuts, placeholder,
  Skill reference rendering, or any control behavior.

**Verify**:
`bun test apps/desktop/src/renderer/components/chat/Composer.test.ts` -> exit 0;
all existing Composer tests pass.

### Step 2: Present Approval Requests in the attached status layer

Restyle the Approval Request block at the current lines 2191-2240 as compact
rows in the attached layer created in Step 1:

- Keep the layer neutral like the Codex reference, with a restrained
  low-opacity `warning` tone or warning-colored icon to mark that action is
  required. Do not add a colored side stripe, gradient, shadow, or separate
  card per request.
- Add one existing Lucide attention/lock icon per request, colored with
  `text-warning`, so the state does not depend on color alone.
- Keep the title as the primary compact label. Let the detail wrap or break
  safely instead of disappearing behind a single-line truncation when it is a
  long command or path. It must not push action buttons outside the surface.
- Preserve multiple pending requests as a dense list with hairline separators,
  not individually framed boxes.
- Keep the circular approve and deny controls and their 28px stable dimensions.
  Add explicit `aria-label` values that include the action and request title;
  retain concise tooltips.
- Do not change `getActionablePermissionsForThread`, `getPermissionDetail`,
  `getPermissionOption`, or `handlePermissionResponse`.

**Verify**:
`bun test apps/desktop/src/renderer/components/chat/Composer.test.ts` -> exit 0;
the Approval Request helper tests still pass.

### Step 3: Match queued messages to the reference row

Restyle the queued-message block at the current lines 2354-2465:

- Do not add a `Queued` heading or count; the reference communicates the state
  through the leading `CornerDownRight` icon and the row's attached position.
- Remove the repeated card treatment but keep one leading `CornerDownRight`
  icon per queued row, matching the reference and preserving a non-color cue.
  Use a flat list with subtle separators in the attached status layer.
- Give message content the flexible column and actions a stable trailing
  column. Keep the common case on one line like the reference. At constrained
  widths, metadata and actions may wrap beneath the message, but no button or
  label may overlap or leave the Composer.
- Preserve the attachment count, `Restored` non-color cue, `Steer`/`Send`, edit,
  delete, save, and cancel affordances. Keep all current callbacks, labels,
  tooltips, and confirmation behavior.
- Give the inline edit input a visible focus treatment using existing border or
  ring tokens without changing its commit-on-blur, Enter, or Escape behavior.
- Keep each row compact at roughly 40-48px high; this is an operational status
  layer, not a set of cards.

**Verify**:
`bun test apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts apps/desktop/src/renderer/components/chat/Composer.test.ts`
-> exit 0; queue ordering, recovery, edit helpers, and Composer tests all pass.

### Step 4: Verify combined and constrained states visually

Run `bun run dev:desktop` and inspect the existing Composer in both Night and
Paper themes. Exercise or temporarily reach the states through developer tools
without committing fixtures or mock-data changes. Check all of these scenarios:

1. Empty and multi-line message input, focused and unfocused.
2. One queued message and three queued messages, including a long message, an
   attachment count, inline editing, and a `Restored` item.
3. One Approval Request and multiple requests, including a long command/path.
4. Approval Requests and queued messages visible at the same time.
5. The scenarios above at a narrow desktop window around 1024x700 and a normal
   wide window, in both themes.
6. Minimum and maximum supported app text sizes (8px and 32px): text may wrap,
   but controls must remain reachable and content must not overlap.

Confirm that the visual order is attached Approval Requests, attached queued
messages, then the main Composer containing attachments/notices, message field,
and toolbar. Confirm that Slash menus and control popovers still open above the
entire stack and are not clipped.

**Verify**: Close the dev process cleanly after inspection. `git status --short`
must show no new source changes outside `Composer.tsx` and no committed debug
fixtures or screenshots.

### Step 5: Run repository gates

Run the full static checks after the visual pass.

**Verify**:

- `bun run typecheck` -> exit 0; all workspace typechecks succeed.
- `bun run lint` -> exit 0; no lint errors.
- `git diff --check` -> exit 0; no whitespace errors.
- `git diff --name-only` -> source changes are limited to
  `apps/desktop/src/renderer/components/chat/Composer.tsx`, plus pre-existing
  Plan 012 working-tree changes and the allowed `plans/README.md` status update.

## Test plan

- Do not add brittle automated tests for Tailwind class strings. This is a
  presentation-only change and the current `Composer.test.ts` is a pure-helper
  suite rather than a component-rendering harness.
- Run `Composer.test.ts` to protect submission, Approval Request selection, and
  related Composer helpers.
- Run `chatMessageQueue.test.ts` to protect FIFO order, edit/removal,
  attachment metadata, recovered-message confirmation, and persistence.
- Use the six visual scenarios in Step 4 as the acceptance test. Pay particular
  attention to keyboard focus, long details, simultaneous queue/approval state,
  Paper/Night parity, and 8px/32px text scaling.

## Done criteria

- [ ] `bun test apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `git diff --check` exits 0.
- [ ] The Composer has a visible keyboard focus state with no layout shift.
- [ ] Approval Requests use the attached status layer, preserve all response
      options, expose accessible action names, and handle long details.
- [ ] Queued messages match the reference's attached one-line row, preserve
      every existing action/state, and remain readable at constrained widths.
- [ ] Approval Requests and queued messages can coexist without nested-card
      clutter, overlap, clipping, or popover regressions in both themes.
- [ ] The main Composer remains one unframed neutral input surface with a
      modestly larger message area and toolbar controls along the bottom.
- [ ] The visual check passes at 1024x700 and at 8px/32px app text sizes.
- [ ] No source files outside `Composer.tsx` were changed by this plan.
- [ ] The Plan 012 working-tree changes are preserved.
- [ ] The row for Plan 013 in `plans/README.md` is updated to `DONE`.

## STOP conditions

Stop and report back; do not improvise if:

- Plan 012 is still being actively edited in `Composer.tsx` by another agent or
  its changes conflict with the Composer JSX in this plan.
- The Approval Request, queued-message, textarea, or toolbar structure no longer
  matches the excerpts and ordering in "Current state".
- The styling requires changing queue persistence, approval protocol behavior,
  shared tokens, route layout, or another source file.
- A visual state cannot be reached without committing test-only production UI
  or changing persisted user data.
- Slash menus or control popovers become clipped and fixing that would require
  moving portals or restructuring menu behavior.
- A verification command fails twice after a reasonable local correction.

## Maintenance notes

- Review future Composer additions as one of three layers: attached transient
  status, message content, or execution controls. Avoid adding an independently
  bordered card inside the main input.
- Recheck the attached-row layout when queue actions or Approval Request option
  kinds are added; the trailing control column is the likely pressure point.
- A future component-test harness may add semantic interaction coverage for the
  rendered queue and Approval Request controls. Adding that harness solely for
  this small style change is intentionally deferred.
