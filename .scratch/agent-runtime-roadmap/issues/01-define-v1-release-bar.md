# Define the V1 release bar for a production-ready Kimi Runtime

Status: ready-for-human
Labels: wayfinder:grilling
Assignee: codex

## Parent

[Chart Carrent from Kimi-first V1 to automated multi-Runtime workflows](../PRD.md)

## Question

Which exact user workflows, Runtime/tool capabilities, permission and security behavior, supported platforms, failure recovery behavior, and acceptance evidence must all pass before Carrent V1 is considered complete rather than a developer preview?

## Blocked by

- [Research Kimi's feature surface beyond Plan and Goal](./11-research-kimi-feature-surface.md)
- [Verify Kimi 0.29.1 Goal Mode over ACP](./12-verify-kimi-goal-mode-over-acp.md)

## Comments

### Progress - 2026-07-25

Agreed so far:

- V1 is a formally distributed macOS public Beta for a single technical user, officially supported on Apple Silicon and macOS 26.
- Carrent uses the user's local Kimi installation and owns no account, billing, credentials, Provider API keys, or Agent Loop.
- The core project workflow covers Thread creation, Kimi file and shell work, Agent Activity, Diff review, user verification, and manual commit.
- Approval Request and User Question are separate required interactions. The default is approval-required; read-only work may proceed, while writes, shell commands, and external access require approval. More permissive modes are explicit user choices.
- Project selection authorizes the project directory. Outside files require explicit Thread Attachments; file snapshots and Skill resources stay within read-only bounded roots. Path traversal and symlink escapes are rejected.
- Stop, failure, invalid Runtime Session, and app restart preserve a consistent Thread and never automatically replay side-effecting work.
- V1 ships as a signed and notarized DMG, is checked from a clean installation, has no required auto-update or telemetry, and passes automated plus real-Kimi acceptance checks.
- Run, Plan Mode, and Kimi-native Goal Mode are first-class V1 behavior.
- Agent, AgentSwarm, background tasks, Skills, MCP, scheduled tools, and unknown future tools must remain compatible, visible, permission-aware, and non-crashing without requiring dedicated controls.
- Dedicated Swarm Mode controls, Fork, `/btw`, Goal queues, a background-task manager, complete slash-command parity, and experimental custom main-Agent selection are deferred from the V1 release gate.

Goal Mode remains unresolved at protocol level. The V1 release bar cannot close until the installed Kimi 0.29.1 ACP behavior proves an implementable lifecycle contract.
