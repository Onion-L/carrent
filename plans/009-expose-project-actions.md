# Plan 009: Expose project actions from the fixed project rail

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's row in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `rtk git diff --stat 56b3117..HEAD -- apps/desktop/src/renderer/components/SidebarNav.tsx apps/desktop/src/renderer/components/SidebarNav.test.ts`
> If either source file changed since this plan was written, compare the
> excerpts below with the live code. A semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `56b3117`, 2026-07-21

## Why this matters

Carrent's active shell always renders the 58px project rail in collapsed mode.
`SidebarNav` currently hides its only Project actions trigger and menu whenever
that mode is active, so users can add and open projects but cannot reveal,
rename, copy, or delete them. Project deletion also owns Thread, Runtime Session,
and Image Attachment cleanup, so an unreachable menu leaves persisted data with
no normal UI path to remove it.

Keep the 58px rail. Add a compact, keyboard-focusable action trigger to each
collapsed project tile and open a fixed-position menu outside the rail's clipped
scroll area. Preserve the existing Project actions and mutation behavior.

## Current state

### Relevant files

- `apps/desktop/src/renderer/components/DesktopShell.tsx` defines the active
  three-pane shell. It is evidence only and must not be modified.
- `apps/desktop/src/renderer/components/SidebarNav.tsx` owns project tiles,
  Project actions, the New Project dialog, and all local menu/rename state.
- `apps/desktop/src/renderer/components/SidebarNav.test.ts` contains the existing
  Sidebar navigation helper tests and is the focused regression-test file.
- `apps/desktop/src/renderer/context/WorkspaceContext.tsx` owns `removeProject`
  and `renameProject`. Those implementations are already functional and must not
  be changed by this plan.

### The shell is permanently collapsed

`apps/desktop/src/renderer/components/DesktopShell.tsx:87-90`:

```tsx
<div className="min-h-0 shrink-0" style={{ width: LEFT_SIDEBAR_WIDTH }}>
  <SidebarNav collapsed={true} />
</div>
```

`DESIGN.md` requires this shape: "A 58px project rail and a resizable
200px-480px secondary pane frame the task area." Do not solve this bug by making
the project rail permanently wider or by repurposing the secondary-pane toggle.

### The only trigger and menu reject collapsed mode

`apps/desktop/src/renderer/components/SidebarNav.tsx:128-131`:

```tsx
{projects.map((project) => {
  const isActive = project.id === activeProjectId;
  const showActions = !collapsed && hoveredProjectId === project.id;
  const menuOpen = openProjectMenuId === project.id;
```

`apps/desktop/src/renderer/components/SidebarNav.tsx:198-213`:

```tsx
{showActions && editingProjectId !== project.id && (
  <button
    data-project-menu-trigger="true"
    onClick={(e) => {
      e.stopPropagation();
      setOpenProjectMenuId(menuOpen ? null : project.id);
    }}
    aria-label="Project actions"
  >
    <MoreHorizontal className="h-3.5 w-3.5" />
  </button>
)}

{menuOpen && !collapsed && (
  // Open in Finder, Rename project, Copy path, and Delete
)}
```

The project list scrolls inside an `aside` with `overflow-hidden`. A normal
absolute popover extending to the right of the 58px rail may be clipped. The
collapsed menu therefore needs `position: fixed` coordinates derived from the
trigger's viewport rectangle.

### Rename assumes a wide inline row

The current inline rename input is guarded by
`editingProjectId === project.id && !collapsed`. Preserve that behavior for a
future expanded rail. In collapsed mode, the Rename project action needs a small
dialog using the same restrained surface, border, radius, and focus treatment as
the existing New Project dialog later in `SidebarNav.tsx`.

### Existing mutation behavior is already correct

`WorkspaceContext.tsx:552-574` already exposes asynchronous `removeProject` and
synchronous `renameProject`. The existing Project actions menu already calls
these methods, displays deletion failures through `showToast`, opens Finder
through `window.carrent.shell.openPath`, and copies through
`window.carrent.clipboard.writeText`. Reuse those paths exactly; do not add a new
data layer or change cleanup semantics.

### Design constraints

Match these existing Carrent rules:

- Keep the fixed 58px project rail and compact three-pane hierarchy.
- Menus use the existing `bg-surface`, `border-border-strong`, `rounded-lg`, and
  `shadow-xl` treatment.
- Icon-only controls require a tooltip/title and an accessible name.
- Hover changes tone, while keyboard focus uses a visible outline or ring.
- Preserve Night/Paper token usage; do not add literal theme colors.
- The menu and rename dialog must remain usable with 8px-32px text scaling and
  constrained window sizes.

