# Research Kimi's feature surface beyond Plan and Goal

Status: done
Labels: wayfinder:research
Assignee: research-agent

## Parent

[Chart Carrent from Kimi-first V1 to automated multi-Runtime workflows](../PRD.md)

## Question

In the current Kimi Code CLI and ACP surface, which user-visible execution modes, session controls, orchestration features, commands, and Agent capabilities exist beyond normal Runs, Plan Mode, and Goal Mode? Verify Swarm, Fork, and any adjacent features against first-party sources and the installed CLI, distinguish modes from tools and session operations, and identify which capabilities Carrent V1 should expose or preserve.

## Blocked by

None.

## Comments

### Resolution - 2026-07-25

Research completed on branch `research/kimi-feature-surface` at commit `e2c67c4fc050d732568e621a62160651af0da337`. The report is `.scratch/agent-runtime-roadmap/research/kimi-feature-surface.md` on that branch.

Kimi 0.29.1 has more than three peer modes. Ordinary execution is a Carrent Run; Plan Mode is a constrained agent state; Goal Mode is an autonomous multi-turn lifecycle; Swarm Mode is a temporary policy around the `AgentSwarm` tool; Fork is Session lifecycle control. Kimi also provides subagents, background tasks, `/btw`, Goal queues, scheduled tasks, Skills, MCP, slash commands, and Session management.

ACP is sufficient for ordinary Runs, Plan Mode, permissions, cancellation, Session continuity, and generic tool activity. It does not document dedicated Goal, Swarm, Fork, or `/btw` methods. V1 should preserve Kimi-owned tools through generic activity and permissions, while any first-class Goal, Swarm, or Fork control requires observed 0.29.1 ACP behavior before Carrent promises it.
