# Plan 002: Keep Local MCP credentials private and bound request memory

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When done, update
> this plan's row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `git diff --stat eb5b839..HEAD -- apps/desktop/electron/bridge/carrentBridge.ts apps/desktop/electron/bridge/carrentBridge.test.ts apps/desktop/electron/bridge/carrentBridgeManager.ts apps/desktop/electron/bridge/carrentBridgeManager.test.ts apps/desktop/src/shared/mcpServer.ts apps/desktop/src/shared/mcpServer.test.ts apps/desktop/src/renderer/components/mcp/McpServerControl.tsx`
> If an in-scope file changed, compare the Current state excerpts with live
> code. A semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security, tests
- **Planned at**: commit `eb5b839`, 2026-07-11

## Why this matters

The long-lived Local MCP credential is currently included in the status URL
sent to the renderer and displayed in the app. It can therefore leak through a
screenshot, recording, renderer inspection, or renderer compromise. The same
HTTP server reads authenticated request bodies without a byte limit, allowing a
client with the credential to consume unbounded Electron main-process memory.

## Current state

- `apps/desktop/electron/bridge/carrentBridge.ts:140-150` builds the private MCP
  descriptor URL with a bearer credential in its query string. This descriptor
  is required by the ACP runtime and must remain main-process-only.
- `apps/desktop/electron/bridge/carrentBridgeManager.ts:88-94` copies the full
  descriptor URL into `McpServerStatus`:

```ts
return {
  enabled,
  running: !!handle,
  ...(handle ? { url: handle.mcpServer.url } : {}),
};
```

- `apps/desktop/src/renderer/components/mcp/McpServerControl.tsx:102-106`
  renders `status.url`, including the credential.
- `apps/desktop/electron/bridge/carrentBridge.ts:428-433` accumulates every body
  chunk and calls `Buffer.concat` without checking `Content-Length` or streamed
  byte count.
- The server intentionally listens on `127.0.0.1` and validates the credential
  before parsing the body. Preserve those properties.
- Bridge tests use a real ephemeral loopback server and fake skill catalog.
  Match `carrentBridge.test.ts` rather than introducing browser tests.
- Preserve the unrelated user change in
  `apps/desktop/src/renderer/lib/runtimeModelsCache.ts`.

## Commands you will need

| Purpose       | Command                                                                           | Expected on success             |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------- |
| Focused tests | `bun test apps/desktop/electron/bridge apps/desktop/src/shared/mcpServer.test.ts` | all selected tests pass         |
| Full tests    | `bun test`                                                                        | all existing and new tests pass |
| Typecheck     | `bun run typecheck`                                                               | exit 0                          |
| Lint          | `bun run lint`                                                                    | exit 0, no findings             |

## Scope

**In scope**:

- `apps/desktop/electron/bridge/carrentBridge.ts`
- `apps/desktop/electron/bridge/carrentBridge.test.ts`
- `apps/desktop/electron/bridge/carrentBridgeManager.ts`
- `apps/desktop/electron/bridge/carrentBridgeManager.test.ts`
- `apps/desktop/src/shared/mcpServer.ts`
- `apps/desktop/src/shared/mcpServer.test.ts`
- `apps/desktop/src/renderer/components/mcp/McpServerControl.tsx`

**Out of scope**:

- Changing the credential generation algorithm or authentication semantics.
- Moving the credential into another renderer-visible field.
- Changing Kimi ACP's MCP descriptor format unless verified compatibility
  requires it.
- Adding remote network access; the listener must remain loopback-only.
- Limiting MCP response size or skill resource size.
- `apps/desktop/src/renderer/lib/runtimeModelsCache.ts`.

## Git workflow

- Branch: `codex/plan-002-harden-local-mcp`
- Suggested commit: `fix(desktop): harden the Local MCP boundary`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Remove private endpoint data from renderer status

