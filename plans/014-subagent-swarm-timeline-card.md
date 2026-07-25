# Plan 014: Show Subagent Tasks as timeline cards with per-subagent inputs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat eb682ff..HEAD -- apps/desktop/electron/chat/kimiAcpChat.ts apps/desktop/src/shared/chat.ts apps/desktop/src/shared/workspacePersistence.ts apps/desktop/src/renderer/components/chat/MessageTimeline.tsx apps/desktop/src/renderer/components/chat/ThreadInspectorPane.tsx apps/desktop/src/renderer/routes/ThreadPage.tsx apps/desktop/src/renderer/routes/ChatPage.tsx`
> Note: the subagent feature itself (plan 012) is *uncommitted* work in the
> working tree at plan time, so `eb682ff..HEAD` may be empty — instead compare
> the "Current state" excerpts below against the live files. On a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: plans/012-kimi-subagent-inspector.md (already implemented in the working tree)
- **Category**: direction
- **Planned at**: commit `eb682ff`, 2026-07-25

## Why this matters

Kimi's `AgentSwarm` tool call launches N subagents, but the app surfaces it as
a single row in the right-side inspector that only shows the swarm description
— the user cannot see how many subagents were launched or what each one was
told to do, and there is no entry point from the conversation timeline itself.
The data already exists in Kimi's ACP `tool_call` for `AgentSwarm`:
`rawInput.prompt_template` plus `rawInput.items` describe newly spawned agents,
while the values of `rawInput.resume_agent_ids` are prompts for resumed agents.
Kimi launches resumed agents first, then replaces every `{{item}}` occurrence in
the template for each new item. The current code uses these collections only for
their counts and discards the prompt data. This plan (1) derives and preserves
the concrete prompts in launch order, (2) renders each Subagent Task as a card
inside the message timeline showing subagent count and live status, and (3)
makes clicking the card immediately open the right-side inspector at that
task's detail view, which lists every subagent prompt.

Hard limitation the executor must not try to fix: Kimi's ACP adapter does not
publish per-subagent transcript events (messages/tool calls inside each child
agent), so per-subagent *outputs* and *individual live status* are impossible
today. The card shows swarm-level status only; the detail view shows
per-subagent inputs and the swarm's aggregate result. Do not attempt to
reconstruct child-agent output from anything else.

## Current state

Monorepo: Bun workspace + Turbo. The desktop app is `apps/desktop`
(Electron + electron-vite; renderer React code in `src/renderer`, Electron
main-side code in `electron`). Tests use `bun:test` and live next to sources
as `*.test.ts` / `*.test.tsx`.

Relevant files:

- `apps/desktop/electron/chat/kimiAcpChat.ts` — hand-written ACP client
  (JSON-RPC over stdio to `kimi acp`). Converts ACP `tool_call` updates into
  `subagent-task` chat events.
- `apps/desktop/src/shared/chat.ts` — event contract shared between Electron
  and renderer; defines `ChatSubagentTaskPayload`.
- `apps/desktop/src/shared/workspacePersistence.ts` — validates/normalizes
  persisted message parts, including `normalizeSubagentTaskPart`.
- `apps/desktop/src/renderer/mock/uiShellData.ts` — `MessagePart` union;
  `SubagentTaskPart = { type: "subagent_task" } & ChatSubagentTaskPayload`.
- `apps/desktop/src/renderer/components/chat/MessageTimeline.tsx` — renders
  the conversation; `getAssistantMessagePresentation` currently **drops**
  `subagent_task` parts.
- `apps/desktop/src/renderer/components/chat/ThreadInspectorPane.tsx` —
  right-side inspector: task list (`SubagentTaskRow`) + detail view
  (`SubagentTaskDetail`). Exports pure helpers
  (`collectSubagentTasks`, `sortSubagentTasks`, `formatSubagentTaskDuration`,
  `resolveRightPane`, `shouldShowInspectorToggle`, `updateSeenSubagentTasks`).
- `apps/desktop/src/renderer/routes/ThreadPage.tsx` and
  `apps/desktop/src/renderer/routes/ChatPage.tsx` — both own
  `inspectorOpen` / `selectedTaskId` state and render `<MessageTimeline>` and
  `<ThreadInspectorPane>`.

