# Plan 012: Show inspectable Kimi Subagent Tasks in the Thread side pane

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When done, update
> this plan's row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `rtk git diff --stat f7bbbf1..HEAD -- apps/desktop/electron/chat/kimiAcpChat.ts apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/src/shared/chat.ts apps/desktop/src/shared/workspacePersistence.ts apps/desktop/src/shared/workspacePersistence.test.ts apps/desktop/src/renderer/mock/uiShellData.ts apps/desktop/src/renderer/context/WorkspaceContext.tsx apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/renderer/hooks/useChatRun.ts apps/desktop/src/renderer/hooks/useChatRun.test.ts apps/desktop/src/renderer/components/chat/Composer.tsx apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/components/chat/MessageTimeline.tsx apps/desktop/src/renderer/components/chat/MessageTimeline.test.ts apps/desktop/src/renderer/components/chat/ChatHeader.tsx apps/desktop/src/renderer/routes/ThreadPage.tsx apps/desktop/src/renderer/routes/ThreadPage.test.ts apps/desktop/src/renderer/routes/ChatPage.tsx apps/desktop/src/renderer/routes/ChatPage.test.ts apps/desktop/CONTEXT.md docs/adr`
>
> Plan 011 is implemented in the current working tree but was not committed
> when this plan was written. Before editing, also run the six `git hash-object`
> commands in "Current dirty-worktree baseline". If an in-scope file differs
> from both the recorded hash and the Current state excerpts, treat that as a
> STOP condition. Do not discard or rewrite the Thread Work-in-Progress work.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/011-persist-thread-work-in-progress.md`
- **Category**: direction
- **Planned at**: commit `f7bbbf1`, 2026-07-23

## Why this matters

Kimi can delegate work to subagents, but Carrent currently reduces every Kimi
`Agent` or `AgentSwarm` tool call to one generic Thinking row. Users cannot see
which delegated tasks are running, inspect their prompts, or reopen their final
summaries after the parent Run completes.

Kimi Code 0.29.0 has richer internal subagent events, but its ACP adapter does
not publish child-agent messages, thoughts, or tools. This plan delivers the
complete, reliable subset available over Carrent's existing ACP integration:
one persisted Subagent Task per parent tool call, with lifecycle, delegated
prompt, runtime agent id when returned, and final summary. It must not imply
that Carrent has live child-agent transcripts when ACP does not provide them.

## Required product contract

Implement this behavior exactly:

1. A Kimi `Agent` tool call creates one Subagent Task keyed by the ACP
   `toolCallId`. Resuming the same runtime agent in a later tool call creates a
   new task; do not merge calls by `agent-0` or another runtime agent id.
2. A Kimi `AgentSwarm` tool call creates one swarm task, not synthetic child
   tasks. ACP does not expose each child's stable id while the swarm runs.
3. A task records its description, optional prompt, agent type, single/swarm
   source, background flag, start time, status, optional runtime agent id, and
   optional final summary.
4. Supported statuses are `running`, `completed`, `failed`, `interrupted`, and
   `detached`. A background call whose tool result says it is still running
   becomes `detached`; do not claim it completed.
5. Task parsing is best effort. Unknown or changed Kimi output must preserve the
   normal generic Tool Activity and must never fail the parent Run.
6. Keep the existing generic Thinking row for the `Agent`/`AgentSwarm` tool
   call. The side pane is an additional inspectable view, not a replacement for
   the chronological Agent Activity trail required by ADR 0008.
7. Store tasks inside the owning assistant message as `subagent_task`
   `MessagePart`s. Do not create synthetic timeline messages and do not overload
   the currently unused message-level `agentId` field.
8. Persist completed, failed, interrupted, and detached tasks. On workspace
   hydration, convert persisted `running` tasks to `interrupted`.
9. Add an icon-only Subagents control to `ChatHeader`, with a tooltip and
   accessible name. It toggles a 20rem right side pane.
10. When a new running task id first appears in the active Thread, open the side
    pane automatically. If the user closes it, updates to that same task must
    not reopen it. A later new task may open it again.
11. `WorkspaceDiffViewer` and the Subagent pane are mutually exclusive in the
    layout. Diff view takes precedence; closing Diff restores the still-open
    Subagent pane.
12. The overview shows one compact Environment card for project Threads:
    current workspace-change totals, `Local`, and current Git branch. Reuse the
    existing Git IPC and latest persisted `changed_files` message. Do not add
    commit, push, compare, checkout, or branch-creation actions here.
13. Below Environment, show Subagent Tasks as compact rows grouped into active
    and settled work. Each row includes a non-color status cue, description,
    agent type when known, and elapsed or relative time.
14. Clicking a row replaces the overview with a detail view containing a Back
    icon, task description, status, timing, delegated Prompt when available,
    and final Result when available. Render no raw ACP JSON or internal storage
    path.
15. General Chats use the same Subagent overview/detail but omit Environment,
    because they have no project Git context.
16. Empty, malformed, or non-Kimi tool calls do not create tasks. Threads using
    Codex, Claude Code, or pi remain unchanged.
17. Do not display hidden chain of thought. The only detailed text in this plan
    is the delegated prompt and Kimi's final subagent summary returned by the
    parent `Agent` tool.

## Observed Kimi contract

The following was confirmed against the locally installed Kimi Code 0.29.0.
Automated tests must use fake ACP transport messages and must not require Kimi
or user authentication.

### Internal events not exposed through ACP

Kimi's core emits these events internally:

```text
subagent.spawned
subagent.started
subagent.suspended
subagent.completed
subagent.failed
```

The 0.29.0 ACP adapter subscribes only to main-agent assistant, thinking, tool,
and turn events. It rejects child events with a main-agent filter and does not
map `subagent.*` to ACP `session/update`. Consequently this plan cannot show a
child's live thoughts, messages, or tool calls without changing transports.

### Single Agent start

Kimi maps the parent `Agent` tool to an ordinary ACP `tool_call`. The important
shape is:

```json
{
  "sessionUpdate": "tool_call",
  "toolCallId": "0:tool_example",
  "title": "Launching coder agent: Implement persistence",
  "kind": "other",
  "status": "in_progress",
  "rawInput": {
    "subagent_type": "coder",
    "description": "Implement persistence",
    "prompt": "Implement step 1 and report the result"
  }
}
```

Resume calls replace `subagent_type` with `resume: "agent-0"`. Background calls
may add `run_in_background: true`.

### Single Agent result

On completion Kimi sends a `tool_call_update`. Depending on the adapter path,
`rawOutput` may be an object and the text content may be the JSON encoding of
that object:

```json
{
  "sessionUpdate": "tool_call_update",
  "toolCallId": "0:tool_example",
  "status": "completed",
  "rawOutput": {
    "output": "agent_id: agent-0\nactual_subagent_type: coder\nstatus: completed\n\n[summary]\nImplemented persistence and tests."
  }
}
```

The line labels are Kimi-owned text, not an ACP schema. Parse only the known
header lines and `[summary]` delimiter. Missing labels or delimiter must degrade
to the outer tool status with no summary.

### AgentSwarm

An `AgentSwarm` start is also one ordinary ACP tool call. Its `rawInput` can
contain:

```ts
{
  description: string;
  subagent_type?: string;
  prompt_template?: string;
  items?: string[];
  resume_agent_ids?: Record<string, string>;
}
```

Record `agentCount` as `items.length + Object.keys(resume_agent_ids).length`.
Do not parse the final swarm report into synthetic children in this plan.

## Current state

- `apps/desktop/src/shared/chat.ts:62-133` defines one normalized
  `ChatRunEvent` union for Electron-to-renderer streaming. It currently has
  `delta`, `reasoning`, `shell`, permission, plan-mode, and terminal events but
  no Subagent Task event.
- `apps/desktop/electron/chat/kimiAcpChat.ts:394-402` stores only generic tool
  title/kind/command/path state. Lines 1025-1074 accept ACP update variants,
  and lines 1077-1144 reduce every tool to shell or reasoning:

```ts
if ((updateType === "tool_call" || updateType === "tool_call_update") && update) {
  this.handleToolUpdate(update);
}