Remove `url` from the `McpServerStatus` shared type and normalizer. Change the
bridge manager's `status()` to return only `enabled`, `running`, and an optional
error. Remove the renderer block that displays `status.url`.

Do not remove the URL from `CarrentBridgeHandle.mcpServer`; Kimi still needs the
private descriptor inside the main process. Do not replace the URL with a
masked credential string: the UI does not use the endpoint, so omitting it is
the smallest safe contract.

Update manager/shared tests so they assert no status object has a URL while the
runtime handle still has a usable authenticated descriptor.

**Verify**: `bun test apps/desktop/electron/bridge/carrentBridgeManager.test.ts apps/desktop/src/shared/mcpServer.test.ts`
-> all tests pass and status serialization contains no endpoint.

### Step 2: Enforce a one-megabyte request-body limit

Add an exported or module-local constant of `1 * 1024 * 1024` bytes. Reject a
request before allocation when a valid `Content-Length` exceeds the limit, and
also count actual streamed bytes so chunked or dishonest requests cannot bypass
the check. Keep only chunks up to the limit.

Return HTTP 413 for this transport-level failure. Use a small typed error or
equivalent explicit branch so oversize input does not become the current JSON-
RPC parse-error response with HTTP 200. Drain or safely terminate the incoming
request without retaining further chunks. Existing malformed JSON behavior and
JSON-RPC error codes must remain unchanged for bodies within the limit.

Add real-server tests for:

- valid small authenticated request still succeeds;
- `Content-Length` above the limit returns 413 without tool dispatch;
- chunked input that crosses the limit returns 413;
- exactly-at-limit input reaches normal JSON parsing rather than the size error.

Do not place any credential value in test names, failure output, or plan/index
files. Test fixtures may generate ephemeral credentials in memory.

**Verify**: `bun test apps/desktop/electron/bridge/carrentBridge.test.ts` -> all
bridge tests pass, including both oversize paths.

### Step 3: Run repository gates and inspect renderer-visible contracts

Run the full gates, then search for stale renderer URL use. The internal bridge
descriptor is expected to retain a URL; only `McpServerStatus` and renderer
usage must disappear.

**Verify**:

- `bun run lint && bun run typecheck && bun test` -> all exit 0.
- `rg -n "status\.url|McpServerStatus.*url" apps/desktop/src apps/desktop/electron/bridge` -> no matches.

## Test plan

- Extend `carrentBridge.test.ts` using its existing loopback-server harness.
- Extend `carrentBridgeManager.test.ts` to distinguish private runtime handle
  data from public UI status.
- Extend `mcpServer.test.ts` for normalizing legacy input that still contains a
  URL: the normalizer must discard it rather than pass it through.
- No real skills, user files, Kimi process, or external network are needed.

## Done criteria

- [ ] Renderer and shared status objects never contain the Local MCP endpoint or
      credential.
- [ ] Kimi's main-process runtime handle still receives its authenticated MCP
      descriptor.
- [ ] Both declared-length and streamed oversize requests return HTTP 413.
- [ ] Requests at or below one megabyte retain existing JSON-RPC behavior.
- [ ] `bun run lint`, `bun run typecheck`, and `bun test` exit 0.
- [ ] Only in-scope files and `plans/README.md` changed; the pre-existing
      `runtimeModelsCache.ts` diff is unchanged.

## STOP conditions

Stop and report if:

- A current renderer feature genuinely consumes `status.url`; identify it and
  request a product decision rather than exposing a masked credential.
- Kimi requires the credential in a renderer-mediated flow rather than the
  main-process descriptor.
- Node's HTTP behavior prevents a deterministic 413 for streamed input without
  closing the entire Local MCP server.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Any future endpoint-copy UI must expose a separately designed, non-secret
  endpoint or an explicit credential-reveal flow; never reuse status state.
- Keep limits on decoded request bytes, not JavaScript string length.
- Reviewers should inspect error paths for unhandled stream rejections and make
  sure normal MCP clients are not disconnected after one rejected request.