Use the existing New Project dialog in `SidebarNav.tsx:308-366` as the dialog
visual exemplar. Use the fixed floating-panel positioning approach in
`Composer.tsx` only as behavioral reference; do not move Composer helpers into
Sidebar or create a shared popover framework for this plan.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Focused tests | `rtk bun test apps/desktop/src/renderer/components/SidebarNav.test.ts` | all selected tests pass |
| Renderer tests | `rtk bun test apps/desktop/src` | all renderer/shared tests pass |
| Typecheck | `rtk bun run typecheck` | exit 0, no errors |
| Lint | `rtk bun run lint` | exit 0, no findings |
| Build | `rtk bun run build` | every workspace builds |
| Diff hygiene | `rtk git diff --check` | no whitespace errors |

## Scope

**In scope** (the only source files to modify):

- `apps/desktop/src/renderer/components/SidebarNav.tsx`
- `apps/desktop/src/renderer/components/SidebarNav.test.ts`
- `plans/009-expose-project-actions.md` only for status updates
- `plans/README.md` only for status updates

**Out of scope** (do not modify):

- `DesktopShell.tsx` or the 58px rail width.
- `WorkspaceContext.tsx`, project deletion, Runtime Session deletion, or Image
  Attachment deletion semantics.
- Thread/message hover actions; those belong to a separate accessibility finding.
- A general popover, menu, dialog, or renderer interaction-test framework.
- New dependencies or changes to `package.json` / `bun.lock`.
- New Project dialog behavior, project creation, project navigation, or Settings.
- Adding a new delete confirmation; retain the current delete behavior.
- General-chat navigation or project/thread domain types.

## Git workflow

- Branch: `codex/plan-009-project-actions`
- Suggested commit: `fix(desktop): expose project actions in collapsed rail`
- Keep one focused commit unless the operator requests otherwise.
- Do not push or open a PR unless instructed.
- Include Night and Paper screenshots showing the collapsed trigger and open
  Project actions menu in the PR description.

## Steps

### Step 1: Add focused seams for the collapsed trigger and floating menu

In `SidebarNav.tsx`, add small local helpers/types rather than a generic overlay
framework:

1. Add a menu-position type containing `top` and `left` viewport coordinates.
2. Add and export a pure `getProjectActionsMenuPosition` helper. It must accept
   the trigger rectangle, measured menu width/height, viewport width/height, and
   a small viewport margin. Prefer opening to the trigger's right; if that would
   overflow, place it to the left. Clamp the final top and left so the measured
   menu stays inside the viewport.
3. Extract and export the existing four action rows as a controlled
   `ProjectActionsMenu` test seam so expanded and collapsed modes use the same
   labels, icons, callbacks, danger styling, and error behavior. It must expose
   `role="menu"`; each action uses `role="menuitem"`. Keep the component in
   `SidebarNav.tsx`; it is exported only so `SidebarNav.test.ts` can render it.
4. If a small controlled trigger or rename-dialog component is needed for static
   rendering tests, export it under the same test-seam rule and keep it inside
   `SidebarNav.tsx`; do not create another source file.

In `SidebarNav.test.ts`, follow the existing Bun-test style and add tests for:

- positioning to the right of a normal collapsed-rail trigger;
- falling back left when the right side has insufficient space;
- clamping a menu near the viewport bottom and top;
- static menu markup containing exactly Open in Finder, Rename project, Copy
  path, and Delete with menu semantics;
- an icon trigger markup seam, if extracted, containing a project-specific
  accessible name such as `Project actions for Carrent`.

Use `react-dom/server` with `React.createElement` if static component markup is
tested; keep the existing `.test.ts` filename and do not add a DOM library.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/SidebarNav.test.ts`
→ all existing and new tests pass.

### Step 2: Expose the action trigger in the collapsed project tile

Update each project row so collapsed tiles keep their existing navigation button
and initial, while also exposing a compact `MoreHorizontal` action button:

- Keep the action button mounted so it can receive keyboard focus.
- Position it in a stable corner of the 44px project tile without changing the
  row's 48px height or rail width.
- It may be visually quiet at rest, but it must become visible on row hover,
  `focus-within`, and while its menu is open. Do not use conditional rendering
  based only on mouse hover.
- Give it `aria-label="Project actions for <project name>"` and a matching title.
- Clicking it must stop project navigation, capture its
  `getBoundingClientRect()`, and toggle only that project's menu.
- Preserve the active project ring and the initial as the first visual signal.

Render the collapsed action menu once outside the rail's overflow containers as
a `fixed` panel. Measure it after opening, call
`getProjectActionsMenuPosition`, and apply the resulting coordinates. Recalculate
or close on viewport resize; close on outside pointer press and Escape. Move
focus to the first menu item after opening and return focus to the trigger after
Escape or a non-navigation cancellation.

Do not change the existing expanded-mode inline layout. Both modes must call the
same extracted action callbacks.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/SidebarNav.test.ts`
→ the collapsed-trigger/menu regression tests pass.

### Step 3: Make Rename project usable from collapsed mode

When Rename project is chosen from the collapsed menu:

1. Close the actions menu.
2. Open a compact dialog containing the current project name in an autofocus
   text input, plus Cancel and Rename commands.