// ...
this.emit({
  type: "reasoning",
  reasoning: {
    id: `kimi-tool-${id}`,
    content: describeToolActivity(title, kind, filePath),
    status: status === "running" ? "running" : "completed",
  },
});
```

- `kimiAcpChat.ts:1395-1406` reads `rawOutput` only when it is a string. Kimi
  subagent results can wrap the text in `{ output: string }`, so add a narrow
  text extractor instead of broadening every tool parser with ad hoc casts.
- `apps/desktop/src/renderer/hooks/useChatRun.ts:11-27` defines callbacks for
  delta, reasoning, shell, permissions, mode, and terminal state. Lines
  205-223 dispatch those event types.
- `apps/desktop/src/renderer/mock/uiShellData.ts:82-125` stores assistant
  activity in `MessagePart`; its variants are text, reasoning, shell, and Plan
  Review. `MessageBase.agentId` exists but has no callers and does not identify
  one delegated invocation.
- `apps/desktop/src/renderer/context/WorkspaceContext.tsx:147-168` declares
  `MessagePartUpdate`; `applyMessagePartUpdate` at lines 415 onward already
  implements id-based upserts for reasoning and Plan Review. Extend this
  existing path instead of adding another renderer store.
- `apps/desktop/src/shared/workspacePersistence.ts:147-205` validates Plan
  Reviews and filters malformed parts while preserving the parent message.
  Match that bounded, backward-compatible pattern and keep workspace snapshot
  version 1.
- `apps/desktop/src/renderer/routes/ThreadPage.tsx:112-153` and
  `ChatPage.tsx:77-106` already place `WorkspaceDiffViewer` as a right-side
  sibling of the main timeline. They are the correct owners for one mutually
  exclusive right-pane choice; do not move this state to `DesktopShell`.
- `apps/desktop/src/renderer/components/chat/ChatHeader.tsx:1-12` currently
  accepts only `title` and has no right-side controls.
- `apps/desktop/electron/git/gitIpc.ts:73-125` already exposes current branch,
  branch list, worktrees, and workspace diff. The preload already makes these
  calls available as `window.carrent.git`; no new Git IPC is needed.
- `docs/adr/0002-integrate-kimi-code-through-acp.md` chooses ACP over stdio as
  Carrent's Kimi integration. `docs/adr/0008-show-agent-activity-as-thinking.md`
  requires the chronological main Agent Activity trail to remain intact.
- `PRODUCT.md` calls for compact, predictable execution state. `DESIGN.md`
  requires warm neutral tokens, hairline borders, no nested cards, fixed type
  sizes, Lucide icons, visible focus, and restrained semantic color.

## Current dirty-worktree baseline

Plan 011's completed but uncommitted work overlaps three source files and their
tests. Preserve it. These hashes describe the live files used to write this
plan:

| File | `git hash-object` expected output |
| --- | --- |
| `apps/desktop/src/renderer/components/chat/Composer.tsx` | `ac32e7ab603e0cf103d14dd72c2cfba515724cc7` |
| `apps/desktop/src/renderer/components/chat/Composer.test.ts` | `f3cc88bf6600d42d37c0bdec7bb398f89de8e1ca` |
| `apps/desktop/src/renderer/context/WorkspaceContext.tsx` | `0fb8a51194756bf06531cbf0b4f1792be4d7e53d` |
| `apps/desktop/src/renderer/context/WorkspaceContext.test.ts` | `07142fe1a466c869d0b3c5587db3a95cd07a4314` |
| `apps/desktop/src/shared/workspacePersistence.ts` | `59ca347780f7bd0b0bd2bd4e6ed174d01f9dbb0b` |
| `apps/desktop/src/shared/workspacePersistence.test.ts` | `7eddc5f11a3e2925e6b134bba585d9e47f95bcac` |

Hash drift by itself is not failure after Plan 011 is committed or formatted.
It is a signal to compare the live code against the Current state before
editing. Never use checkout, restore, or reset to force these hashes.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| ACP tests | `rtk bun test apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/electron/chat/chatSessionManager.test.ts` | all selected tests pass |
| Event/state tests | `rtk bun test apps/desktop/src/renderer/hooks/useChatRun.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/shared/workspacePersistence.test.ts` | all selected tests pass |
| Inspector tests | `rtk bun test apps/desktop/src/renderer/components/chat/ThreadInspectorPane.test.tsx apps/desktop/src/renderer/components/chat/MessageTimeline.test.ts apps/desktop/src/renderer/routes/ThreadPage.test.ts apps/desktop/src/renderer/routes/ChatPage.test.ts` | all selected tests pass |
| CI-equivalent tests | `rtk bun test apps/desktop/electron apps/desktop/src` | all tests pass |
| Typecheck | `rtk bun run typecheck` | exit 0, no errors |
| Lint | `rtk bun run lint` | exit 0, no findings |
| Build | `rtk bun run build` | every workspace builds |
| Diff hygiene | `rtk git diff --check` | no whitespace errors |

Do not run `bun install` unless dependencies are missing. This plan adds no
dependency.

## Scope

**In scope**:

- `apps/desktop/src/shared/chat.ts`
- `apps/desktop/electron/chat/kimiAcpChat.ts`
- `apps/desktop/electron/chat/kimiAcpChat.test.ts`
- `apps/desktop/src/renderer/hooks/useChatRun.ts`
- `apps/desktop/src/renderer/hooks/useChatRun.test.ts`
- `apps/desktop/src/renderer/mock/uiShellData.ts`
- `apps/desktop/src/renderer/context/WorkspaceContext.tsx`
- `apps/desktop/src/renderer/context/WorkspaceContext.test.ts`
- `apps/desktop/src/shared/workspacePersistence.ts`
- `apps/desktop/src/shared/workspacePersistence.test.ts`
- `apps/desktop/src/renderer/components/chat/Composer.tsx`
- `apps/desktop/src/renderer/components/chat/Composer.test.ts`
- `apps/desktop/src/renderer/components/chat/MessageTimeline.tsx`
- `apps/desktop/src/renderer/components/chat/MessageTimeline.test.ts`
- `apps/desktop/src/renderer/components/chat/ChatHeader.tsx`
- `apps/desktop/src/renderer/components/chat/ChatHeader.test.tsx` (create)
- `apps/desktop/src/renderer/components/chat/ThreadInspectorPane.tsx` (create)
- `apps/desktop/src/renderer/components/chat/ThreadInspectorPane.test.tsx` (create)
- `apps/desktop/src/renderer/routes/ThreadPage.tsx`
- `apps/desktop/src/renderer/routes/ThreadPage.test.ts`
- `apps/desktop/src/renderer/routes/ChatPage.tsx`
- `apps/desktop/src/renderer/routes/ChatPage.test.ts`
- `apps/desktop/CONTEXT.md`
- `docs/adr/0011-show-kimi-subagent-tasks-from-acp.md` (create)
- `plans/012-kimi-subagent-inspector.md`
- `plans/README.md`

**Out of scope**:

- Starting or integrating `kimi web`, KAP REST, or KAP WebSocket.
- Reading or watching `~/.kimi-code/sessions`, `state.json`, `wire.jsonl`, or
  Kimi log files.
- Live child-agent thoughts, messages, shell output, file activity, or tools.
- Changing Kimi's ACP adapter or requiring a custom Kimi build.
- Replacing ACP, changing Runtime Session persistence, or changing Kimi model,
  mode, approval, attachment, Plan Mode, and file-access behavior.
- Splitting an `AgentSwarm` report into guessed child records.
- Restoring a live background subagent connection after the parent ACP prompt
  ends or Carrent restarts.
- Git commit, push, compare, checkout, branch creation, or destructive controls
  in the Environment card.
- Showing this UI for Codex, Claude Code, pi, or unsupported generic tools.
- Moving right-pane ownership into `DesktopShell`, changing the 58px project
  rail, changing the resizable secondary pane, or increasing BrowserWindow's
  current 1080px minimum width.
- A new state-management, Markdown, protocol, icon, or test dependency.

## Git workflow

- Branch: `codex/plan-012-kimi-subagent-inspector`
- Suggested commit: `feat(desktop): show Kimi subagents`
- Keep one focused commit unless the operator requests otherwise.
- Do not push or open a PR unless instructed.
- Include screenshots of the overview, one running task, one completed detail,
  and the 1080px-wide window in the PR description.

## Steps

### Step 1: Define one transport-neutral Subagent Task contract

In `apps/desktop/src/shared/chat.ts`, add shared types with this target shape:

```ts
export type ChatSubagentTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "detached";

