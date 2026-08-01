# 05 - Preserve Kimi Timeline across replay and Runtime regression checks

**What to build:** Make the completed Kimi Timeline durable and safe to replay. When a user reopens a Thread, the same ordered Thinking, message, and tool items, statuses, and final answer are shown without duplication. Other Runtime behavior remains unchanged.

**Blocked by:** 03 - Make Kimi final answers and Run terminal authoritative; 04 - Preserve Run Checklist and tolerate unknown ACP updates

**Status:** done

- [x] A persisted Kimi Run restores Thinking, message, and tool items in first-seen order with their merged content and terminal statuses.
- [x] Restoring or replaying the same normalized update is idempotent and does not duplicate timeline items or message segments.
- [x] A reopened Thread preserves the distinction between intermediate message segments and final answer segments.
- [x] Persisted failed and stopped Runs retain tool errors, cancellation states, and the correct Run outcome.
- [x] Run Checklist restoration continues to work alongside the Kimi Timeline without changing item order.
- [x] Existing Codex, Claude, pi, and other Runtime event mappings retain their current behavior and do not require Kimi-specific fields.
- [x] The Kimi path does not issue an additional summary request during persistence, hydration, or replay.
- [x] Shared state, Thread content, Message Timeline, and Agent Activity tests cover hydration, replay, cross-window/event-authority application, and Kimi-specific regression cases.
- [x] The targeted Kimi ACP, Chat session manager, shared message-state, Message Timeline, and Agent Activity test suites pass together.

## Comments

Validation:

- `bun run lint`
- `bun run typecheck`
- `bun test` (1386 pass)
- `git diff --check`

Review:

- Standards and Spec reviews completed. Kimi replay protection is scoped to Kimi Run messages, permits only terminal-state and exact hydration reconciliation at an equal event count, and leaves other Runtime message replacement unchanged.