### Swarm parsing today (`kimiAcpChat.ts:1546-1568`)

```ts
if (title.startsWith(KIMI_AGENT_SWARM_TITLE_PREFIX)) {
  const description = readString(rawInput.description);
  if (!description) {
    return null;
  }

  const items =
    Array.isArray(rawInput.items) && rawInput.items.every((item) => typeof item === "string")
      ? rawInput.items.length
      : 0;
  const resumeAgentIds = readObject(rawInput.resume_agent_ids);
  const resumes =
    resumeAgentIds && !Array.isArray(rawInput.resume_agent_ids)
      ? Object.keys(resumeAgentIds).length
      : 0;

  return {
    source: "agent-swarm",
    description,
    agentType: readString(rawInput.subagent_type) ?? undefined,
    agentCount: items + resumes,
    background: rawInput.run_in_background === true,
  };
}
```

`rawInput.items` contains template substitution values, not complete prompts.
For example, `prompt_template: "Review {{item}}"` with item `"src/a.ts"`
launches a child with prompt `"Review src/a.ts"`. The values in
`resume_agent_ids` are already concrete prompts. Kimi builds launch specs in
this order: resumed agents in object-entry order, followed by item-based agents
in array order. AgentSwarm accepts at most 128 combined entries.

### Task construction (`kimiAcpChat.ts:1176-1191`)

```ts
task = {
  id,
  runtimeId: "kimi",
  source: start.source,
  agentType: start.agentType,
  agentCount: start.source === "agent-swarm" ? start.agentCount : undefined,
  description: truncateToolOutput(start.description),
  prompt:
    start.source === "agent" && start.prompt
      ? truncateToolOutput(start.prompt)
      : undefined,
  background: start.background,
  status: "running",
  startedAt: Date.now(),
};
```

### Payload type (`apps/desktop/src/shared/chat.ts:92-106`)

```ts
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

### Timeline drops subagent parts (`MessageTimeline.tsx:437-441`)

```ts
// Subagent Tasks live in the Thread inspector pane; they never appear in
// the chronological activity trail or the final answer text.
if (part.type === "subagent_task") {
  return;
}
```

`getAssistantMessagePresentation(parts, runStatus)` returns
`{ activityItems, answerText }`. `AssistantMessage` (same file, ~line 454)
renders the activity block then the answer; the exported `MessageTimeline`
(~line 607) receives `{ messages, onSubmitUserEdit? }` and renders
`<AssistantMessage message={msg} timestamp={msg.timestamp} />` at line 701.

### Inspector detail today (`ThreadInspectorPane.tsx:199-249`)

`SubagentTaskDetail({ task, onBack })` renders MetadataRows (Status, Agent
type, Runtime agent, Duration), then optional `PROMPT` (`task.prompt`) and
`RESULT` (`task.summary`, via `<MarkdownContent>`) sections. There is no
agentCount display and no per-subagent input list. `SubagentStatusIcon`,
`SUBAGENT_STATUS_LABEL`, and `formatSubagentTaskDuration` live in this file;
`formatSubagentTaskDuration` is already exported, the other two are not.

### Route wiring today (`ThreadPage.tsx:183-218`, `ChatPage.tsx` similar)

```tsx
<MessageTimeline
  messages={routeData?.messages ?? []}
  onSubmitUserEdit={handleSubmitUserEdit}
/>
...
<aside className="h-full w-[24rem] shrink-0 p-3 pl-2">
  <ThreadInspectorPane
    messages={inspectorInput?.messages ?? []}
    projectPath={inspectorInput?.projectPath}
    selectedTaskId={selectedTaskId}
    onSelectTask={setSelectedTaskId}
  />
