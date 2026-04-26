# Agent Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agents real editable workspace objects so `AgentsPage` and `Composer` use the same `name + responsibility + runtime` configuration.

**Architecture:** Add an `AgentContext` for renderer agent state and wire it into the existing app provider tree. Persist agents by extending the existing workspace snapshot with an optional `agents` field, while keeping backward compatibility with older saved snapshots that do not have agents yet.

**Tech Stack:** React, TypeScript, Bun test, existing workspace persistence IPC

---

## Scope

### In

- Create agent
- Edit agent `name`, `responsibility`, `runtime`
- Delete agent
- Select current agent in Composer from the shared agent state
- Persist agents with the existing workspace snapshot
- Keep current chat request payload using the selected agent configuration

### Out

- Agent templates
- Preset agents
- Agent tags, colors, avatars
- Project-specific agent binding
- Agent permissions
- Agent-to-agent messaging

## Current State

- Agent seed data lives in `apps/desktop/src/renderer/mock/uiShellData.ts`.
- `AgentsPage` reads static `agents` and displays a read-only form.
- `Composer` reads static `agents` and keeps `selectedAgentId` locally.
- Workspace data already persists through `WorkspaceSnapshot` and `window.carrent.workspace`.

The missing part is a real shared agent state source.

## File Map

### Existing files to modify

- `apps/desktop/src/renderer/mock/uiShellData.ts`
  - Keep seed agents, export `AgentRecord`.
- `apps/desktop/src/shared/workspacePersistence.ts`
  - Add optional `agents` support to `WorkspaceSnapshot` normalization.
- `apps/desktop/src/shared/workspacePersistence.test.ts`
  - Verify older snapshots without `agents` still normalize.
- `apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.ts`
  - Include agents in `buildWorkspaceSnapshot`.
- `apps/desktop/src/renderer/context/WorkspaceContext.tsx`
  - Hydrate agents from snapshot and expose them to `AgentContext`, or pass them through provider composition.
- `apps/desktop/src/renderer/App.tsx`
  - Mount `AgentProvider`.
- `apps/desktop/src/renderer/routes/AgentsPage.tsx`
  - Convert from read-only mock display to editable state.
- `apps/desktop/src/renderer/components/chat/Composer.tsx`
  - Replace static `agents` import with `useAgents()`.
- `apps/desktop/src/renderer/components/chat/MessageTimeline.tsx`
  - Replace static `agents` lookup with `useAgents()` or an agent lookup prop.

### New files to create

- `apps/desktop/src/renderer/context/AgentContext.tsx`
  - Shared agent state and mutations.
- `apps/desktop/src/renderer/lib/agents.ts`
  - Pure helpers for create/update/delete/selection fallback.
- `apps/desktop/src/renderer/lib/agents.test.ts`
  - Unit tests for helper behavior.

## Data Model

Use the existing V1 shape:

```ts
export type AgentRecord = {
  id: string;
  name: string;
  runtime: "codex" | "claude-code";
  responsibility: string;
  selected?: boolean;
  createdAt?: string;
  updatedAt?: string;
};
```

Validation rules:

- `name.trim()` is required.
- `responsibility.trim()` is required.
- `runtime` must be `codex` or `claude-code`.
- Delete is allowed, but Composer must fall back to another available agent.
- If there are zero agents, Composer send must be disabled.

## Implementation Order

### Task 1: Add pure agent helpers

**Files:**

- Create: `apps/desktop/src/renderer/lib/agents.ts`
- Create: `apps/desktop/src/renderer/lib/agents.test.ts`
- Modify: `apps/desktop/src/renderer/mock/uiShellData.ts`

- [ ] **Step 1: Move/export `AgentRecord` cleanly**

Ensure `uiShellData.ts` exports:

```ts
export type AgentRecord = {
  id: string;
  name: string;
  runtime: "codex" | "claude-code";
  responsibility: string;
  selected?: boolean;
  createdAt?: string;
  updatedAt?: string;
};
```

- [ ] **Step 2: Write failing helper tests**

Cover:

```ts
it("creates a valid draft agent");
it("updates an existing agent and refreshes updatedAt");
it("deletes an agent and returns the next selectable id");
it("rejects blank name or responsibility");
```

Run: `cd apps/desktop && bun test src/renderer/lib/agents.test.ts`
Expected: FAIL because helpers do not exist yet.

- [ ] **Step 3: Implement helpers**

Functions:

