# Plan 008: Add first-class Kimi Plan Mode and Plan Review

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When done, update
> this plan's row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `rtk git diff --stat c580eea..HEAD -- apps/desktop/electron/chat/kimiAcpChat.ts apps/desktop/src/shared/chat.ts apps/desktop/src/shared/chatPermissions.ts apps/desktop/src/shared/workspacePersistence.ts apps/desktop/src/renderer/mock/uiShellData.ts apps/desktop/src/renderer/lib/workspaceState.ts apps/desktop/src/renderer/context/WorkspaceContext.tsx apps/desktop/src/renderer/hooks/useChatRun.ts apps/desktop/src/renderer/components/chat/Composer.tsx apps/desktop/src/renderer/components/chat/MessageTimeline.tsx apps/desktop/src/renderer/routes/ThreadPage.tsx apps/desktop/src/renderer/routes/ChatPage.tsx`
> If any in-scope source file changed, compare the Current state and observed
> ACP contract below with live code. A semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `c580eea`, 2026-07-20

## Why this matters

Carrent exposes Kimi's model and permission choices but has no first-class Plan
Mode. Sending `/plan` today either enters the Skill search path or becomes
ordinary prompt text. Carrent also discards the plan Markdown from Kimi's
`ExitPlanMode` request.

This is not a prompt-prefix feature. Kimi Code 0.23.5 exposes Plan as an ACP
session mode, writes a runtime-owned plan file, and sends a structured Plan
Review. Carrent presents the plan, exits the planning Run without implementation,
and lets the user's next natural-language message determine what Kimi does next.

## Required product contract

Implement this behavior exactly:

1. Plan Mode is Kimi-only. Do not add UI or mappings for disabled runtimes.
2. Typing `/plan` shows a slash suggestion styled and positioned like a Skill
   suggestion. Selecting it removes the token and attaches a removable
   `Plan mode` marker inside the Composer.
3. Selecting `/plan` with no task does not create a message or start a Run. The
   marker does not count as sendable content.
4. Submitting `/plan <task>` removes the command token, attaches the marker,
   stores Plan Mode on the Thread, and sends `<task>` in Plan Mode immediately.
5. Plan Mode persists on the Thread across follow-up Runs until the marker is
   removed or Kimi successfully leaves Plan Mode.
6. Removing the marker during a live Run changes only future Runs. The current
   Run keeps the `planMode` value captured in its `ChatTurnRequest`.
7. A Plan Run uses Kimi's native `mode = "plan"`. The Thread's separate
   permission choice is restored on its next Run.
8. If Kimi calls `EnterPlanMode` or `ExitPlanMode` itself, Carrent synchronizes
   the Thread marker from the completed tool result.
9. Kimi's Plan Review appears as a read-only, persistent block in the assistant
   message timeline without approval buttons.
10. Carrent selects Kimi's conversation-exit option internally so the planning
    Run ends without implementation and Plan Mode is removed from the Thread.
11. The assistant asks for a natural-language reply after the plan. Carrent does
    not parse approval keywords; the next message is sent unchanged to Kimi.
12. Plan Reviews remain in history as plan content only. Runtime option ids,
    internal rejection wording, and stale approval state are not shown.
13. The plan body is not editable in Carrent. The user requests revisions in the
    next conversation message.
14. Plan files remain runtime-owned. Carrent may read and write only the current
    Kimi Runtime Session's `agents/.../plans/*.md` path outside the project, as
    recorded in ADR 0009. General home-directory access remains denied.
15. If Kimi does not expose `plan` in the ACP mode options, fail clearly and do
    not send `/plan` as ordinary prompt text.

## Observed Kimi ACP contract

The planning session used a real local Kimi Code 0.23.5 process and a disposable
directory. Keep automated tests fake; this trace is the implementation contract.

### Entering Plan Mode

`session/new` returned one `mode` select option with these values:

```json
[
  { "value": "default", "name": "Default" },
  { "value": "plan", "name": "Plan" },
  { "value": "auto", "name": "Auto" },
  { "value": "yolo", "name": "YOLO" }
]
```

Carrent then sent:

