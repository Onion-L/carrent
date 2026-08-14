---
name: issue-planner
description: Fetch open GitHub issues of the current repo, analyze each issue and its comments, and produce a dependency-ordered, prompt-per-issue implementation plan without executing any fix. Use when the user asks to pull issues from GitHub (获取 Issue), triage or prioritize issues, arrange the order to fix them (排期 / 修复顺序 / 先修哪个后修哪个), plan an issue batch or sprint, or turn issues into executor prompts.
---

# Issue Planner

Planning-only mode. It reads the repo's GitHub issues and arranges the work; it never implements.

## Hard rules — never break

1. **Plan only.** Do NOT edit code, create branches/commits/PRs, close or relabel issues, or post issue comments. The moment a fix feels necessary, this skill has finished — a fresh user request is required to execute.
2. **Read-only `gh`.** Only `gh issue list`, `gh issue view`, and `gh pr view` (fallback for the shared number space). No other `gh` subcommands.
3. **Outputs only under `plans/` and `.scratch/`** (both gitignored). Do not touch `plans/README.md` — it belongs to the improve skill's numbering.
4. If an issue is under-specified, never invent requirements. Defer it and list the exact questions to ask the reporter.

## Workflow

### 1. Fetch issues

```bash
bun .agents/skills/issue-planner/scripts/fetch-issues.ts
```

Writes a JSON snapshot of every open issue (body, labels, comments) to `.scratch/gh-issues.json` and prints a summary. Options: `--state open|closed|all`, `--limit N`, `--numbers 19,18`, `--out <path>`. If the user names specific issues/PRDs, fetch those numbers too. The script infers the repo from `git remote -v`.

### 2. Read the repo's issue conventions

Read `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`; use the label strings from the right-hand column of the triage table. Skim `docs/agents/domain.md` and relevant `docs/adr/*.md` to anchor affected-module claims.

### 3. Read and classify each issue

For every issue in the snapshot, extract: goal, acceptance criteria, affected modules (`apps/desktop`, `apps/landing`, `packages/ui`), explicit dependencies (`Blocked by: #N`), triage label state, and open questions from comments.

Classify into one of:

- **executable** — fully specified (`ready-for-agent`, or clearly specified with no label) → gets a plan file + dispatch prompt.
- **deferred** — `needs-info` / `needs-triage`, or under-specified → deferred list with the exact questions to ask. No plan file.
- **excluded** — `ready-for-human`, `wontfix` → listed with the reason. No plan file.

### 4. Arrange the order

1. Build the dependency graph from `Blocked by:` plus explicit module coupling; topological order; a blocked issue never comes first.
2. Score each executable issue: Priority P1/P2/P3 × Effort S/M/L × Risk LOW/MED/HIGH (rubric in REFERENCE.md).
3. Group into waves. Wave 0 = unblocked quick wins; later waves = dependents, then big/risky items. Issues within one wave can run in parallel; waves run in sequence.
4. Write the reasoning for every ordering decision into the batch index.

### 5. Write the plan output (this is the "output prompt")

For each executable issue, write `plans/gh-<number>-<slug>.md` from the template in REFERENCE.md — a self-contained executor prompt (context, steps, verification, STOP conditions). Ground `Current state` with real `read`/`grep` before writing; never fabricate file paths or line numbers.

Then write the batch index `plans/issue-batch-<YYYY-MM-DD>.md`: order table, wave grouping, dependency notes, deferred questions, excluded issues, and a one-paragraph dispatch prompt per issue for handing to subagents.

### 6. Report and stop

Chat summary: ordered issue list with one-line reasons, deferred/excluded lists, and file locations. End by offering to execute a specific wave — but do NOT start it yourself.

## Analysis rubric, plan template, examples

See [REFERENCE.md](REFERENCE.md).
