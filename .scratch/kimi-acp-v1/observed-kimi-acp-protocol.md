# Observed Kimi ACP Protocol Contract

Status: observed

Observed on 2026-06-30 Asia/Shanghai against Kimi Code CLI 0.19.2.

Workspace used: `/Users/onion/workbench/carrent`

Spike client: `.scratch/kimi-acp-v1/spike/kimi-acp-spike.mjs`

Raw transcripts:

- `.scratch/kimi-acp-v1/spike/output/handshake.jsonl`
- `.scratch/kimi-acp-v1/spike/output/prompt.jsonl`
- `.scratch/kimi-acp-v1/spike/output/permission.jsonl`
- `.scratch/kimi-acp-v1/spike/output/cancel.jsonl`
- `.scratch/kimi-acp-v1/spike/output/list.jsonl`
- `.scratch/kimi-acp-v1/spike/output/load.jsonl`
- `.scratch/kimi-acp-v1/spike/output/resume.jsonl`
- `.scratch/kimi-acp-v1/spike/output/set-config.jsonl`

Each JSONL row includes a `seq` field. The spike client serializes stdout line handling and transcript writes so the row order reflects the observed message order.

## Re-run Commands

```sh
node .scratch/kimi-acp-v1/spike/kimi-acp-spike.mjs handshake
node .scratch/kimi-acp-v1/spike/kimi-acp-spike.mjs prompt
node .scratch/kimi-acp-v1/spike/kimi-acp-spike.mjs permission
node .scratch/kimi-acp-v1/spike/kimi-acp-spike.mjs cancel --cancel-after=1000
node .scratch/kimi-acp-v1/spike/kimi-acp-spike.mjs list
node .scratch/kimi-acp-v1/spike/kimi-acp-spike.mjs load --session=<sessionId>
node .scratch/kimi-acp-v1/spike/kimi-acp-spike.mjs resume --session=<sessionId>
node .scratch/kimi-acp-v1/spike/kimi-acp-spike.mjs set-config --config=mode --value=plan
```

Set `KIMI_BIN=/absolute/path/to/kimi` or `KIMI_ACP_CWD=/absolute/workspace` to override defaults.

## Transport

`kimi acp` speaks newline-delimited JSON-RPC 2.0 over stdio. It is not LSP-style `Content-Length` framing.

The channel is bidirectional. The client sends requests like `initialize` and `session/prompt`; Kimi sends notifications like `session/update` and can also send client requests like `fs/read_text_file` and `session/request_permission`.

Do not route by id alone. Agent requests also carry ids, and those ids can overlap with client request ids. Route messages with `method` as requests/notifications first, then route response messages by id.

## Initialize