```ts
export function buildNewAgent(now = new Date()): AgentRecord;
export function validateAgent(agent: AgentRecord): string | null;
export function updateAgentInList(agents: AgentRecord[], agent: AgentRecord, now = new Date());
export function deleteAgentFromList(
  agents: AgentRecord[],
  agentId: string,
  selectedAgentId: string | null,
);
export function getSelectableAgentId(agents: AgentRecord[], preferredId?: string | null);
```

- [ ] **Step 4: Run helper tests**

Run: `cd apps/desktop && bun test src/renderer/lib/agents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/mock/uiShellData.ts apps/desktop/src/renderer/lib/agents.ts apps/desktop/src/renderer/lib/agents.test.ts
git commit -m "feat(desktop): add agent state helpers"
```

### Task 2: Persist agents with workspace snapshots

**Files:**

- Modify: `apps/desktop/src/shared/workspacePersistence.ts`
- Modify: `apps/desktop/src/shared/workspacePersistence.test.ts`
- Modify: `apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.ts`
- Modify: `apps/desktop/src/renderer/context/WorkspaceContext.tsx`

- [ ] **Step 1: Extend `WorkspaceSnapshot`**

Add:

```ts
agents?: AgentRecord[];
```

Keep it optional so old saved `workspace.json` files still load.

- [ ] **Step 2: Update normalization tests**

Add test:

```ts
it("accepts older snapshots without agents");
```

Run: `cd apps/desktop && bun test src/shared/workspacePersistence.test.ts`
Expected: PASS after implementation.

- [ ] **Step 3: Include agents in `buildWorkspaceSnapshot`**

Change the builder signature:

```ts
buildWorkspaceSnapshot({ projects, messages, activeThreadId, drafts, agents });
```

- [ ] **Step 4: Add agent state to `WorkspaceContext` only as persistence plumbing**

Keep UI-facing mutations in `AgentContext`, but `WorkspaceContext` may own the actual persisted `agents` state so one snapshot saves everything.

Expose:

```ts
agents: AgentRecord[];
setAgents: (agents: AgentRecord[] | ((prev: AgentRecord[]) => AgentRecord[])) => void;
```

Hydration rule:

```ts
setAgents(snapshot?.agents?.length ? snapshot.agents : initialAgents);
```

- [ ] **Step 5: Run persistence tests**

Run:

- `cd apps/desktop && bun test src/shared/workspacePersistence.test.ts`
- `cd apps/desktop && bun test src/renderer/context/WorkspaceContext.test.ts`
- `bun run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/workspacePersistence.ts apps/desktop/src/shared/workspacePersistence.test.ts apps/desktop/src/renderer/hooks/useDebouncedWorkspaceSave.ts apps/desktop/src/renderer/context/WorkspaceContext.tsx
git commit -m "feat(desktop): persist agents in workspace snapshot"
```

### Task 3: Add AgentContext

**Files:**

- Create: `apps/desktop/src/renderer/context/AgentContext.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [ ] **Step 1: Create context value**

Expose:

```ts
type AgentContextValue = {
  agents: AgentRecord[];
  selectedAgentId: string | null;
  selectedAgent: AgentRecord | null;
  setSelectedAgentId: (id: string | null) => void;
  createAgent: () => AgentRecord;
  updateAgent: (agent: AgentRecord) => { ok: true } | { ok: false; error: string };
  deleteAgent: (agentId: string) => void;
};
```

- [ ] **Step 2: Back AgentContext with WorkspaceContext state**

Use:

```ts
const { agents, setAgents } = useWorkspace();
```

This keeps one persisted state source.

- [ ] **Step 3: Mount provider**

Wrap app routes:

```tsx
<WorkspaceProvider>
  <AgentProvider>
    <AppRoutes />
  </AgentProvider>
</WorkspaceProvider>
```

Make sure `AgentProvider` is inside `WorkspaceProvider`.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/context/AgentContext.tsx apps/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): add shared agent context"
```

### Task 4: Make AgentsPage editable

**Files:**

- Modify: `apps/desktop/src/renderer/routes/AgentsPage.tsx`

- [ ] **Step 1: Replace static mock import**

Use:

```ts
const { agents, selectedAgentId, setSelectedAgentId, createAgent, updateAgent, deleteAgent } =
  useAgents();
```

- [ ] **Step 2: Add local form draft**

When selected agent changes, copy it into form state:

```ts
const [draft, setDraft] = useState<AgentRecord | null>(null);
```

- [ ] **Step 3: Wire fields**

Make these editable:

- `Name`
- `Responsibility Prompt`
- `Default Runtime`

- [ ] **Step 4: Wire buttons**