export type ChatSubagentTaskPayload = {
  id: string;
  runtimeId: "kimi";
  source: "agent" | "agent-swarm";
  runtimeAgentId?: string;
  agentType?: string;
  agentCount?: number;
  description: string;
  prompt?: string;
  background: boolean;
  status: ChatSubagentTaskStatus;
  summary?: string;
  startedAt: number;
  finishedAt?: number;
};
```

Add a `ChatRunEvent` variant named `subagent-task` carrying `task`. Add
`onSubagentTask` to `ChatRunCallbacks` and dispatch it in
`createChatRunCoordinator.handleEvent` beside reasoning and shell.

In `apps/desktop/CONTEXT.md`, define:

- **Subagent**: a runtime-owned child coding agent delegated work by another
  coding agent inside a Run.
- **Subagent Task**: one delegated invocation shown by Carrent. A resumed
  runtime agent can own several Subagent Tasks.

Use `Runtime`, `Runtime Session`, `Run`, `Agent Activity`, and `Subagent Task`
according to the existing glossary. Do not use Provider Session or Agent
Session in user-visible names.

Create ADR 0011 recording these decisions:

- Carrent keeps ACP as the Kimi transport for this delivery.
- Parent `Agent` and `AgentSwarm` tool calls are the source of Subagent Task
  summaries.
- Full child transcript is unavailable over current ACP and is deferred to a
  separate KAP-versus-ACP-extension decision.
- Private Kimi session files are not a supported integration interface.

**Verify**:
`rtk bun test apps/desktop/src/renderer/hooks/useChatRun.test.ts && rtk bun run typecheck`
-> the coordinator callback test passes and TypeScript reports no errors.

### Step 2: Normalize Kimi Agent tool calls without breaking generic activity

Keep the implementation in `kimiAcpChat.ts`; it owns the Kimi ACP contract.
Add small pure helpers and test them through fake ACP messages:

1. Recognize a single Agent only when the title matches Kimi's launching-agent
   form and `rawInput` contains string `description` plus either string
   `prompt`, string `resume`, or string `subagent_type`.
2. Recognize AgentSwarm only when the title starts `Launching agent swarm:` and
   `rawInput.description` is a string. Derive `agentCount` only from valid
   `items` and `resume_agent_ids` collections.
3. Extract tool output text in this precedence order:
   - `rawOutput` string;
   - `rawOutput.output` string;
   - parsed JSON `content.output` string;
   - terminal text content;
   - empty string.
4. Parse the single-Agent result line by line. Accept only `agent_id`,
   `actual_subagent_type`, `status`, and the content after a standalone
   `[summary]` line. Never interpret arbitrary summary text as headers.
5. Bound `description`, `prompt`, and `summary` to 12,000 characters using the
   existing tool-output truncation convention. Append the existing
   `[output truncated]` marker when needed.

Extend each `toolStates` entry with an optional normalized Subagent Task. On
the first recognized update, preserve `startedAt` and emit `status: running`.
On later updates for the same tool id, preserve fields omitted by ACP and emit
an upsert with:

- `failed` when the outer tool status is failed or the parsed result status is
  failed;
- `detached` when `background` is true and the parsed result is still running;
- `completed` for a successful terminal foreground result;
- otherwise the previous status.

Set `finishedAt` only for completed, failed, or detached states. If result text
cannot be parsed, use the outer tool status and omit optional result fields.

After emitting the task update, continue through the current shell/reasoning
mapping. Tests must prove the original `reasoning` event is still emitted.

Add behavior tests for:

- single Agent start then completed object-shaped `rawOutput`;
- resume start without `subagent_type`;
- failed Agent result;
- background result becoming detached;
- AgentSwarm start with a correct aggregate count;
- repeated updates preserving one id and original start time;
- malformed Agent-like input falling back to generic reasoning only;
- malformed result completing without a summary and without failing the Run;
- ordinary Read, Edit, Bash, EnterPlanMode, and ExitPlanMode behavior remaining
  unchanged.

**Verify**:
`rtk bun test apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/electron/chat/chatSessionManager.test.ts`
-> all selected tests pass, including at least eight new Subagent Task cases.

### Step 3: Persist tasks in the owning assistant message

In `uiShellData.ts`, define the new part by reusing the shared payload rather
than copying its fields:

```ts
type SubagentTaskPart = { type: "subagent_task" } & ChatSubagentTaskPayload;
```

Add `upsert-subagent-task` and `interrupt-subagent-tasks` operations to
`MessagePartUpdate`. In `applyMessagePartUpdate`:

- upsert by task `id` inside only the target assistant message;
- preserve chronological insertion order when updating;
- interrupt only `running` tasks;
- leave detached and settled tasks unchanged.

In `Composer.tsx`, route `onSubagentTask` to the active assistant message via
the existing `updateMessageParts` path. On parent Run failure or user stop,
interrupt its remaining running tasks before settling the assistant message.
On normal completion, also interrupt any impossible leftover foreground
running task, but do not rewrite detached tasks.

Do not append the task prompt or summary to the assistant message's `content`.
Do not include Subagent Task details in the transcript sent back to the main
Runtime Session; the parent Kimi Runtime Session already owns that context.

Add `normalizeSubagentTaskPart` beside `normalizePlanReviewPart` with these
requirements:

- exact known enum values only;
- finite non-negative timestamps;
- `finishedAt >= startedAt` when present;
- 12,000-character bounds for description, prompt, and summary;
- positive integer `agentCount` when present;
- absent optional strings remain absent;
- malformed tasks are dropped without dropping their parent message;
- persisted `running` becomes `interrupted` during hydration;
- keep `WORKSPACE_SNAPSHOT_VERSION = 1` because the part is optional.

Add WorkspaceContext and persistence tests for first insert, id-based update,
interrupt, settled-state preservation, valid round-trip, malformed rejection,
running-to-interrupted hydration, and preservation of Plan 011 Thread
Work-in-Progress fields in the same snapshot.

Update `MessageTimeline.getAssistantMessagePresentation` explicitly to ignore
`subagent_task` parts. Add a regression test proving tasks neither appear as
final answer text nor change Thinking/final-answer ordering.

**Verify**:
`rtk bun test apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/shared/workspacePersistence.test.ts apps/desktop/src/renderer/components/chat/MessageTimeline.test.ts apps/desktop/src/renderer/components/chat/Composer.test.ts`
-> all selected tests pass, including mixed Plan Review, Thread
Work-in-Progress, and Subagent Task snapshots.

### Step 4: Build the overview and detail pane

Create `ThreadInspectorPane.tsx`. Split it into a small stateful
`ThreadInspectorPane` wrapper and an exported pure `ThreadInspectorContent`
render surface. The wrapper owns the branch-loading effect; the pure content
accepts resolved branch/loading data so it can be covered with the repo's
existing `renderToStaticMarkup` tests. Keep these pure selectors exported too:

- collect `subagent_task` parts from assistant messages only;
- sort active tasks newest first and settled tasks newest first;
- select the latest valid `changed_files` message;
- calculate file, addition, and deletion totals;
- format duration from task timestamps without duplicating a second timer per
  row.

The pane is a stable `w-[20rem] min-w-0 shrink-0` right sibling with a left
hairline and canvas background. Use the shared `Card` only for the Environment
summary. Do not place task rows or detail sections inside nested cards.

Environment for project Threads:

- Header: `Environment`.
- Changes row: file count plus semantic `+N` and `-N`. When the latest message
  has a Diff snapshot, clicking the row calls the existing `openDiff`; otherwise
  render a disabled row.
- Location row: `Local`.
- Branch row: call `window.carrent.git.branches(projectPath)` on project-path
  change and show `current`. While loading or unavailable, show a neutral dash;
  do not raise a repeating global toast.

Subagent overview:

- Header `Subagents` with an active/settled count.
- A `Running` section only when active tasks exist.
- A `Recent` section for completed, failed, interrupted, and detached tasks.
- Each row is a full-width button with a Lucide status icon, description,
  optional agent type, and time. Use green only for completed and red only for
  failed; running, interrupted, and detached retain icon plus neutral text.
- Long descriptions and types truncate without changing row height.
- The empty state is the concise text `No subagents`.

Detail view:

- Back icon button with tooltip and accessible name.
- Description as compact Title typography, never page-scale text.
- Status, agent type, runtime agent id, and duration as metadata rows.
- Optional Prompt and Result sections. Use `whitespace-pre-wrap` and
  `break-words`; cap very long content in a scroll region so it cannot resize
  the whole layout.
- Result may use the existing `MarkdownContent`; Prompt remains plain text so
  delegated instructions cannot produce interactive links.

Use existing theme tokens and Lucide icons. No gradients, colored decorative
avatars, nested cards, new shadows, negative tracking, or text sized by
viewport width. All icon-only buttons require focus treatment and accessible
names.

Test `ThreadInspectorContent` static rendering for:

- project Environment with branch and change totals;
- Chat overview without Environment;
- running, completed, failed, interrupted, and detached status labels/icons;
- task ordering and counts;
- long text truncation classes;
- detail Prompt and Result;
- absence of raw ACP keys and Kimi storage paths;
- Diff-enabled versus Diff-unavailable Changes row.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/chat/ThreadInspectorPane.test.tsx && rtk bun run typecheck`
-> all inspector tests pass and TypeScript reports no errors.