The spike sent:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {
      "fs": { "readTextFile": true, "writeTextFile": false },
      "terminal": false
    }
  }
}
```

Kimi responded with:

- `protocolVersion: 1`
- `agentInfo.name: "Kimi Code CLI"`
- `agentInfo.version: "0.19.2"`
- `agentCapabilities.loadSession: true`
- `agentCapabilities.promptCapabilities.image: true`
- `agentCapabilities.promptCapabilities.audio: false`
- `agentCapabilities.promptCapabilities.embeddedContext: true`
- `agentCapabilities.mcpCapabilities.http: true`
- `agentCapabilities.mcpCapabilities.sse: true`
- `agentCapabilities.sessionCapabilities.list: {}`
- `agentCapabilities.sessionCapabilities.resume: {}`
- one terminal auth method named `Login with Kimi account`

The local machine was already authenticated; prompt runs worked without calling `authenticate`.

## Session Setup

`session/new` worked with:

```json
{
  "cwd": "/Users/onion/workbench/carrent",
  "mcpServers": []
}
```

Kimi returned a `sessionId` and `configOptions`. The observed config options were:

- `model`: current value `kimi-code/kimi-for-coding`, option label `K2.7 Code High Speed`
- `thinking`: current value `on`
- `mode`: current value `default`, options `default`, `plan`, `auto`, `yolo`

Kimi exposes these through newer ACP fields. The older `@zed-industries/agent-client-protocol@0.4.5` types do not include all of them; `@agentclientprotocol/sdk@1.1.0` does.

`session/set_config_option` worked for mode:

```json
{
  "sessionId": "<sessionId>",
  "configId": "mode",
  "value": "plan"
}
```

Kimi sent a `session/update` with `sessionUpdate: "config_option_update"` and returned updated `configOptions`.

## Prompt Streaming

The read-only prompt sequence was:

1. `initialize`
2. `session/new`
3. `session/prompt`
4. `session/update` with `available_commands_update`
5. many `agent_thought_chunk` updates
6. `tool_call` for `Read`
7. multiple `tool_call_update` updates
8. two `fs/read_text_file` client requests for `package.json`
9. more `agent_thought_chunk` updates
10. `agent_message_chunk` updates
11. `session/prompt` response with `stopReason: "end_turn"`

The final joined agent message was:

```text
Package name: carrent
Workspace package manager: bun@1.3.11
```

## File I/O

With `fs.readTextFile: true`, Kimi used client-side `fs/read_text_file` for `package.json`. The request used an absolute path:

```json
{
  "sessionId": "<sessionId>",
  "path": "/Users/onion/workbench/carrent/package.json"
}
```

The client response shape was:

```json
{ "content": "..." }
```

Kimi did not ask permission before `fs/read_text_file` in this run. It requested the same file twice.

Writes were not observed. The spike advertised `writeTextFile: false`, and Kimi did not send `fs/write_text_file`.

## Tool Activity And Permissions

For a prompt asking Kimi to run `pwd`, with terminal capability disabled, Kimi still represented shell execution as tool activity:

- `tool_call` with `title: "Bash"`, `kind: "execute"`, `status: "pending"`
- `tool_call_update` chunks containing `{"command":"pwd"}`
- `session/request_permission`

Observed permission request:

```json
{
  "method": "session/request_permission",
  "params": {
    "sessionId": "<sessionId>",
    "options": [
      { "optionId": "approve_once", "name": "Approve once", "kind": "allow_once" },
      { "optionId": "approve_always", "name": "Approve for this session", "kind": "allow_always" },
      { "optionId": "reject", "name": "Reject", "kind": "reject_once" }
    ],
    "toolCall": {
      "toolCallId": "0:tool_...",
      "title": "Bash",
      "content": [
        {
          "type": "content",
          "content": {
            "type": "text",
            "text": "Requesting approval to Running: pwd"
          }
        }
      ]
    }
  }
}
```

The spike denied it with:

```json
{
  "outcome": {
    "outcome": "selected",
    "optionId": "reject"
  }
}
```

Kimi then sent `tool_call_update` with `status: "failed"` and text explaining the tool was not run because the request was rejected. The prompt still completed with `stopReason: "end_turn"`.

## Cancellation

The spike sent `session/cancel` as a notification while `session/prompt` was in flight:

```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": { "sessionId": "<sessionId>" }
}
```

Kimi returned the pending `session/prompt` response with:

```json
{ "stopReason": "cancelled" }
```

No final text update was observed after cancellation in this run.

## Session List, Load, And Resume

`session/list` worked with:

```json
{
  "cwd": "/Users/onion/workbench/carrent",
  "cursor": null
}
```

It returned `sessions` with `sessionId`, `cwd`, `title`, `updatedAt`, and `nextCursor`.

`session/load` worked with `sessionId`, `cwd`, and `mcpServers`. It returned `configOptions` and replayed partial history through `session/update` before the response:

- `user_message_chunk`
- `agent_thought_chunk`
- `tool_call`
- `tool_call_update`
- another `agent_thought_chunk`

The observed `session/load` replay did not include the final assistant `agent_message_chunk`.

`session/resume` worked with `sessionId`, `cwd`, and `mcpServers`. It returned `configOptions` and did not replay history in the observed run.

## Mapping To Carrent ChatRunEvents

Recommended first mapping for the Kimi ACP adapter:

| ACP input                                                                                      | Carrent event                                                          |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| adapter accepts a `ChatTurnRequest` and sends `session/prompt`                                 | `started`                                                              |
| `agent_message_chunk` text                                                                     | `delta`                                                                |
| `agent_thought_chunk` text                                                                     | `reasoning` with one stable reasoning id per run                       |
| `tool_call` / `tool_call_update` with `kind: "execute"` or title `Bash`                        | `shell`                                                                |
| `tool_call` / `tool_call_update` with read/search/edit/delete/move kinds                       | initially `reasoning`; issue 04 can add richer file activity UI/events |
| `session/request_permission`                                                                   | `permission-requested`                                                 |
| permission response sent back to Kimi                                                          | `permission-resolved`                                                  |
| `session/prompt` response `stopReason: "end_turn"`                                             | `completed`                                                            |
| `session/prompt` response `stopReason: "cancelled"`                                            | `stopped`                                                              |
| JSON-RPC error, process startup failure, protocol mismatch, or rejected required client method | `failed`                                                               |

Current shared types only allow permission provider values `codex`, `claude-code`, and `pi`; Kimi integration will need to extend that before emitting Kimi permission events.

## Ambiguous Or Not Yet Verified

- `authenticate` was not exercised because this machine was already logged in.
- Missing-login behavior and terminal auth flow still need a separate failure-path check.
- `fs/write_text_file` was not observed.
- `terminal/*` client methods were not observed because the spike advertised `terminal: false`.
- Kimi may emit newer ACP fields not present in older SDKs. The adapter should parse known fields and tolerate unknown fields.
- `available_commands_update` includes local Kimi commands and local skill inventory. Carrent V1 can ignore it unless command-palette support is explicitly needed.
- `session/load` replay behavior is not enough to reconstruct a complete Carrent transcript by itself, based on this run. Carrent should keep its own thread transcript and store Kimi's `sessionId` for continuation.