3. Submit on Enter or the Rename button. Trim through the existing
   `renameProject` behavior; close only when it returns `true`.
4. Cancel on Escape, Cancel, or backdrop click without changing the project.
5. Keep visible focus styling and an accessible dialog label such as
   `Rename <project name>`.

Use the New Project dialog's existing backdrop, surface, typography, and button
tokens. Do not modify the existing expanded-mode inline rename path.

Open in Finder, Copy path, and Delete must continue to call their existing
bridges/context methods. Delete errors must still use the existing toast and must
not close over the wrong project after switching active projects.

Add focused pure/static tests for any newly extracted rename-dialog component or
state helper. Do not claim full browser interaction coverage; that belongs to the
separate renderer interaction-test plan.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/SidebarNav.test.ts`
→ all project action and rename seams pass.

### Step 4: Run repository gates and inspect scope

Run, in order:

1. `rtk bun test apps/desktop/src`
2. `rtk bun run typecheck`
3. `rtk bun run lint`
4. `rtk bun run build`
5. `rtk git diff --check`
6. `rtk git status --short`

Expected results: all commands exit 0; the status output contains no modified
source files outside `SidebarNav.tsx` and `SidebarNav.test.ts` (plus the plan and
index status files).

Start the desktop app and verify both Night and Paper themes at the normal window
size and the minimum supported window size:

- project tile still navigates;
- the action trigger opens the correct project's menu;
- the menu is not clipped near the top or bottom of the project list;
- Tab/Shift+Tab, Enter/Space, and Escape work;
- Rename, Open in Finder, Copy path, and Delete preserve existing behavior;
- the menu and dialog remain readable at the largest app text setting.

Attach screenshots of the open menu in both themes to the PR. This visual check
is required in addition to, not instead of, the automated gates.

## Test plan

Extend `apps/desktop/src/renderer/components/SidebarNav.test.ts` and keep its
existing Bun `describe` / `it` / `expect` style.

Required regression cases:

- collapsed project action menu chooses right-side placement when space exists;
- menu falls back left and clamps vertically at viewport boundaries;
- rendered controlled menu exposes all four existing commands and menu roles;
- collapsed icon trigger has a project-specific accessible name;
- rename-dialog/static seam contains the current project name and labelled
  Cancel/Rename commands, if that seam is extracted;
- existing route helper tests remain unchanged and pass.

Verification:

`rtk bun test apps/desktop/src/renderer/components/SidebarNav.test.ts`
→ all existing tests plus the new regression cases pass.

## Done criteria

- [ ] `SidebarNav collapsed={true}` exposes a visible/focusable Project actions
      trigger for every project without changing the 58px rail.
- [ ] The fixed Project actions menu stays inside the viewport and is not clipped
      by the rail or project-list overflow containers.
- [ ] Open in Finder, Rename project, Copy path, and Delete are reachable in the
      collapsed mode and retain existing callbacks/error handling.
- [ ] Rename works through the collapsed-mode dialog; empty names are not saved.
- [ ] The trigger, menu, and dialog support keyboard focus, Enter/Space, and Escape.
- [ ] Focused Sidebar tests pass with the new placement and static-markup cases.
- [ ] `rtk bun test apps/desktop/src` exits 0.
- [ ] `rtk bun run typecheck` exits 0.
- [ ] `rtk bun run lint` exits 0 with no findings.
- [ ] `rtk bun run build` exits 0.
- [ ] `rtk git diff --check` exits 0.
- [ ] No source file outside the two-file scope is modified.
- [ ] `plans/README.md` marks Plan 009 DONE.

## STOP conditions

Stop and report; do not improvise if:

- `DesktopShell` no longer renders a fixed 58px `SidebarNav collapsed={true}`.
- Project actions have moved to another user-visible surface since commit
  `56b3117`, making this plan duplicate UI.
- The existing four actions or their Workspace/bridge contracts changed from the
  Current state above.
- A fixed-position menu cannot escape the rail's clipping without changing
  `DesktopShell.tsx` or introducing a portal/dependency.
- Correct project deletion requires changing cleanup semantics in
  `WorkspaceContext.tsx`.
- The rename flow cannot be implemented locally without a new dialog framework
  or package dependency.
- Any verification command fails twice after a reasonable local correction.
- The implementation needs a source file outside the declared scope.

## Maintenance notes

- If the project rail later becomes expandable, keep both modes on the same
  `ProjectActionsMenu` callbacks and remove collapsed-only positioning only after
  equivalent access is verified.
- Reviewers should inspect focus return, outside-click cleanup, stale project IDs,
  viewport clamping, and whether the overlay hides the project initial at rest.
- General renderer interaction testing remains a separate audit finding. The
  focused seams here must not be presented as end-to-end coverage.
- Thread/message hover-only actions are also separate; do not fold them into this
  change merely because the styling is nearby.