### Step 5: Integrate one mutually exclusive right-pane state

Extend `ChatHeader` with optional props for inspector state, task count, and a
toggle callback. Position a Lucide Subagents/Users icon in the right side of
the existing relative header while preserving the centered title. Hide the
control only when the route has neither project Environment nor any Subagent
Task. Add a compact numeric badge only when count is non-zero.

In both `ThreadPage` and `ChatPage`:

1. derive current tasks from `routeData.messages`;
2. own `inspectorOpen` and selected-task state locally;
3. reset selected task on Thread change;
4. track task ids seen for the current Thread;
5. auto-open only when a new running id appears;
6. pass project path only from `ThreadPage`;
7. render exactly one right sibling:

```tsx
{diffState.open ? (
  <WorkspaceDiffViewer ... />
) : inspectorOpen ? (
  <ThreadInspectorPane ... />
) : null}
```

Do not close the inspector state when Diff opens. Closing Diff should reveal it
again. Do not auto-open on every streaming status update. At the 1080px minimum
window width, the timeline and Composer must remain usable with the 20rem pane
open: all flex children need the existing `min-w-0` behavior and content must
truncate or wrap.

Add:

- `ChatHeader.test.tsx` static coverage for centered title, accessible toggle,
  selected state, and count badge;
- pure route/helper tests for new-id auto-open behavior, same-id no-reopen,
  Thread reset, and Diff precedence;