</aside>
```

Both pages hold `const [inspectorOpen, setInspectorOpen] = useState(false);`
and `const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);`.

### Conventions to match

- Component files are `PascalCase.tsx` under `components/chat/` (see
  `PlanReviewBlock.tsx`, `ChangedFilesCard.tsx`); pure helper functions are
  exported from the same file and unit-tested in a sibling `*.test.ts(x)`.
- Persistence validation is strict and explicit: check every field, rebuild
  the object with conditional spreads — copy the style of
  `normalizeSubagentTaskPart` (`workspacePersistence.ts:195-270`).
- Existing Subagent Task text uses `truncateToolOutput`, but that helper appends
  its marker after slicing to 12,000 characters. Do not reuse it for persisted
  task fields: the final stored string, including the marker, must be at most
  `MAX_SUBAGENT_TASK_TEXT_LENGTH`.
- UI copy is English; status labels are title-cased English words.

## Commands you will need

| Purpose   | Command                                             | Expected on success |
| --------- | --------------------------------------------------- | ------------------- |
| Install   | `bun install` (repo root)                           | exit 0              |
| Typecheck | `bun run typecheck` (repo root)                     | exit 0, no errors   |
| Lint      | `bun run lint` (repo root)                          | exit 0              |
| All desktop tests | `cd apps/desktop && bun test`             | all pass            |
| Targeted tests | `cd apps/desktop && bun test <path>`         | all pass            |

## Scope

**In scope** (the only files you should modify):

- `apps/desktop/electron/chat/kimiAcpChat.ts`
- `apps/desktop/electron/chat/kimiAcpChat.test.ts`
- `apps/desktop/src/shared/chat.ts`
- `apps/desktop/src/shared/workspacePersistence.ts`
- `apps/desktop/src/shared/workspacePersistence.test.ts`
- `apps/desktop/src/renderer/components/chat/MessageTimeline.tsx`
- `apps/desktop/src/renderer/components/chat/MessageTimeline.test.ts`
- `apps/desktop/src/renderer/components/chat/SubagentTaskCard.tsx` (create)
- `apps/desktop/src/renderer/components/chat/SubagentTaskCard.test.tsx` (create)
- `apps/desktop/src/renderer/components/chat/ThreadInspectorPane.tsx`
- `apps/desktop/src/renderer/components/chat/ThreadInspectorPane.test.tsx`
- `apps/desktop/src/renderer/routes/ThreadPage.tsx`
- `apps/desktop/src/renderer/routes/ChatPage.tsx`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):

- Any attempt to show per-subagent *outputs* or per-subagent *live status* —
  Kimi's ACP adapter does not publish them (see "Why this matters").
- `apps/desktop/src/renderer/context/WorkspaceContext.tsx` and
  `apps/desktop/src/renderer/hooks/useChatRun.ts` — the `upsert-subagent-task`
  plumbing is payload-shape-agnostic; it must not need changes. If you find it
  does, STOP.
- `docs/adr/0011-show-kimi-subagent-tasks-from-acp.md` — append nothing; the
  ADR's scope statement stays accurate for this increment.
- `apps/desktop/src/renderer/components/chat/ChatHeader.tsx` — the header
  Subagents toggle stays as-is.
- Mock data in `uiShellData.ts` beyond what TypeScript forces (the
  `SubagentTaskPart` type picks up the new optional field automatically; no
  mock entry needs updating).

## Git workflow

- The working tree already contains uncommitted plan-012 work; do NOT commit,
  revert, or stash it. Work on top of it in the current branch.
- Do NOT commit anything yourself unless the operator asks. Commit style when
  asked: conventional commits, e.g. `feat(desktop): ...` (see `git log`).

## Steps

### Step 1: Carry per-subagent prompts through the shared payload

In `apps/desktop/src/shared/chat.ts`, export the shared limits and add an
optional field to `ChatSubagentTaskPayload` (after `agentCount`):

```ts
export const MAX_SUBAGENT_TASK_PROMPTS = 128;
export const MAX_SUBAGENT_TASK_TEXT_LENGTH = 12_000;

agentCount?: number;
subagentPrompts?: string[];
```

`subagentPrompts` is only ever set for `source: "agent-swarm"` tasks. When
present, it contains every concrete prompt in launch order and its length must
equal `agentCount`.

**Verify**: `cd apps/desktop && bunx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 2: Derive concrete swarm prompts in the ACP client

In `apps/desktop/electron/chat/kimiAcpChat.ts`:

1. Import `MAX_SUBAGENT_TASK_PROMPTS` and
   `MAX_SUBAGENT_TASK_TEXT_LENGTH` from the shared chat contract. Add a local
   `truncateSubagentTaskText` helper that preserves the existing
   `\n\n[output truncated]` marker while ensuring the complete returned string,
   marker included, is no longer than `MAX_SUBAGENT_TASK_TEXT_LENGTH`.
2. Use `truncateSubagentTaskText` for every persisted Subagent Task text field:
   `description`, single-agent `prompt`, parsed `summary`, and every derived
   swarm prompt. Leave generic shell/reasoning output on `truncateToolOutput`.
3. Find the `KimiSubagentStart` type (just above `matchKimiSubagentStart`,
   ~line 1520) and add `subagentPrompts?: string[];`.
4. Add a small pure helper that derives swarm prompts only when the full input
   can be reconstructed:
   - absent `items` means no new-agent entries; present `items` must be an array
     of strings;
   - absent `resume_agent_ids` means no resumed entries; when present it must
     be an object whose values are all strings;
   - when `items` is non-empty, `prompt_template` must be a string containing
     `{{item}}`;
   - build resumed prompts first using `Object.values(resume_agent_ids)`, then
     item prompts by replacing every `{{item}}` occurrence using
     `promptTemplate.split("{{item}}").join(item)`;
   - return `undefined` unless the derived list is non-empty, has at most
     `MAX_SUBAGENT_TASK_PROMPTS` entries, and its length equals the existing
     `agentCount`; otherwise truncate every prompt with
     `truncateSubagentTaskText`.
5. In the swarm branch of `matchKimiSubagentStart`, keep the existing count
   behavior and conditionally include the derived `subagentPrompts`. Malformed
   prompt data must not prevent the aggregate task or generic reasoning event
   from being emitted.
6. In `handleSubagentTask` (~line 1176), add to the new-task object:
   `subagentPrompts: start.source === "agent-swarm" ? start.subagentPrompts : undefined,`
   placed right after the `agentCount` line.

**Verify**: `cd apps/desktop && bun test electron/chat/kimiAcpChat.test.ts` →
all pass (existing swarm tests must keep passing unchanged).

### Step 3: Validate `subagentPrompts` in persistence

In `apps/desktop/src/shared/workspacePersistence.ts`,
`normalizeSubagentTaskPart` (~line 195):

1. Import `MAX_SUBAGENT_TASK_PROMPTS` and
   `MAX_SUBAGENT_TASK_TEXT_LENGTH` from `chat.ts` and remove the local duplicate
   text-length constant.
2. After the `agentCount` check, add validation: if
   `value.subagentPrompts !== undefined`, the source must be `agent-swarm`,
   `agentCount` must be present, and the value must be an array with the same
   length as `agentCount` and no more than `MAX_SUBAGENT_TASK_PROMPTS` entries.
   Every entry must be a string with length at most
   `MAX_SUBAGENT_TASK_TEXT_LENGTH`; otherwise return null.
3. In the returned object, add:
   `...(Array.isArray(value.subagentPrompts) ? { subagentPrompts: value.subagentPrompts } : {}),`

**Verify**: `cd apps/desktop && bun test src/shared/workspacePersistence.test.ts` →
all pass.

### Step 4: Surface subagent parts from `getAssistantMessagePresentation`

In `apps/desktop/src/renderer/components/chat/MessageTimeline.tsx`:

1. Change `getAssistantMessagePresentation` to also return
   `subagentTasks: SubagentTaskPart[]` (import the type from
   `../../mock/uiShellData`). Replace the `return;` in the
   `part.type === "subagent_task"` branch with `subagentTasks.push(part); return;`,
   preserving part order. Update the stale comment above the branch to say
   subagent tasks render as their own cards, outside the activity trail and
   answer text.
2. Update the call in `AssistantMessage` (~line 463) to also read
   `subagentTasks`, and add `subagentTasks: []` to the no-parts fallback object.
3. Update `isStreaming` so its running-message branch also requires
   `presentation.subagentTasks.length === 0`. A running message whose only
   visible part is a Subagent Task must render the card, not the `Thinking`
   placeholder.

**Verify**: `cd apps/desktop && bun test src/renderer/components/chat/MessageTimeline.test.ts` →
update expectations: subagent parts now appear in `subagentTasks` and still
never in `activityItems`/`answerText`; all pass.

