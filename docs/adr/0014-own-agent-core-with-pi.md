# Own the coding agent with pi

Carrent is a coding agent, not a GUI for an external agent runtime. `packages/core` owns the Agent Loop, built-in tools, approval policy, provider calls, and system instructions using `pi-ai` and `pi-agent-core`.

Provider Profiles configure Anthropic or OpenAI-compatible endpoints with an API key, Base URL, and model ID. Credentials live in `~/.carrent/agent/auth.json` and never enter persisted App State.

The first Agent Core version exposes exactly seven tools: `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`. Project reads are always allowed. Ask requires approval for writes and shell commands; Auto Edit allows project writes but requires approval for shell commands; Full Project allows project reads, writes, and ordinary shell commands. External paths, network access, and dangerous commands always require approval. Approval choices are Allow once, Always allow for the current Thread, and Reject.

ACP, external Runtime Sessions, Native Runtime, Carrent Bridge, and the Local MCP Server are removed. Existing persisted data is migrated where practical, but this architecture change does not promise compatibility with previous Threads.