```json
{
  "method": "session/set_config_option",
  "params": {
    "sessionId": "<current session>",
    "configId": "mode",
    "value": "plan"
  }
}
```

Kimi emitted `session/update` with `sessionUpdate = "config_option_update"` and
`mode.currentValue = "plan"` before the prompt.

### Runtime-owned plan file

During the prompt, Kimi requested `fs/read_text_file` and
`fs/write_text_file` for a path shaped like:

```text
~/.kimi-code/sessions/<workspace>/<sessionId>/agents/main/plans/<name>.md
```

The initial read can return ENOENT. Kimi then writes the plan and reads it
again before requesting approval. Carrent currently advertises
`writeTextFile: false`, handles only `fs/read_text_file`, and rejects every
path outside the project, so the existing client cannot complete this flow.

### Plan Review

Kimi sent `session/request_permission` for the `ExitPlanMode` tool. The request
contained the full plan Markdown in `toolCall.content` and these options:

```json
[
  { "optionId": "plan_approve", "name": "Approve", "kind": "allow_once" },
  { "optionId": "plan_revise", "name": "Revise", "kind": "reject_once" },
  {
    "optionId": "plan_reject_and_exit",
    "name": "Reject and Exit",
    "kind": "reject_once"
  }
]
```

When alternatives are supplied, Kimi uses `plan_opt_<index>` allow-once
options instead of the single `plan_approve` option. Permission option IDs are
opaque runtime values and must round-trip unchanged.

### Approval and execution

Selecting `plan_approve` completed `ExitPlanMode` with output containing
`Plan mode deactivated. All tools are now available.` The original
`session/prompt` remained active. Kimi immediately continued with a normal
`Edit` tool, requested the usual `approve_once / approve_always / reject`
permission, wrote the disposable README, and completed the same prompt.

Kimi did not emit another `config_option_update` when its internal
`ExitPlanMode` tool completed. Carrent must therefore inspect the completed
`EnterPlanMode` / `ExitPlanMode` tool result instead of relying only on mode
notifications for runtime-initiated transitions.

## Current state

- `apps/desktop/src/shared/chat.ts` carries `runtimeMode` but no Plan Mode in
  `ChatTurnRequest`. Its permission-resolved event exposes only a generic
  approved/denied decision.
- `apps/desktop/src/renderer/mock/uiShellData.ts` stores Runtime, model, and
  permission mode on `ThreadRecord`. `MessagePart` has only text, reasoning,
  and shell variants.
- `apps/desktop/src/shared/workspacePersistence.ts` normalizes optional Thread
  Runtime fields and persisted messages without a Plan Review lifecycle.
- `apps/desktop/src/renderer/lib/workspaceState.ts` and
  `WorkspaceContext.tsx` have parallel project-Thread and general-chat setters
  for Runtime permission mode and model. Extend those existing paths.
- `Composer.tsx` owns the textarea, Skill slash suggestions, attached Skill
  markers, Kimi permission card, and `ChatTurnRequest` construction. It already
  has pure slash helpers and behavior-focused tests.
- `kimiAcpChat.ts` maps `approval-required / auto-accept-edits / full-access`
  to `default / auto / yolo` in `configureRuntimeMode`. It already validates
  runtime-owned mode options before calling `session/set_config_option`.
- `kimiAcpChat.ts` initializes ACP with
  `fs: { readTextFile: true, writeTextFile: false }`. Its client request handler
  implements project-contained `fs/read_text_file` only.
- `kimiAcpChat.ts` reduces ACP permission options to the first `allow_once` and
  first `reject_once`, losing runtime labels, alternative approaches, and
  `Reject and Exit`.
- `useChatRun.ts` stores pending permissions globally and calls
  `onPermissionRequested`, but has no callback for a resolved option or Plan
  Mode state change.
- `MessageTimeline.tsx` renders Agent Activity before final text. It is the
  correct owner for a persistent Plan Review block; the current generic
  permission UI above the Composer must remain for ordinary tool approvals.
- ADR 0002 requires ACP over stdio. Do not add a Kimi CLI prompt-mode fallback
  or inject plan instructions into user messages.

## Commands you will need

