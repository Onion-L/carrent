# Issue Planner — Reference

Analysis rubric, plan-file template, and edge cases for the issue-planner skill.

## Triage classification

Use the label strings from `docs/agents/triage-labels.md` (right-hand column).

| Label / observed state | Action |
| --- | --- |
| `ready-for-agent` | executable → plan file + dispatch prompt |
| `needs-triage` (or no label and under-specified) | deferred; list the missing spec points to resolve in triage |
| `needs-info` | deferred; list the exact questions for the reporter |
| `ready-for-human` | excluded from the agent order; list with reason |
| `wontfix` | excluded; list with reason |

Never invent acceptance criteria to make an issue "executable". If in doubt, defer.

## Scoring rubric

- **Priority** — P1: data loss, security, crash, or blocks other issues / the release. P2: broken user-visible feature or important workflow. P3: polish, docs, internal refactor.
- **Effort** — S: single file, few lines. M: one module with tests. L: cross-cutting (multiple apps/packages, schema, IPC, migrations).
- **Risk** — LOW: isolated change with existing test coverage. MED: shared code, behavior change without coverage. HIGH: IPC/process/data migrations, cross-app coupling.

## Ordering algorithm

1. Parse `Blocked by: #N` / `Depends on: #N` out of every body; treat "part of #N" / "extracted from #N" references as soft deps.
2. Topological sort. Ties broken by (Priority asc, Effort asc, Risk asc, issue number asc).
3. Cut into waves at dependency boundaries: an issue joins the earliest wave where all its deps are done.
4. Unblocked quick wins (P1/S or P2/S) may jump to Wave 0 even ahead of a bigger P1 — small unblocked fixes shrink the graph. Say so in the index when you do this.
5. Big/risky items (L effort or HIGH risk) each get their own wave; never batch two L items into one wave.

## Per-issue plan file template

`plans/gh-<n>-<slug>.md` (slug = title lowercased, non-alphanumerics → `-`):

```md
# Plan GH-<n>: <title>

> **Executor instructions**: Read this plan fully before starting. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report — do not improvise. When done, update
> this issue's status row in `plans/issue-batch-<date>.md` — unless a reviewer
> dispatched you and said they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat <base-commit>..HEAD -- <affected files>`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against live code; on a mismatch, treat it as a
> STOP condition.

## Status

- **Issue**: #<n> · **Priority**: Px · **Effort**: S/M/L · **Risk**: LOW/MED/HIGH
- **Wave**: <n> · **Depends on**: #<n> or none · **Planned at**: commit `<sha>`, <date>

## Issue context

- Reporter's summary and acceptance criteria, quoted from the issue body.
- Notes from comments that change scope or add constraints.

## Why this matters

One paragraph on the user-visible impact (or risk) this fixes.

## Current state

- Affected files with line hints, verified by `read`/`grep` against live code.
- Short excerpts where the change lands.

## Steps

1. <concrete step> — verify: `<command>` → expected output
2. ...

## Verification

From AGENTS.md: `bun run lint`, `bun run typecheck`, plus targeted `bun test`
files for changed runtime code. List the exact commands for this issue.

## STOP conditions

- Concrete mismatch/failure conditions (drift in affected files, unexpected
  behavior, test failures that reveal a different root cause). Stop and report.
```

## Batch index template

`plans/issue-batch-<YYYY-MM-DD>.md`:

```md
# Issue batch <date> — <owner/repo>

Planned from `.scratch/gh-issues.json` at commit `<sha>`.
Planning output only — nothing here has been executed.

## Execution order

| Wave | Issue | Title | Priority | Effort | Risk | Depends on | Status |
|------|-------|-------|----------|--------|------|------------|--------|

Status values: TODO | IN PROGRESS | DONE | BLOCKED (one-line reason) |
DEFERRED (one-line reason) | EXCLUDED (one-line reason)

## Dependency notes

- Which issues are independent (parallel-able), which block which, and any
  ordering decision that overrides the raw score (with the reason).

## Dispatch prompts

One self-contained paragraph per executable issue: goal, affected modules,
key constraints, and a pointer to its plan file. Copy one per subagent when
execution is later approved.

## Deferred (needs-info / needs-triage)

Issue, what is missing, and the exact questions to ask the reporter.

## Excluded (ready-for-human / wontfix)

Issue, label, and reason.
```

## Worked example (compact)

Issues: #12 `needs-triage`-unlabeled small crash fix (P1/S, unblocked); #13
feature (P2/M) whose body says `Blocked by: #12`; #14 `needs-info` (missing
repro steps).

Result: Wave 0 = #12; Wave 1 = #13; deferred = #14 with questions
"Which OS/version? Repro steps? Expected vs actual output?". Dispatch prompts
written for #12 and #13 only. No code touched, no issue edited.

## Failure handling

- **gh unauthenticated / missing** — the script exits non-zero with gh's error.
  Tell the user to run `gh auth login`; never fabricate issues.
- **A number resolves to a PR** — the script falls back to `gh pr view` and
  marks `isPullRequest: true`. Skip PRs from the plan; list them in a note.
- **Empty list** — report "no open issues", write the empty snapshot, stop.
- **Rate limits / API errors** — report gh's stderr and stop; do not retry in a loop.
- **Uncertain dependency** — mark it "inferred" in the index instead of asserting.
