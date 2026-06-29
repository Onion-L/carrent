# Run One Kimi ACP Chat Turn End To End

Status: ready-for-agent

## Parent

.scratch/kimi-acp-v1/PRD.md

## What to build

Wire the first production Kimi ACP Runtime path through Carrent's Chat run boundary. A user should be able to send one message in a project thread, Carrent should drive Kimi Code through ACP, stream text back into the current thread, and finish with a normal Carrent completion event.

This should be a narrow tracer bullet: one successful prompt path, one failure path, and fake ACP transport tests. Tool/file activity, stop, permissions, session continuity, and Provider Profile behavior can remain minimal until later slices.

## Acceptance criteria

- [ ] A project-scoped chat turn can run through Kimi ACP and emit Carrent chat events.
- [ ] The renderer continues to consume Carrent chat events rather than ACP-specific event shapes.
- [ ] A successful Kimi ACP run emits started, streamed text/progress, and completed behavior visible to the chat flow.
- [ ] ACP startup or prompt failure emits a useful failed event.
- [ ] The project workspace is passed through according to the protocol behavior verified by the spike.
- [ ] Tests use a fake ACP transport and do not require a real Kimi process.
- [ ] Existing Codex/Claude/pi chat tests are not broken by the Kimi path.

## Blocked by

- .scratch/kimi-acp-v1/issues/01-spike-kimi-acp-protocol-contract.md
- .scratch/kimi-acp-v1/issues/02-make-kimi-code-the-primary-runtime.md

## Comments