| Purpose                     | Command                                                                                                                                                                                                                                                                                | Expected on success     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| ACP tests                   | `rtk bun test apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/electron/chat/chatSessionManager.test.ts`                                                                                                                                                                    | all selected tests pass |
| Shared and state tests      | `rtk bun test apps/desktop/src/shared/chatPermissions.test.ts apps/desktop/src/shared/workspacePersistence.test.ts apps/desktop/src/renderer/lib/workspaceState.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/renderer/hooks/useChatRun.test.ts` | all selected tests pass |
| Composer and timeline tests | `rtk bun test apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/components/chat/MessageTimeline.test.ts`                                                                                                                                            | all selected tests pass |
| Full tests                  | `rtk bun test`                                                                                                                                                                                                                                                                         | all tests pass          |
| Typecheck                   | `rtk bun run typecheck`                                                                                                                                                                                                                                                                | exit 0, no errors       |
| Lint                        | `rtk bun run lint`                                                                                                                                                                                                                                                                     | exit 0, no findings     |
| Build                       | `rtk bun run build`                                                                                                                                                                                                                                                                    | every workspace builds  |
| Diff hygiene                | `rtk git diff --check`                                                                                                                                                                                                                                                                 | no whitespace errors    |

## Scope

**In scope**:

- Shared chat, permission, Thread, MessagePart, and workspace persistence types.
- Existing project-Thread and general-chat Plan Mode state setters.
- Kimi Composer slash suggestion, marker, and send behavior.
- Kimi ACP mode selection, plan-file access, permission option round-tripping,
  and runtime Plan Mode synchronization.
- Persistent timeline Plan Review rendering and actions.
- Focused tests, this plan, `plans/README.md`, `apps/desktop/CONTEXT.md`, and
  ADR 0009.

**Out of scope**:

- Plan Mode support for Codex, Claude Code, pi, or future runtimes.
- Editing Kimi's plan body in Carrent.
- A Carrent-owned planner, plan parser, or prompt template.
- Restoring a disconnected in-flight ACP approval after app restart.
- Changing the selected Kimi model or Thinking option.
- Replacing Kimi's manual approval behavior while Plan Mode is active.
- A general file browser for `~/.kimi-code` or any home-directory access beyond
  the current Runtime Session's Markdown plan file.
- A new rich-text editor, command framework, state-management library, or test
  framework.

## Git workflow

- Branch: `codex/plan-008-kimi-plan-mode`
- Suggested commit: `feat(desktop): add Kimi plan mode`
- Keep one focused commit unless the operator requests otherwise.
- Do not push or open a PR unless instructed.
- Include screenshots of the slash suggestion, attached marker, and
  conversation-style Plan Review in the PR description.

## Steps

### Step 1: Add persisted Thread Plan Mode and Plan Review types

Add `planMode?: boolean` to `ThreadRecord` and `planMode: boolean` to
`ChatTurnRequest`. New Threads and chats start with `false`. Add project-Thread
and general-chat setters beside the existing Runtime permission-mode setters;
wire them through `WorkspaceContext`, `ThreadPage`, and `ChatPage`.

Extend `MessagePart` with a Plan Review variant containing at least:

```ts
{
  type: "plan_review";
  id: string;
  permissionId: string;
  content: string;
  status: "pending" | "approved" | "revision-requested" | "rejected" | "interrupted";
  options: Array<{ optionId: string; name: string; kind: string }>;
  selectedOptionId?: string;
  selectedOptionName?: string;
}
```

Keep the runtime plan path out of visible Markdown. It may be retained as an
optional internal field if required for diagnostics, but the timeline must not
display the user's absolute home path.

Add local `MessagePartUpdate` operations to upsert a Plan Review by id and
resolve it by `permissionId`. Do not replace the current text/reasoning/shell
update paths or create another message store.

In workspace normalization:

- absent or invalid `planMode` becomes `false`;
- valid Plan Review fields are bounded and normalized;
- persisted `status: "pending"` becomes `"interrupted"` on load;
- malformed Plan Review parts are discarded without invalidating the whole
  workspace snapshot.

Keep `WORKSPACE_SNAPSHOT_VERSION = 1`; these are optional backward-compatible
fields. Add tests for new defaults, project/chat setters, message updates,
valid Plan Review restoration, malformed data rejection, and pending-to-
interrupted restoration.