- ChatPage coverage proving project Environment is omitted;
- ThreadPage coverage proving project path and messages reach the inspector.

**Verify**:
`rtk bun test apps/desktop/src/renderer/components/chat/ChatHeader.test.tsx apps/desktop/src/renderer/routes/ThreadPage.test.ts apps/desktop/src/renderer/routes/ChatPage.test.ts apps/desktop/src/renderer/components/chat/ThreadInspectorPane.test.tsx`
-> all selected tests pass.

### Step 6: Run full gates and inspect the desktop UI

Run all commands in "Commands you will need". Then start the desktop app with
`rtk bun run dev:desktop` and verify at 1280x840 and the minimum 1080x720:

1. a fake or real foreground Kimi Agent call opens the pane once;
2. closing the pane keeps it closed during updates to the same task;
3. a later new task opens it;
4. task detail is readable while the parent Run is active;
5. completed detail survives navigation away and back;
6. opening Diff replaces the inspector and closing Diff restores it;
7. a general Chat omits Environment;
8. light and dark themes retain readable status contrast;
9. 8px and 32px text settings do not overlap icons, metadata, or pane content.

Capture screenshots for PR review, but do not commit generated screenshots or
local Kimi data. Confirm no raw home-directory session paths, ACP JSON, or
hidden chain-of-thought text is visible.

