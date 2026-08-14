# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --body "..."`
- Apply/remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests. Resolve an ambiguous
`#42` with `gh pr view 42`, then fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

For a PRD with implementation tickets:

- Create one parent issue containing the PRD.
- Create each ticket as a child issue when GitHub sub-issues are available.
- Otherwise, add a task list linking the tickets to the parent issue.
- Represent blocking relationships using GitHub issue dependencies when available.
- Otherwise, add `Blocked by: #<number>` to the ticket body.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

- Store the map and every decision ticket as GitHub issues with the required `wayfinder:*` labels.
- Attach tickets to the map with GitHub's native `addSubIssue` GraphQL mutation.
- Express dependencies with GitHub's native `addBlockedBy` GraphQL mutation.
- Treat open, unassigned sub-issues whose `blockedBy` issues are all closed as the frontier.
- Claim a frontier ticket by assigning it before doing any work.
- Record a ticket's answer in a closing comment; keep only its linked one-line gist in the map's `Decisions so far` section.
