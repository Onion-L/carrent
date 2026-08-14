# Read Kimi session telemetry outside ACP

Carrent reads Kimi context and coding-plan telemetry from sources that are not exposed by ACP. The agent loop, Runtime Session lifecycle, prompts, commands, approvals, and streamed activity remain integrated through `kimi acp`; this exception is limited to status telemetry.

## Data Sources

- Context usage comes from the local Kimi Code session index and `wire.jsonl` files under `KIMI_CODE_HOME` or `~/.kimi-code`. Carrent tail-reads the latest usage records and may read `config.toml` or the models.dev catalog to resolve a context limit.
- Coding-plan usage comes from `https://api.kimi.com/coding/v1/usages` using the OAuth credentials stored by Kimi Code.
- When the access token is expired or has no usable expiry, Carrent uses Kimi Code's refresh token with `https://auth.kimi.com/api/oauth/token`, preserves unknown credential fields, writes rotated credentials atomically, and avoids automatic retries after an authorization rejection.

## Consequences

These sources are Kimi-specific and may change independently of ACP, so parsing and payload mapping stay isolated in `kimiContextUsage.ts` and `kimiPlanUsage.ts` with fixture coverage. Status failures do not affect Runs, tokens never enter a Renderer, network calls are cached, and unknown context limits are omitted rather than guessed. Settings Usage analytics remain separate from Runtime Session quota telemetry.
