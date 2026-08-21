# Split permissions into approval policy and access mode

Status: ACCEPTED (2026-08-21). Revised after review: outside-project mutations prompt in every mode, the danger list is a superset of today's, user allow rules can override built-in danger, the approval axis is deferred, and the work is phased. All four review questions resolved to their recommendations; see Decisions at the end. Implementation plan: `docs/permissions-implementation-plan.md`.

Today one `AgentMode` (`ask` / `auto-edit` / `full-project`) encodes both when the agent asks the user and what it may touch, command safety is judged by regexes in `packages/core/src/commandPolicy.ts` (false positives such as `echo rm`, bypasses such as `bash -c 'rm …'`), and "Always allow" grants live only in thread memory. This ADR redesigns the permission model with OpenAI Codex as the reference.

Codex's load-bearing ideas we adopt: permissions as orthogonal axes (approval policy × sandbox scope) with presets over them; two-track command classification — a loose literal extractor that can only prove danger and a strict parser that can only prove safety; grants persisted as user-level prefix rules; project-supplied policy gated by a per-project trust flag stored in user space. What we do **not** copy: Codex can afford path-unrestricted modes and a narrow danger list because Seatbelt/Landlock enforce underneath. We have no OS sandbox — every rule here is enforced at the tool layer (`beforeToolCall`) only. Our design keeps an invariant Codex does not need:

> **Outside-project invariant:** any mutation of paths outside the project — file writes, or a bash command whose parsed paths reference outside targets — prompts in every mode. No preset disables this.

This is today's behavior (`commandPolicy.ts` flags outside paths regardless of mode; `approvalPolicy.ts` prompts for outside writes) kept as the permanent no-sandbox backstop. It also bounds the blast radius of classifier mistakes to the project directory.

## The model

The target model has two axes; v1 implements only the access axis (see Phasing):

- `approvalPolicy` (deferred): `on-request` | `never`. Every v1 surface behaves as `on-request`. `never` — nothing prompts, flagged operations are denied at the tool layer with a reason returned to the model — lands together with a real unattended entry point, which Carrent does not have today. Until then the axis exists in this document only.
- `accessMode`: `read-only` | `workspace-write` | `full-project`.
  - `read-only`: reads anywhere; every write/edit and every bash command prompts.
  - `workspace-write`: reads anywhere; writes free inside writable roots — project root plus system temp plus user-configured extra roots — with `.git` and `.carrent` kept read-only inside them; safe bash whose paths stay inside writable roots runs free; everything outside prompts (invariant).
  - `full-project`: like workspace-write but `.git` is writable; plain `rm file` (no force/recursive flags) inside the project runs without prompting; everything outside still prompts (invariant).

Presets in the Composer dropdown map one-to-one to access modes — Ask, Auto, Full Project — preserving the existing three names and their `agentMode` persistence values; `ask` → Ask, `auto-edit` → Auto, `full-project` → Full Project migrate in place. The custom-profile and bypass combinations live in settings behind a warning, not in the dropdown.

We have no OS-level sandbox; a misclassified command still runs with the user's full privileges, same exposure as today but bounded to the project directory by the invariant. The axis names and semantics are chosen so a real sandbox can slot in later — at which point the invariant can be revisited — without changing the model.

## Command classification

Replace the regexes with a two-track classifier, both tracks operating on a real tokenizer rather than raw regex over the command string:

- Danger extractor (loose): tokenizes including quotes, `$(…)`, and backticks, unwraps `sudo` / `env` / `nohup` / `bash -c` / `sh -c` / `xargs` / `trap` wrappers recursively up to a small depth cap, and fails closed past the cap. It can only ever prove danger. This kills the `bash -c 'rm …'` bypass.
- Safe parser (strict): splits compounds on `&&`, `||`, `;`, `|` only when all tokens are pure literals. Variables, globs, redirects, subshells, and `~` make the command unprovable, which falls back to prompting. It can only ever prove safety, and it yields argv plus paths for scope checks and prefix rules. String arguments are never command positions, which kills the `echo rm` false positive.
- Merge is strictest-wins per segment: any segment flagged danger or matching a stricter rule flags the whole command.

The built-in danger set is a superset of today's `DANGEROUS_COMMAND`, not Codex's narrow list: `rm` with any of `-r` / `-f` / `--force`, `rmdir`, `unlink`, `shred`, `truncate`, `sudo`, `dd of=`, `mkfs`, shutdown/reboot/erase, `find -delete`, `git reset --hard`, `git clean -f`, `git checkout --` / `git restore --`, `git branch -D`, `git push --force`, `chmod -R`, `chown -R`, `kill` / `pkill` / `killall`. `git restore -- .` wiping uncommitted work is the least recoverable operation a coding agent can trigger; it stays listed. Plain `rm file` without force flags is not danger-listed — the outside-project invariant still catches it anywhere it matters.

## Rules and grant persistence

