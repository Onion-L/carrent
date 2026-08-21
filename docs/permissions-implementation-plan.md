# Permissions implementation plan

Companion to `docs/adr/0015-two-axis-permission-model.md`. The ADR's four review decisions were confirmed on 2026-08-21 (outside-project invariant on; project default + thread override; user allow rules override built-in danger; `approvalPolicy` deferred). **Phase 1 depends on none of them** and starts immediately.

File references are current as of this writing; PRs follow the repo's Conventional Commit style and tests are named after behavior, per `AGENTS.md`.

Where this plan and the ADR disagree, this plan wins and the ADR gets fixed alongside the PR: the ADR's danger list (line 39) dropped `git checkout --`, `git restore --`, `rmdir`, `unlink`, and `truncate`, and its merge order (line 49) still puts built-in danger above user `allow`, which decision 3 reversed.

## Baseline: what today's regex actually does

Measured against `DANGEROUS_COMMAND` in `packages/core/src/commandPolicy.ts:9`. The match prefix is `(^|[;&|]\s*|\s)`, so a quote before the keyword blocks the match:

| Command                                     | Today         | Correct             |
| ------------------------------------------- | ------------- | ------------------- |
| `echo rm -rf /`                             | dangerous     | no — false positive |
| `grep -rn kill src/`                        | dangerous     | no — false positive |
| `bun test kill`                             | dangerous     | no — false positive |
| `ls truncate.sql`                           | dangerous     | no — false positive |
| `bash -c 'rm -rf build'`                    | not dangerous | yes — bypass        |
| `echo "rm -rf /"`                           | not dangerous | correct by accident |
| `xargs rm`, `sudo rm`, `env rm`, `nohup rm` | dangerous     | already correct     |

So Phase 1's real wins are the four unquoted-argument false positives plus the quoted-wrapper bypass. Wrapper unwrapping matters for correctness of intent, not because `sudo rm` slips through today — bare `rm\b` already catches it.

## Phase 1 — two-track classifier under existing modes (one PR)

Scope: `packages/core` only. `classifyCommand`'s decisions are preserved except the false positives and the bypass above, plus one adjacent fix in `approvalPolicy.ts`. No schema, migration, or renderer changes.

1. **New `packages/core/src/shellCommand.ts`** — tokenizer and the two tracks:
   - `tokenize(input)` — quotes (`'…'`, `"…"`), backslash escapes; `$(…)`, backticks, and `$VAR` produce opaque tokens. Returns `null` on parse error (fail closed).
   - Danger extractor (loose): `findCommandWords(input)` returns every argv array at a command position, descending only into executable-string arguments (`bash -c`, `sh -c`, trailing `xargs` command, `trap` action, command after `sudo` / `env` / `nohup`) with a depth cap of 8, failing closed past it. Plain string arguments are never command positions.
   - Safe parser (strict): `parseSegments(input)` splits compounds on `&&`, `||`, `;`, `|` and returns per-segment argv only when every token is a pure literal; any opaque token, glob, redirect, or `~` returns `null` (unprovable).
2. **Rewrite `classifyCommand` internals** in `commandPolicy.ts`. Signature and `CommandClassification` shape stay unchanged so `agentCore.ts` needs no edit:
   - `dangerous` = danger patterns matched as **argv prefixes** over `findCommandWords` output, which is what removes the false positives.
   - Danger list: today's `DANGEROUS_COMMAND` in full, including `git checkout --`, `git restore --`, `rmdir`, `unlink`, `truncate`, and unconditional `rm`. Force-flag scoping for `rm` lands in Phase 2.
   - `network` and `outsideProject` keep their existing regexes untouched this phase.
3. **`approvalPolicy.ts`**: drop the `mode === "full-project"` condition on `authorizedRead` (line 71) so user-attached files and skill paths stop prompting in Ask/Auto. This is the only change outside `commandPolicy.ts`/`shellCommand.ts`.
4. **Tests**:
   - `commandPolicy.test.ts` — the four false positives now safe (`echo rm -rf /`, `grep -rn kill src/`, `bun test kill`, `ls truncate.sql`); `bash -c 'rm -rf build'` dangerous; `xargs rm`, `sudo rm`, `env rm`, `nohup rm` stay dangerous; depth cap fails closed; `rm $TARGET` unprovable so it still prompts outside Full Project; compound strictest-wins (`echo hi && rm build` dangerous); existing cases stay green (`bun test` free in full-project, `/dev/null` exemption, network, outside-project paths).
   - `approvalPolicy.test.ts` — **flip the existing assertion at lines 70-80**: reading an attached skill path under `ask` becomes `requiresApproval: false`. The `full-project` read case and the `write` case at lines 81-91 are unchanged.
