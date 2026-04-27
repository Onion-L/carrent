# Provider Approval Protocol Spike

**Date:** 2026-04-27
**Environment:** macOS, codex-cli 0.125.0, claude-code 2.1.77

## Goal

Determine if Codex and Claude Code CLI tools support interactive stdin-based approve/deny for permission requests during non-interactive (exec/print) mode.

---

## Codex Findings

### Version
```
codex-cli 0.125.0
```

### Command Examined
```bash
codex exec --json --sandbox workspace-write --skip-git-repo-check -c 'approval_policy="on-request"' '<prompt>'
```

### Observations

1. **`--json` flag** emits structured JSONL events to stdout. Available events include:
   - `thread.started`
   - `turn.started`
   - `turn.completed`
   - `item.started` / `item.completed` (command_execution, agent_message)
   - No `permission_request` event type observed

2. **`approval_policy="on-request"` does NOT pause for stdin approval**
   - In `workspace-write` sandbox mode, commands execute immediately without waiting for approval
   - The config flag controls whether the model *asks* for approval, not whether the CLI *waits* for it
   - There is no stdin response channel in `codex exec` mode

3. **stdin is not available**
   - The current `processRunner.ts` implementation calls `childProcess.stdin?.end()` immediately
   - Even if stdin were left open, Codex `exec` does not read approval decisions from it

4. **`--ask-for-approval` flag** exists on the main `codex` command (not `codex exec`), but it is for interactive TUI mode.

### Conclusion

**Codex approval support: not supported in current CLI exec mode; implement safe fallback.**

---

## Claude Findings

### Version
```
2.1.77 (Claude Code)
```

### Command Examined
```bash
claude --print --input-format stream-json --output-format stream-json --verbose --permission-mode default '<prompt>'
```

### Observations

1. **`--input-format stream-json --output-format stream-json`** enables bidirectional JSON streaming.

2. **Permission requests are emitted as `tool_result` events:**
   ```json
   {
     "type": "user",
     "message": {
       "role": "user",
       "content": [{
         "type": "tool_result",
         "is_error": true,
         "tool_use_id": "call_8ab2766d77504df3a31e5a1d",
         "content": "Claude requested permissions to write to /tmp/demo.txt, but you haven't granted it yet."
       }]
     }
   }
   ```

3. **When permission is needed, Claude uses `AskUserQuestion` tool:**
   ```json
   {
     "type": "assistant",
     "message": {
       "content": [{
         "type": "tool_use",
         "name": "AskUserQuestion",
         "input": {
           "questions": [{
             "question": "Allow writing to demo.txt?",
             "options": [{"label": "Allow"}, {"label": "Deny"}]
           }]
         }
       }]
     }
   }
   ```
   This tool only works in interactive TUI mode - it fails in `--print` mode.

4. **Final result includes `permission_denials` array** listing all denied tool calls.

5. **No stdin response channel found** for sending approve/deny decisions. The `--input-format stream-json` accepts user messages but does not accept permission decisions in a format that Claude understands as approvals.

6. **The `permissionMode` options are:**
   - `default` - asks for permission (only works interactively)
   - `acceptEdits` - auto-accepts edits
   - `bypassPermissions` / `--dangerously-skip-permissions` - skips all permission checks
   - `dontAsk` - don't ask (but still enforces permissions)
   - `plan` - plan only mode
   - `auto` - auto mode

### Conclusion

**Claude approval support: not supported in current CLI print mode; implement safe fallback.**

---

## Summary Table

| Provider | Support Level | Channel | Notes |
|----------|-------------|---------|-------|
| Codex | Not supported | N/A | exec mode has no interactive approval protocol |
| Claude | Not supported | N/A | --print mode does not accept permission responses via stdin |

---

## Safe Fallback Implementation Path

Since neither provider supports interactive stdin-based approval in their current CLI modes:

1. **For `approval-required` mode:**
   - If provider emits a permission request (detected via tool_result error content for Claude, or no equivalent for Codex), emit `failed` event with message:
     > "Interactive approvals are not supported for [provider] in the current CLI mode. Switch runtime mode to Auto-accept edits or Full access."

2. **Do NOT show fake approve/deny UI buttons** - that would be lying to the user.

3. **Keep `RuntimeMode` as the coarse safety control**, as designed in Phase 1.

4. **Future investigation:**
   - Claude Code interactive TUI mode (not `--print`) might support a different protocol
   - Codex interactive mode might have a different protocol
   - Both providers may add exec-server or SDK-based approval channels in the future

---

## Next Steps

1. Implement only the safe fallback path (no approve/deny UI for permission requests)
2. Continue with Tasks 2-5 (shared types, IPC, provider protocol adapters for detection)
3. UI work (Task 8) should focus on showing the "unsupported" error state when a permission request is detected in approval-required mode