Behavior:

- `+` creates a new agent and selects it.
- `Save Changes` validates and writes to context.
- `Cancel` resets local draft from selected agent.
- `Delete` deletes selected agent and selection falls back.

- [ ] **Step 5: Handle empty state**

If there are zero agents:

- show empty state
- `+` still creates a new draft agent

- [ ] **Step 6: Manual verification**

Run: `bun run dev:desktop`

Verify:

- editing name updates list after save
- editing responsibility persists after navigation
- changing runtime updates Composer selection menu
- delete falls back to another agent

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/routes/AgentsPage.tsx
git commit -m "feat(desktop): edit agent settings"
```

### Task 5: Wire Composer and message badges to AgentContext

**Files:**

- Modify: `apps/desktop/src/renderer/components/chat/Composer.tsx`
- Modify: `apps/desktop/src/renderer/components/chat/MessageTimeline.tsx`

- [ ] **Step 1: Replace static agent import in Composer**

Use:

```ts
const { agents, selectedAgentId, selectedAgent, setSelectedAgentId } = useAgents();
```

- [ ] **Step 2: Preserve send behavior**

Chat request should still use:

```ts
runtimeId: selectedAgent.runtime,
agent: {
  id: selectedAgent.id,
  name: selectedAgent.name,
  responsibility: selectedAgent.responsibility,
}
```

- [ ] **Step 3: Disable send with no selected agent**

If `selectedAgent == null`, send button disabled and placeholder shows a neutral label.

- [ ] **Step 4: Replace static agent import in MessageTimeline**

Use `useAgents()` for current labels.

V1 acceptable behavior:

- historical messages display current agent name
- if agent was deleted, show `Unknown agent`

- [ ] **Step 5: Manual verification**

Run: `bun run dev:desktop`

Verify:

- Composer uses edited agent name immediately
- Composer sends edited responsibility in chat request
- deleted selected agent falls back
- message badges still render

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/chat/Composer.tsx apps/desktop/src/renderer/components/chat/MessageTimeline.tsx
git commit -m "feat(desktop): use shared agents in chat"
```

### Task 6: Final verification

**Files:**

- Modify if needed: `docs/superpowers/plans/2026-04-24-desktop-chat-cli.md`

- [ ] **Step 1: Check stale static imports**

Run:

```bash
rg -n "import \\{ agents|agents \\} from .*uiShellData|from \"../../mock/uiShellData\"|from \"../mock/uiShellData\"" apps/desktop/src/renderer
```

Expected:

- `AgentsPage`, `Composer`, and `MessageTimeline` no longer import static `agents`.
- Other imports from `uiShellData` are seed/type imports only.

- [ ] **Step 2: Run tests**

Run:

- `cd apps/desktop && bun test src/renderer/lib/agents.test.ts`
- `cd apps/desktop && bun test src/shared/workspacePersistence.test.ts`
- `cd apps/desktop && bun test src/renderer/context/WorkspaceContext.test.ts`
- `bun run typecheck`
- `bun run lint`

Expected: PASS except pre-existing lint warnings if still present.

- [ ] **Step 3: Manual QA**

Run: `bun run dev:desktop`

Verify:

- create agent
- edit agent
- delete agent
- navigate away and back
- restart app and confirm agents reload from workspace snapshot
- send a chat message with an edited agent

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer apps/desktop/src/shared
git commit -m "feat(desktop): make agents editable workspace settings"
```

## Milestones

### Milestone A: Editable Agents

Done when:

- AgentsPage edits `name`, `responsibility`, `runtime`
- create/delete works
- data survives route changes

### Milestone B: Agents Drive Chat

Done when:

- Composer reads shared agent state
- chat request uses edited agent config
- deleted selected agent falls back cleanly

### Milestone C: Agents Persist

Done when:

- agents save into workspace snapshot
- old snapshots without agents still load
- app restart keeps edited agents

## Notes

- Keep agent settings independent from project settings.
- Do not add agent templates or presets.
- Avoid creating another persistence IPC unless workspace snapshot becomes a real constraint.
- If this makes `WorkspaceContext` feel too broad, keep mutations in `AgentContext`; only store `agents` and `setAgents` there for persistence.

## Final Verification Command Set

```bash
cd apps/desktop && bun test src/renderer/lib/agents.test.ts
cd apps/desktop && bun test src/shared/workspacePersistence.test.ts
cd apps/desktop && bun test src/renderer/context/WorkspaceContext.test.ts
bun run typecheck
bun run lint
bun run dev:desktop
```