**Verify**:
`rtk bun test apps/desktop/src/shared/workspacePersistence.test.ts apps/desktop/src/renderer/lib/workspaceState.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts`
-> all tests pass.

### Step 2: Add the Kimi `/plan` Composer command and marker

Keep the implementation local to `Composer.tsx`. Add small exported pure
helpers for recognizing a leading `/plan` command, removing only that command
token, and deriving whether a submission should attach Plan Mode without
sending an empty task.

Required interactions:

- While Kimi is selected, `/plan` appears as a dedicated command row before
  Skill results, using a Lucide planning/list icon, label `Plan mode`, and
  description `Enable plan mode`.
- Enter or Tab while that row is selected removes `/plan`, calls the Thread
  Plan Mode setter, focuses the textarea, and does not send.
- Pasted or directly submitted `/plan <task>` enables Plan Mode and sends only
  `<task>` in the same `handleSend` call. Use an effective local boolean in the
  request; do not wait for the React prop update.
- A bare `/plan` submitted through the send button attaches the marker and
  returns without appending user/assistant messages.
- When Plan Mode is already active, do not attach duplicates. Closing the
  marker leaves textarea text, Skills, and attachments unchanged.
- The marker lives in the existing attachment row, visually aligned with Skill
  markers, and has a tooltip plus an `X` icon button.
- Plan Mode does not count toward `hasSendableContent`.
- Non-Kimi Runtime behavior and Skill insertion stay unchanged.

Pass `planMode` in every Kimi `ChatTurnRequest`, including status requests if
the shared type requires it. A live Run retains its request snapshot even if
the user closes the marker afterward.