### Step 5: Create `SubagentTaskCard`

Create `apps/desktop/src/renderer/components/chat/SubagentTaskCard.tsx`:

- Props: `{ task: SubagentTaskPart; onOpen?: (taskId: string) => void }`.
- Render a `<button type="button">` (full width, left-aligned) styled like a
  compact activity card, matching surrounding Tailwind patterns
  (`rounded-lg border border-border bg-surface px-3 py-2`, hover
  `hover:bg-surface-hover`, plus the focus-visible ring pattern copied from
  `SubagentTaskRow` in `ThreadInspectorPane.tsx:181-186`).
- Content, left to right: status icon, description (truncated), a count badge
  for swarms (`{task.agentCount} subagents`, only when
  `task.source === "agent-swarm" && task.agentCount !== undefined`), the
  status label, and the duration.
- Reuse, do not duplicate: export `SubagentStatusIcon` and
  `SUBAGENT_STATUS_LABEL` from `ThreadInspectorPane.tsx` (they are currently
  module-private) and import them along with the already-exported
  `formatSubagentTaskDuration`. This import direction (new card → pane) is
  intentional; do not import the card from the pane.
- `onClick={() => onOpen?.(task.id)}`; `aria-label` following the
  `SubagentTaskRow` pattern:
  `${SUBAGENT_STATUS_LABEL[task.status]}: ${task.description}`.
- Also export a pure helper `getSubagentTaskCountLabel(task): string | null`
  returning `"N subagents"` / `"1 subagent"` / null, and use it for the badge;
  unit-test this helper in `SubagentTaskCard.test.tsx` (model the test file
  on `ChatHeader.test.tsx` in the same directory).

