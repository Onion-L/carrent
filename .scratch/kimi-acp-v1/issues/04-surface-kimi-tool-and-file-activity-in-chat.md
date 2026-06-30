# Surface Kimi Tool And File Activity In Chat

Status: done

## Parent

.scratch/kimi-acp-v1/PRD.md

## What to build

Extend the Kimi ACP Runtime path so shell, tool, and file activity from Kimi Code is surfaced in Carrent's existing chat event vocabulary. Users should be able to inspect meaningful Coding Agent activity without the renderer knowing ACP internals.

## Acceptance criteria

- [x] Kimi shell/tool activity is normalized into Carrent chat events that the existing chat UI can display.
- [x] File read/edit activity is surfaced clearly enough for a user to understand that Kimi Code touched project files.
- [x] Unknown or unsupported ACP activity is handled safely without crashing the run.
- [x] Long tool output is bounded or summarized consistently with existing chat behavior.
- [x] Tests cover at least one shell/tool event, one file activity event, and one unknown event.
- [x] The renderer does not depend on ACP-specific protocol objects.

## Blocked by

- .scratch/kimi-acp-v1/issues/03-run-one-kimi-acp-chat-turn-end-to-end.md

## Comments

Validation:

- `bun test apps/desktop/electron/chat`
- `bun test apps/desktop/electron/chat apps/desktop/electron/runtime apps/desktop/src/shared apps/desktop/src/renderer/lib apps/desktop/src/renderer/components/chat`
- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `git diff --check`