**Verify**:
`rtk git diff --check && rtk bun test apps/desktop/electron apps/desktop/src && rtk bun run typecheck && rtk bun run lint && rtk bun run build`
-> every command exits 0.

## Test plan

- Model Kimi ACP fixtures after `FakeKimiAcpTransport` in
  `kimiAcpChat.test.ts`; never spawn or authenticate a real Kimi process in
  automated tests.
- Add at least eight Kimi parser/lifecycle cases from Step 2.
- Extend `useChatRun.test.ts` with one callback-routing case and one unrelated
  run-id rejection case.
- Extend `WorkspaceContext.test.ts` with insert, update, interruption, and
  settled-state cases.
- Extend `workspacePersistence.test.ts` with valid, malformed, hydration, and
  Plan 011 coexistence cases.
- Extend `MessageTimeline.test.ts` to prove task parts do not leak into the main
  transcript presentation.
- Use `renderToStaticMarkup`, matching `ChangedFilesCard.test.tsx` and
  `WorkspaceDiffViewer.test.tsx`, for the new pane and header rendering tests.
- Keep route behavior in exported pure helpers where React interaction tests
  would otherwise require a new DOM-test dependency.
- Run CI-equivalent tests, typecheck, lint, build, and diff hygiene before
  marking the plan DONE.