**Verify**: `cd apps/desktop && bun test src/renderer/components/chat/SubagentTaskCard.test.tsx` →
all pass; `cd apps/desktop && bunx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 6: Render the card in the timeline and wire the click

In `MessageTimeline.tsx`:

1. `AssistantMessage` gains an optional prop
   `onOpenSubagentTask?: (taskId: string) => void`. After the activity block
   and before the answer text, render
   `presentation.subagentTasks.map((task) => <SubagentTaskCard key={task.id} task={task} onOpen={onOpenSubagentTask} />)`.
2. `MessageTimeline` gains the same optional prop and passes it through to
   `<AssistantMessage ... onOpenSubagentTask={onOpenSubagentTask} />` (line 701).

In `ThreadPage.tsx` and `ChatPage.tsx`, pass to `<MessageTimeline>`:

```tsx
onOpenSubagentTask={(taskId) => {
  closeDiff();
  setSelectedTaskId(taskId);
  setInspectorOpen(true);
}}
```

Keep `resolveRightPane` unchanged. Calling `closeDiff()` in both routes ensures
the selected task is immediately visible even when the Diff pane was open.

**Verify**: `cd apps/desktop && bun test src/renderer` → all pass;
`bun run typecheck` (repo root) → exit 0.

### Step 7: Show count and per-subagent inputs in the inspector detail

In `ThreadInspectorPane.tsx`, `SubagentTaskDetail` (~line 199):

1. Add a MetadataRow after Agent type when the task is a swarm with a count:
   `{task.source === "agent-swarm" && task.agentCount !== undefined && (<MetadataRow label="Subagents" value={String(task.agentCount)} />)}`
2. After the PROMPT section, add a `SUBAGENT PROMPTS` section rendered only
   when `task.subagentPrompts?.length`: an ordered list
   (`<ol className="mt-1 list-decimal space-y-2 pl-5">`) of the prompts, each
   item `<li className="whitespace-pre-wrap break-words text-app-13 text-fg">`,
   wrapped in the same `max-h-64 overflow-y-auto` container pattern as PROMPT.

**Verify**: `cd apps/desktop && bun test src/renderer/components/chat/ThreadInspectorPane.test.tsx` →
all pass (add the new assertions from the test plan first).

### Step 8: Full gate

**Verify**: repo root `bun run lint` → exit 0; `bun run typecheck` → exit 0;
`cd apps/desktop && bun test` → all pass.

## Test plan

- `kimiAcpChat.test.ts` (extend the existing swarm event tests): the existing
  fixture with `prompt_template: "Review {{item}}"`, three items, and two resume
  entries produces `agentCount: 5` and prompts in this exact order:
  `["resume a", "resume b", "Review src/a.ts", "Review src/b.ts", "Review src/c.ts"]`.
  Add cases for multiple placeholder occurrences, a resume-only swarm, and
  malformed template/items/resume values yielding `subagentPrompts: undefined`
  without suppressing the task. A derived prompt longer than 12,000 characters
  must include the truncation marker and have final length at most 12,000.
- `workspacePersistence.test.ts` (extend the existing
  `normalizeSubagentTaskPart` cases): valid `subagentPrompts` survive a
  persist/hydrate round trip; an array containing a non-string, an array
  longer than 128, an over-length string, a count mismatch, or prompts on a
  single-agent task makes the whole part normalize to null. A valid exactly
  12,000-character prompt survives. A persisted `running` task with prompts
  still hydrates as `interrupted` with prompts intact.
- `MessageTimeline.test.ts` (extend the existing
  `getAssistantMessagePresentation` cases): a parts array with a
  `subagent_task` between reasoning and text returns it in `subagentTasks`, in
  order, and not in `activityItems` or `answerText`. Also server-render a
  `MessageTimeline` containing a running assistant message whose only part is
  a `subagent_task`; assert that the card is present and `Thinking` is absent.
- `SubagentTaskCard.test.tsx` (new, model on `ChatHeader.test.tsx`):
  `getSubagentTaskCountLabel` for swarm-with-count, single-agent, and
  swarm-without-count inputs; clicking the card calls `onOpen` with the task
  id.
- `ThreadInspectorPane.test.tsx` (extend): detail view for a swarm task with
  two prompts renders the `Subagents` metadata row and both prompt strings;
  detail for a single-agent task renders no `SUBAGENT PROMPTS` section.

Verification: `cd apps/desktop && bun test` → all pass, including the new
tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` (repo root) exits 0
- [ ] `bun run lint` (repo root) exits 0
- [ ] `cd apps/desktop && bun test` exits 0, including the new tests above
- [ ] `grep -n "subagentPrompts" apps/desktop/src/shared/chat.ts apps/desktop/electron/chat/kimiAcpChat.ts apps/desktop/src/shared/workspacePersistence.ts` shows the field in all three files
- [ ] `grep -rn "onOpenSubagentTask" apps/desktop/src/renderer/routes/` shows both routes passing the prop
- [ ] Both `onOpenSubagentTask` handlers call `closeDiff()` before selecting the task
- [ ] No files outside the in-scope list are modified (`git status --porcelain` compared against the pre-existing plan-012 dirty set)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  (the plan-012 working-tree changes have been committed/rewritten since this
  plan was written — re-derive the anchor points before continuing).
- `WorkspaceContext.tsx` or `useChatRun.ts` appears to need changes for the
  new payload field to flow through (it should not — they pass task objects
  through opaquely).
- Real `kimi acp` output differs from the verified AgentSwarm contract used by
  this plan: resume prompt values launch first, followed by prompts produced by
  replacing every `{{item}}` in `prompt_template` for each `items` value.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- When Kimi's ACP adapter eventually publishes per-subagent events (tracked
  upstream as ACP RFD "Subagent Discovery, Delegation, and Child Sessions",
  PR #855), the natural next step is one row per child agent under the swarm
  card, each with its own status and output. The `subagentPrompts` array added
  here is indexed in launch order, so child events can key off the same index.
- Reviewers should scrutinize: (1) that `subagentPrompts` contains the full
  launch-ordered list and is capped at the AgentSwarm maximum of 128 entries;
  (2) every final stored string, including its truncation marker, is at most
  `MAX_SUBAGENT_TASK_TEXT_LENGTH`; (3) that the timeline card
  is a no-op without `onOpenSubagentTask` (routes that don't pass it must
  still render).
- Explicitly deferred: per-subagent outputs and per-subagent live status
  (impossible without Kimi-side changes); aggregating multiple subagent cards
  into one collapsible group when a run spawns many tasks.