5. **Validation**: `cd packages/core && bun test` (no `test` script; Bun's runner picks up `*.test.ts`), then `bun run lint` and `bun run typecheck` at the repo root.

## Phase 2 — access axis and presets (one PR)

`AgentMode` values are reused as preset ids, so no migration is needed: the columns are `workspace_project_associations.default_agent_mode` (project default) and `agent_mode` on `threads` / `thread_drafts` / `thread_runs` / `promotion_intents` (thread override), all renamed away from `runtime_mode` in `migrations.ts:340-401`, and their CHECK constraints keep passing on the existing values.

The access axis uses **`full-access`** as its third value, matching the ADR. `AgentMode`'s `full-project` stays as the preset id, so the mapping is a rename at the boundary, not a shared literal.

1. **`types.ts`**: add `AccessMode = "read-only" | "workspace-write" | "full-access"` plus a pure `accessModeOf(mode: AgentMode)` mapping (`ask`→`read-only`, `auto-edit`→`workspace-write`, `full-project`→`full-access`). `approvalPolicy` and `classifyCommand` take `AccessMode`.
2. **`commandPolicy.ts`**: `rm` requires `-r` / `-f` / `--force` to be danger-listed; `network` and `outsideProject` move onto parser output where provable, with the loose literal scan as the backstop for unprovable commands; `requiresApproval` becomes mode-aware per the ADR matrix — safe in-project bash runs free under `workspace-write` too (today it prompts under `auto-edit`).
3. **`approvalPolicy.ts` rewrite** around the axis:
   - reads (`read` / `grep` / `find` / `ls`) free everywhere in every mode. This deletes `additionalReadPaths` and its plumbing (`types.ts:87`, `agentCore.ts:122`, `chatSessionManager.ts:175`), superseding the Phase 1 fix at step 3 — intentional rework so the fix ships to users a phase early.
   - outside-project invariant: `write` / `edit` to outside paths prompt in every mode, and bash referencing outside paths prompts in every mode. This is what keeps `full-access` from silently deleting `~/Documents` once `rm` needs force flags.
   - `workspace-write` keeps `.git` and `.carrent` read-only inside the project (write prompts); `full-access` allows them.
4. **Renderer copy**: `getAgentModeLabel` in `apps/desktop/src/shared/agentMode.ts:13` currently returns "Ask" / "Auto Edit" / "Full Project"; rename the latter two to "Auto" / "Full Access" and update `agentMode.test.ts:11-13`. Add one-line per-preset semantics to the `Composer.tsx` dropdown (around line 3156) and refresh the `(danger)` hint. Approval titles in `chatSessionManager.ts` follow the new classification names.
5. **Tests**: rewrite `commandPolicy.test.ts` and `approvalPolicy.test.ts` around the per-mode × per-operation matrix, keeping behavior-named cases (`plain rm inside the project runs without prompting under Full Access`, `writes outside the project always prompt`, `.git stays read-only under Auto`).
6. **Validation**: `bun test` in `packages/core` and `apps/desktop`, lint, typecheck. Manual pass: `rm build.log` in-project free under Full Access, `rm ~/notes.txt` prompts, attached external file readable under Ask without a prompt.

## Phase 3 — rules, grants, trust, management UI (three PRs)

**PR 3 — core rules engine.** New `packages/core/src/rules.ts`: load `~/.carrent/rules/default.rules.json` (user) and `<project>/.carrent/rules/*.rules.json` (project, tighten-only). Merge precedence, strictest-wins except for the one deliberate exception in decision 3:

```
forbidden (any source)  >  project prompt  >  user allow  >  built-in danger  >  classifier default
```

Project `prompt` sits **above** user `allow` on purpose — otherwise a user allow rule would erase the tightening a repo asked for and tighten-only would be meaningless. User `allow` above built-in danger is decision 3, which is what lets someone persist `git push --force` on their own fork. Rules are read once per `core.run` and passed in as input; no file watching. `classifyCommand` / `classifyToolApproval` consult the merged set. Unit tests for each precedence pair, tighten-only enforcement (a project `allow` is ignored, not honored), and malformed-file fail-closed.

**PR 4 — grants and dialog.** Extend `ChatPermissionOptionKind` in `apps/desktop/src/shared/chatPermissions.ts:3` (today `allow_once` | `allow_always` | `reject_once`) with `allow_session`; reject-and-explain is a response variant, not a new kind. In `chatSessionManager.ts`: session grants keyed by normalized command (tokenized argv joined) plus working directory, replacing the raw-string `allowAlwaysKey` grant at line 362; `allow_always` routes through IPC so Electron main appends the prefix rule to the user rules file, effective next run. Danger-classified always-allow requests carry a `warning` flag the dialog renders. Reject-and-explain rejects the call, interrupts the turn, and focuses the Composer. Write/edit dialogs gain session-scoped "don't ask again for these files". Tests in `chatIpc.test.ts` and the renderer tests next to `Composer.test.tsx`.

**PR 5 — trust and management panel.** Migration adding `trusted_at TEXT` to `projects` (`migrations.ts:129`), backfilled so existing rows are trusted (decision 6). First open of an untrusted directory raises a Yes/No trust dialog; untrusted projects are forced to Ask and their `.carrent/rules/` ignored. Network host extraction (`curl` / `wget` / `git` args) feeds "always allow this host" domain rules into the user rules file. Settings gains the rules management panel: list with origin badge (user / project / built-in), revoke, manual add.

## Sequencing

Phase 1 merges first and independently — bug-fix value, no decisions, no migration risk. Phase 2 needs decisions 1 and 2 (invariant, storage shape), both settled. Phase 3 needs decision 3 (precedence), settled; PRs 4 and 5 can run in parallel once PR 3 lands. Decision 4 (`approvalPolicy` deferral) is off the critical path.