## Done criteria

- [ ] A fake Kimi `Agent` start/update sequence emits id-stable
      `subagent-task` events and keeps the existing reasoning events.
- [ ] Resume, failure, detached background, AgentSwarm, malformed input, and
      malformed result tests all pass.
- [ ] Subagent Tasks persist inside assistant message parts; running tasks
      hydrate as interrupted without invalidating Plan Review or Plan 011 data.
- [ ] The right pane renders project Environment plus Subagent overview and
      detail, while general Chats omit Environment.
- [ ] New-id auto-open, same-id no-reopen, Thread reset, and Diff precedence are
      covered by tests.
- [ ] No source reads Kimi private session files or starts `kimi web`.
- [ ] No Git mutation action is added to Environment.
- [ ] `rtk bun test apps/desktop/electron apps/desktop/src` exits 0.
- [ ] `rtk bun run typecheck` exits 0 with no errors.
- [ ] `rtk bun run lint` exits 0 with no findings.
- [ ] `rtk bun run build` exits 0 for every workspace.
- [ ] `rtk git diff --check` reports no whitespace errors.
- [ ] `rtk git status --short` shows no modified source outside the Scope list
      and preserves unrelated user changes.
- [ ] `apps/desktop/CONTEXT.md`, ADR 0011, and the `plans/README.md` status row
      match the shipped behavior.