User-level prefix rules, persisted in `~/.carrent/rules/default.rules.json`, loaded once at the start of each run — no file watching, so a run classifies and executes under one consistent rule set:

```json
[{ "prefix": ["git", "status"], "decision": "allow" }]
```

Decisions are `allow` / `prompt` / `forbidden`. Project rules may live in `<project>/.carrent/rules/*.rules.json` but only when the project is trusted, and they may only tighten (`prompt` / `forbidden`), never loosen — a repo cannot ship itself broader permissions. Precedence, strictest-wins with one deliberate exception: `forbidden` (any level) > **user `allow` (explicit)** > built-in danger > `prompt` (any level) > classifier default.

The exception preserves today's behavior (`chatSessionManager.ts` grants `allow_always` for any category, so `git push --force` can be permanently allowed): an explicit user-authored rule overrides the built-in danger heuristics, because the user is the authority the heuristics protect. Pressing "Always allow" on a danger-classified command writes such a rule; the dialog marks it with a warning. `forbidden` rules always win over everything.

Approval dialogs offer: Allow once; Always allow (appends a normalized argv-prefix rule to the user file); Allow for this session (memory, keyed by normalized command plus working directory); Reject (tool output "rejected by user" so the model can adapt); Reject and explain (rejects, interrupts the turn, focuses the Composer). Write/edit approvals additionally offer "don't ask again for these files", session-scoped per path.

A rules management panel in settings lists all rules with origin (user / project / built-in) and supports revoke and manual add — a GUI advantage we keep over Codex, which has no management UI.

## Project trust

Projects gain a `trust_level` stored in App State (user space, never in the repo). Untrusted projects: forced to the Ask preset, project rules ignored. First open of an untracked directory asks a Yes/No trust dialog. Existing projects migrate as trusted — they already operated under user-granted access.

## Network and other tools

Network commands remain a prompt category in every preset; Carrent cannot block sockets, only decline to run them. "Always allow this host" extracts the host from `curl` / `wget` / `git` arguments and persists a domain rule in the user rules file. A managed proxy with domain whitelisting is out of scope.

File tools follow access modes as above. Reads become free everywhere (Codex parity — the agent runs as the user anyway and results are echoed into the thread), which deletes `additionalReadPaths` and fixes a live bug: today `approvalPolicy.ts` only honors those paths under `full-project`, so in Ask/Auto the user's own attached files and skill paths still prompt. The one-line backport (drop the mode condition) ships in Phase 1; the mechanism dissolves in Phase 2. Non-bash, non-file tools default to prompting unless individually granted, keyed per tool name.

## Phasing

One release touching classifier, rules, trust, settings UI, and migrations across core / electron / renderer is too large to land safely, and the highest-value piece needs none of the rest:

- **Phase 1 — classifier only, existing modes untouched.** Two-track tokenizer/parser under the current three `agentMode` values; no schema changes, no migration. Kills the `echo rm` false positive and the `bash -c 'rm'` bypass, evaluates today's danger list through wrappers, and backports the `additionalReadPaths` fix.
- **Phase 2 — access axis.** Rename modes to presets over `accessMode`, reads free everywhere, outside-project invariant formalized, per-thread / per-project storage per the decision below. `approvalPolicy` deliberately absent.
- **Phase 3 — persistence and trust.** Rules file with read-once loading, grant tiers (session memory + user prefix/domain rules), project trust, rules management panel, network domain grants.

## Touchpoints

- `packages/core`: `commandPolicy.ts` becomes the two-track classifier (Phase 1); new `rules.ts` (Phase 3); `approvalPolicy.ts` rewritten around the axis (Phase 2); `types.ts` enums plus migration mapping.
- `apps/desktop/electron`: `chatSessionManager.ts` grant tiers and dialog options; persistence migration for trust level; settings IPC.
- `apps/desktop/src/renderer`: Composer preset dropdown, permission dialog options, settings rules panel.

Out of scope for v1: OS sandboxing (Seatbelt/Landlock), managed network proxy, granular per-category toggles, per-server MCP policy, project-level `allow` rules.

## Decisions

All four review questions resolved on 2026-08-21, each to its recommendation:

1. Outside-project mutations prompt in every mode, including Full Project — the no-sandbox backstop; Full Project keeps today's outside gating rather than adopting Codex's unrestricted mode.
2. Preset storage stays per-project default with per-thread override (today's shape: `default_runtime_mode` plus per-thread `runtime_mode`).
3. Explicit user `allow` rules override built-in danger (restores permanent allow for `git push --force` etc.), with a warning in the dialog; `forbidden` rules always win.
4. `approvalPolicy` / `never` deferred until an unattended entry point exists; no no-op axis ships.

Settled during review: no OS sandbox this round; danger list is a superset of today's (with `git checkout --` / `git restore --`, `rmdir`, `unlink`, `truncate` restored); plain in-project `rm file` without flags runs free under Full Project; Auto runs safe in-project bash; reads outside the project stop prompting; existing projects migrate as trusted; rules load once per run, no hot-reload.
