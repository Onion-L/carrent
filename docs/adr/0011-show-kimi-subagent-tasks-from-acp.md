# Show Kimi subagent tasks from ACP

Carrent shows Kimi Subagent Tasks by normalizing the parent `Agent` and `AgentSwarm` tool calls that Kimi already publishes over ACP. Carrent keeps ACP over stdio as the Kimi transport for this delivery, and the parent tool calls are the source of Subagent Task lifecycle, delegated prompts, runtime agent ids, and final summaries.

## Considered Options

- **Keep ACP and normalize parent tool calls**: Chosen because Kimi's ACP adapter already emits the parent `Agent`/`AgentSwarm` tool calls with their inputs and results, so Carrent can show one inspectable Subagent Task per invocation without changing transports.
- **Read Kimi's private session files**: Rejected. Files under `~/.kimi-code` are not a supported integration interface, and parsing them would couple Carrent to Kimi-internal storage that can change without notice.
- **Publish the full child transcript**: Deferred. Kimi's ACP adapter does not expose child-agent messages, thoughts, or tool calls, so a live child transcript is unavailable over the current ACP integration. Choosing between `kimi web`/KAP and an ACP extension for that is a separate decision.

## Consequences

Subagent Task data is best effort: unknown or changed Kimi output degrades to the existing generic Tool Activity and must never fail the parent Run. Carrent must not imply it has live child-agent transcripts. A future KAP or ACP-extension adapter should update the same transport-neutral Subagent Task contract instead of adding another UI store.