## STOP conditions

Stop and report back; do not improvise if:

- The current Kimi version used by Carrent no longer includes a recognizable
  `Agent`/`AgentSwarm` title plus `rawInput` in ACP `tool_call` updates.
- Meeting the accepted UI requires live child messages, thoughts, or tool
  progress. That requires a separate KAP or ACP-extension plan, not private
  file reads in this plan.
- A proposed implementation needs to watch or parse files under
  `~/.kimi-code`, or needs a custom Kimi binary.
- Plan 011's dirty-worktree files differ semantically from the excerpts and the
  Subagent Task changes cannot be applied without discarding its draft/queue
  persistence behavior.
- The parser would need to infer tasks from arbitrary tool output without the
  strict Kimi Agent/AgentSwarm start shape.
- Workspace persistence needs a version bump or destructive migration rather
  than an optional version-1 message part.
- The right pane requires increasing the 1080px minimum window width, moving
  ownership into `DesktopShell`, or showing Diff and Subagents simultaneously.
- A verification command fails twice after a reasonable, in-scope correction.
- Any required fix touches a file listed as out of scope.

## Maintenance notes

- Kimi's Agent result headers are not part of ACP. Keep parsing defensive and
  covered by fixtures; a changed header must lose optional metadata rather than
  break the parent Run.
- The normalized Subagent Task interface is deliberately transport-neutral
  enough for a future KAP or ACP-extension adapter. A future adapter should
  update the same task parts by invocation id instead of creating another UI
  store.
- Full Codex-like live inspection requires a separate decision between
  migrating Kimi to `kimi web`/KAP and asking Kimi ACP to publish structured
  subagent extensions. Do not silently expand this plan into that migration.
- Reviewers should scrutinize persisted text bounds, runtime path leakage,
  result parsing, auto-open behavior, and 1080px/32px-text layout before
  approving.
