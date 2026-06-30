# Support Stop And Safe Permission Handling

Status: done

## Parent

.scratch/kimi-acp-v1/PRD.md

## What to build

Add stop behavior and honest permission handling for Kimi ACP runs. A user should be able to interrupt an in-flight Kimi run. If Kimi ACP exposes permission requests, Carrent should surface them according to the observed protocol. If a permission action is unsupported, Carrent should fail safely and avoid fake approve/deny controls.

## Acceptance criteria

- [x] Stopping an in-flight Kimi ACP run cancels or terminates it according to the verified protocol behavior.
- [x] A stopped run emits a stopped state visible to the existing chat flow.
- [x] Permission request events are surfaced if ACP provides a supported request/response path.
- [x] Unsupported permission flows produce a clear failure or safe fallback message.
- [x] Carrent does not show approve/deny UI unless the underlying ACP response path works.
- [x] Tests cover stop, supported permission handling if available, and unsupported permission fallback.

## Blocked by

- .scratch/kimi-acp-v1/issues/03-run-one-kimi-acp-chat-turn-end-to-end.md

## Comments
