# Integrate Kimi Code through ACP

Carrent will integrate Kimi Code through `kimi acp` rather than treating `kimi -p --output-format stream-json` as the main V1 runtime path. ACP matches Carrent's product boundary: Carrent is an agent GUI client, while Kimi Code owns the coding agent loop.

## Considered Options

- **ACP over stdio**: Chosen because Kimi Code exposes it as the IDE/client integration path, with JSON-RPC methods for session creation, prompt streaming, cancellation, session loading, permission requests, and file I/O.
- **Prompt mode with stream JSON**: Rejected as the primary path because it is simpler to start but makes Carrent parse command output instead of speaking an agent client protocol.

## Consequences

V1 runtime work should start with an ACP client spike for `kimi acp`. The current spawn-and-parse runtime code can inform event normalization, but the Kimi path should be modeled as protocol integration rather than another CLI output parser.