Add pure-helper tests for bare command, command plus task, leading whitespace,
non-leading `/plan`, similar strings such as `/planner`, active-marker no-op,
and preservation of multiline task text. Extend static Composer coverage for
the suggestion and removable marker without adding a DOM-test dependency.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/chat/Composer.test.ts && rtk bun run typecheck`
-> tests pass and routes supply the new props.

### Step 3: Drive native ACP Plan Mode and support runtime-owned plan files

Change Kimi session configuration so requested Plan Mode wins only for the
current Run:

```ts
const selectedMode = request.planMode ? "plan" : getKimiModeValue(request.runtimeMode);
```

Continue validating the selected value against Kimi's runtime-owned mode
options. A missing `mode` option or missing `plan` value must produce a clear
Plan Mode error before `session/prompt`.

Advertise `fs: { readTextFile: true, writeTextFile: true }` and implement
`fs/write_text_file`. Reuse one path-access resolver for reads and writes with
two allowed roots:

1. the current Run workspace; and
2. the current Kimi Runtime Session's Markdown plan file described by ADR 0009.

The plan-file exception must require all of these:

- the path is under the Kimi sessions root;
- it contains the exact current `sessionId` path segment;
- its suffix is `agents/<agent>/plans/<filename>.md`;
- traversal, symlink escape, directory targets, non-Markdown files, and another
  session's path are rejected.

Use real paths for existing targets and parents. For new workspace files, find
the nearest existing parent, verify it remains inside the real workspace, then
create only the requested parent directories. Treat text as UTF-8 and reject
non-string or unreasonably large payloads with a bounded error. The initial
plan-file read may return ENOENT; return a normal ACP error so Kimi can create
the file on its next Write call.

Do not emit project file activity for runtime plan-file reads/writes. Kimi's
`Write` and `ExitPlanMode` tool updates already describe that work, and exposing
the absolute runtime path in the timeline would be noisy.

Add Kimi ACP tests based on the observed sequence:

- `session/set_config_option` receives `value: "plan"` before the prompt;
- unsupported Plan Mode fails before prompting;
- initialize advertises text writes;
- current workspace writes succeed after validation;
- current-session `agents/main/plans/*.md` read/write succeeds;
- another session, wrong extension, traversal, and symlink escape fail;
- a missing plan file returns an ACP read error without terminating the client.

**Verify**:
`rtk bun test apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/electron/chat/chatSessionManager.test.ts`
-> all selected tests pass.

### Step 4: Preserve runtime permission options and identify Plan Reviews

Replace the generic approved/denied response funnel with runtime-owned option
selection. Keep each ACP permission option's `optionId`, `name`, and `kind` in
`ChatPermissionRequest`. `ChatPermissionResponse` must round-trip one selected
`optionId`; the Kimi run validates that the id belongs to the pending request
before sending it back to ACP.

Ordinary permission UI may continue to present two icon buttons by selecting
the first `allow_once` and first `reject_once` options. Do not expose
`approve_always` as a new UI action in this plan.

Detect a Plan Review only when the tool is `ExitPlanMode` and the options use
Kimi's `plan_*` ids. Parse the first plan content block:

- strip an optional `Plan saved to: <path>` prefix;
- preserve the remaining Markdown exactly;
- discard the generic `Requesting approval to...` text block;
- reject an empty plan as a malformed permission request.

Emit the complete Plan Review through the existing `permission-requested` event.
Select Kimi's `Reject and Exit` option internally after the plan is emitted so
the Run returns control to the conversation without starting implementation.

Add protocol tests using the actual three-option payload plus a payload with
two `plan_opt_<index>` alternatives. Cover invalid option ids, ordinary tool
permissions, malformed/empty plans, and all resolved event fields.

**Verify**:
`rtk bun test apps/desktop/src/shared/chatPermissions.test.ts apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/electron/chat/chatSessionManager.test.ts apps/desktop/electron/chat/chatIpc.test.ts`
-> all tests pass.

### Step 5: Synchronize Runtime Plan Mode and persist the Review lifecycle

Add a `plan-mode-changed` `ChatRunEvent` and corresponding `useChatRun`
callback. Emit it from Kimi ACP in these observed cases:

- `config_option_update` reports `mode.currentValue = "plan"` -> enabled;
- another mode is reported -> disabled;
- completed `EnterPlanMode` output confirms activation -> enabled;
- completed `ExitPlanMode` output contains `Plan mode deactivated` -> disabled;
- a revision/dismissed result says Plan Mode remains active -> enabled.

Do not mark Plan Mode disabled merely because an `ExitPlanMode` tool call
started or a generic reject-once option was selected. Kimi may remain in Plan
Mode after `Revise`.

In `Composer` callbacks for the active assistant message:

- append/upsert a `plan_review` part when the Plan Review permission arrives;
- append a natural-language question after the plan;
- keep normal tool permissions in the current Composer approval area;
- call the project/chat Plan Mode setter when the runtime emits
  `plan-mode-changed`.

When a Run fails, stops, or ends while a Plan Review is still pending, leave
the persisted block visible but change it to `interrupted`. Do not leave an
actionable block whose ACP request no longer exists.

Add coordinator tests for requested/resolved callback ordering, per-Run
permission cleanup, Plan Mode events, and terminal interruption.

**Verify**:
`rtk bun test apps/desktop/src/renderer/hooks/useChatRun.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/renderer/components/chat/Composer.test.ts`
-> all tests pass.

### Step 6: Render a persistent Plan Review in the timeline

Add one focused `PlanReviewBlock` component or a local equivalent used by
`MessageTimeline`. It must render outside Agent Activity and before final
answer text, using the existing constrained timeline width and semantic color
tokens.

Use `MarkdownContent` for the plan body. Keep the component read-only, do not
render runtime options or approval buttons, and avoid nested decorative cards.
The generic Composer permission card must filter out Plan Reviews.

Add pure/static tests for Markdown content, every status, one-plan and
multi-approach actions, exact option-id selection, disabled interrupted state,
and absence from generic permission helpers.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/chat/MessageTimeline.test.ts apps/desktop/src/renderer/components/chat/Composer.test.ts`
-> all tests pass.

### Step 7: Exercise the real desktop workflow and run repository gates

Run `rtk bun run dev:desktop` with a disposable Git project and installed Kimi
Code 0.23.5 or newer. Do not use the Carrent repository as the target project.

Verify:

1. Typing `/plan` shows the Plan command row before Skill results.
2. Selecting it adds the marker without sending a message.
3. Removing the marker preserves draft text, Skills, and attachments.
4. `/plan <task>` sends only `<task>` and starts native ACP Plan Mode.
5. Closing the marker during the Run changes only the next Run.
6. Kimi reads the project, writes its runtime-owned plan file, and shows the
   complete Plan Review in the timeline without exposing the absolute path.
7. The Plan Run exits without implementing after the plan is shown.
8. The timeline asks for a natural-language response and shows no plan actions.
9. Replying with approval or revision text starts a normal follow-up Run and
   sends that text unchanged to Kimi.
10. Multi-approach choices are expressed in the user's reply, not UI buttons.
11. Kimi-initiated `EnterPlanMode` attaches the marker; successful exit removes
    it.
12. Quitting with a pending Review and reopening shows `Interrupted` with
    disabled actions while the Thread marker remains enabled.
13. Existing Kimi model selection, permission selection, context status,
    Skills, attachments, cancellation, and changed-files capture still work.

Stop the dev process, then run all commands in **Commands you will need**.
After every gate passes, mark Plan 008 `DONE` in `plans/README.md`.

**Verify**:
`rtk bun run lint && rtk bun run typecheck && rtk bun test && rtk bun run build && rtk git diff --check`
-> every command exits 0.

## Done criteria

- [ ] `/plan` attaches a removable Kimi-only Plan Mode marker without sending.
- [ ] `/plan <task>` strips the command and starts a native Kimi Plan Run.
- [ ] Thread Plan Mode persists and live Runs retain their request snapshot.
- [ ] Kimi receives `mode = "plan"`; unsupported versions fail before prompt.
- [ ] Carrent safely services workspace writes and only the current Runtime
      Session's external Markdown plan file.
- [ ] Runtime permission options round-trip without losing ids or labels.
- [ ] Plan Review Markdown renders without approval buttons.
- [ ] The Plan Run exits without implementation after presenting the plan.
- [ ] The next user message is sent unchanged so Kimi decides the next action.
- [ ] Kimi-initiated Enter/Exit transitions synchronize the Thread marker.
- [ ] Resolved Reviews remain in history; stale pending Reviews become
      Interrupted after restart.
- [ ] Generic tool approvals remain in the Composer and are not duplicated.
- [ ] No non-Kimi Plan Mode UI or prompt-injected planning behavior was added.
- [ ] Focused tests, full tests, lint, typecheck, build, and diff hygiene pass.
- [ ] Plan 008 is marked `DONE` only after verification.

## STOP conditions

Stop and report if:

- Kimi no longer exposes `plan` through the ACP `mode` config option.
- Kimi's plan file cannot be identified as the current Runtime Session's
  `agents/.../plans/*.md` path without allowing broader home-directory access.
- Correct workspace writes require bypassing the existing Kimi permission
  request or accepting symlink/traversal ambiguity.
- `ExitPlanMode` no longer sends the plan and options through
  `session/request_permission`.
- Approving a plan cannot continue the same `session/prompt` Run.
- Plan Mode state cannot be synchronized from mode notifications and completed
  planning tool results without parsing hidden reasoning text.
- Persisting Plan Review requires replacing the workspace snapshot or message
  store instead of extending its optional data.
- The UI requires a rich-text editor or a new command/state framework.
- A verification command fails twice after reasonable in-scope fixes.

## Maintenance notes

- Kimi's ACP mode taxonomy currently combines Plan with permission behavior.
  Keep Carrent's Thread permission preference separate so the next non-Plan Run
  restores it, but do not claim that preference controls the active Plan Run.
- `config_option_update` is runtime-owned truth for explicit ACP mode changes,
  but Kimi 0.23.5 does not emit it when `ExitPlanMode` completes internally.
  Preserve the completed-tool fallback until the runtime fixes that gap.
- Runtime option ids are opaque. Persist labels for history, but always send the
  exact current pending option id back to ACP.
- The plan file is Kimi-owned state, not a Carrent attachment or project file.
  Do not copy it into the project or expose it through the attachment system.
- If Kimi later provides a dedicated Plan Review/session-mode event, replace
  output-marker detection with that event while retaining the renderer and
  persistence contracts.
- If other runtimes gain Plan Mode, design a runtime-neutral capability model
  separately. Do not generalize this Kimi tracer bullet preemptively.
