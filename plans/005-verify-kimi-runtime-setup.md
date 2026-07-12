# Plan 005: Make Kimi Runtime Setup verify the ACP path before reporting Ready

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When done, update
> this plan's row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `git diff --stat da57cb3..HEAD -- apps/desktop/src/renderer/routes/SettingsPage.tsx apps/desktop/src/renderer/routes/SettingsPage.test.ts apps/desktop/src/renderer/hooks/useRuntimeModels.ts apps/desktop/src/renderer/lib/runtimeModelsCache.ts apps/desktop/electron/runtime/runtimeModelLister.ts apps/desktop/src/shared/runtimes.ts`
> If either in-scope file changed, compare the Current state excerpts with the
> live code. Also confirm the read-only dependency files still expose the APIs
> described below. A semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `da57cb3`, 2026-07-11

## Why this matters

Carrent currently calls Kimi Code `Ready` as soon as the `kimi` command exists,
a Kimi configuration directory exists, and the runtime is enabled. Those facts
do not prove that `kimi acp` starts, the runtime-owned sign-in is valid, or Kimi
returns the model configuration the composer depends on. Carrent already has a
read-only ACP model-list operation that verifies `initialize` and `session/new`;
the active Runtime Settings page should use that runtime-owned result to finish
Runtime Setup and provide a concrete recovery action before the user sends a
message.

## Current state

- `apps/desktop/src/renderer/App.tsx:34-35` redirects `/runtimes` to
  `/settings?tab=runtime`. The active UI is `SettingsPage.tsx`; the standalone
  `routes/RuntimesPage.tsx` is not mounted and must not be reconnected by this
  plan.
- `apps/desktop/src/renderer/routes/SettingsPage.tsx:221-327` renders
  `RuntimeStatusPanel`. It currently derives readiness only from enabled
  detection records:

```ts
const enabledCount = sortedRuntimes.filter((runtime) => runtime.enabled).length;
// ...
<span>{enabledCount > 0 ? `${enabledCount} ready` : "No ready runtimes"}</span>
```

- `SettingsPage.tsx:330-343` hides setup as soon as command detection and a
  configuration marker pass:

```ts
export function shouldShowKimiSetup(runtime) {
  return (
    runtime.id === "kimi" &&
    (runtime.availability !== "detected" || runtime.configuration !== "configured")
  );
}

function getRuntimeStatusLabel(runtime: RuntimeRecord) {
  if (shouldShowKimiSetup(runtime)) return "Setup required";
  if (runtime.enabled) return "Ready";
  // ...
}
```

- `SettingsPage.tsx:361-501` already provides install/sign-in instructions,
  command copying, refresh, docs, and expandable error details. Extend this
  component instead of creating a second setup surface.
- `SettingsPage.tsx:507-524` currently has three setup steps: install the CLI,
  add it to `PATH`, and finish Kimi sign-in. It has no ACP connection step.
- `apps/desktop/electron/runtime/runtimeModelLister.ts:77-205` already performs
  the safe connection check needed here. For Kimi it starts `kimi acp`, sends
  `initialize`, sends `session/new` with no MCP servers, reads the runtime-owned
  model config, closes the transport, and returns one of:
  `listed`, `unsupported`, or `failed`. Do not add another ACP implementation.
- `apps/desktop/src/renderer/hooks/useRuntimeModels.ts:6-32` exposes the shared
  model result, models, loading/error state, and force-refresh function.
  `RuntimeModelsProvider` already wraps the settings route.
- `apps/desktop/src/renderer/lib/runtimeModelsCache.ts:68-97` preserves stale
  model data when a refresh fails but sets `errorById`. A new connection failure
  must therefore take precedence over an older successful result when deriving
  the displayed setup state.
- `apps/desktop/src/renderer/components/chat/Composer.tsx:687-706` is the
  established caller pattern for `useRuntimeModels`. Match this shared-store
  pattern; do not call `window.carrent.runtimes.listModels` directly from
  Settings.
- `apps/desktop/CONTEXT.md:19-21` defines **Runtime Setup** as the user-facing
  flow that makes an external runtime usable, including command availability
  and runtime-owned sign-in/configuration. Use this term; do not label the
  feature Diagnostics or Onboarding.
- `PRODUCT.md:25-29` requires runtime-owned truth, visible active choices, and
  clear execution state. Keep the UI compact and use the existing settings
  styles, status colors, buttons, and typography.
- ADR 0001 keeps Kimi Code as the V1 Primary Runtime. ADR 0002 requires ACP over
  stdio. Do not broaden this work to Codex, Claude Code, pi, direct provider
  APIs, or a Carrent-owned agent loop.

## Commands you will need

| Purpose                   | Command                                                                                                                   | Expected on success          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Focused renderer tests    | `bun test apps/desktop/src/renderer/routes/SettingsPage.test.ts apps/desktop/src/renderer/lib/runtimeModelsCache.test.ts` | all selected tests pass      |
| Existing runtime contract | `bun test apps/desktop/electron/runtime/runtimeModelLister.test.ts apps/desktop/electron/runtime/runtimeIpc.test.ts`      | all selected tests pass      |
| Full tests                | `bun test`                                                                                                                | all tests pass               |
| Typecheck                 | `bun run typecheck`                                                                                                       | exit 0, no errors            |
| Lint                      | `bun run lint`                                                                                                            | exit 0, no findings          |
| Build                     | `bun run build`                                                                                                           | exit 0 for every workspace   |
| Diff hygiene              | `git diff --check`                                                                                                        | exit 0, no whitespace errors |

## Scope

**In scope**:

- `apps/desktop/src/renderer/routes/SettingsPage.tsx`
- `apps/desktop/src/renderer/routes/SettingsPage.test.ts`

**Out of scope**:

- `apps/desktop/src/renderer/routes/RuntimesPage.tsx` — it is not routed; do not
  reconnect, update, or delete it in this plan.
- `apps/desktop/electron/runtime/runtimeModelLister.ts` and its tests — the ACP
  verification contract already exists; this plan consumes it.
- `apps/desktop/src/renderer/lib/runtimeModelsCache.ts` — retain the shared
  24-hour cache and stale-result behavior.
- Composer model selection, chat sending, Kimi session persistence, and
  permission modes.
- Starting a real model prompt, consuming tokens, or adding model ping support
  for Kimi. The existing ACP handshake/session creation is the verification.
- Running install or sign-in commands inside Carrent. Keep the current copy and
  documentation actions.
- Reading or storing API keys, tokens, provider credentials, or Provider
  Profiles.
- Making any non-Kimi Runtime first-class in V1.

## Git workflow

- Branch: `codex/plan-005-kimi-runtime-setup`
- Suggested commit: `feat(desktop): verify Kimi runtime setup`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define one pure Kimi Runtime Setup state resolver

In `SettingsPage.tsx`, add an exported pure resolver used by both rendering and
tests. Keep it local to the route; do not add a new module for one caller. It
must accept the minimal Kimi `RuntimeRecord` fields plus the existing
`RuntimeModelListResult | null`, model loading state, and model error.

Use an explicit union with these semantic states (names may vary only if the
meaning remains exact):

- `install-required`: the Kimi command is unavailable;
- `sign-in-required`: the command exists but runtime configuration is not
  configured;
- `checking`: the ACP/model request is in flight and there is no usable result;
- `unchecked`: command and configuration are present, but no ACP result exists;
- `ready`: the latest check returned `listed` with at least one model and no
  newer error exists;
- `incompatible`: ACP connected but returned `unsupported`, or returned
  `listed` with zero models;
- `connection-failed`: the hook exposes an error or the result state is
  `failed`.

Precedence is load-bearing:

1. Missing command and missing configuration win before ACP state.
2. A current model error wins over a stale `listed` result retained by the
   cache.
3. A stale ready result may remain visible while a force refresh is loading,
   but the refresh button must show its pending state.

Extend `getKimiSetupSteps` so it can mark a fourth step such as
`Connect through Kimi ACP`. That step is complete only in `ready`; installation
and sign-in steps continue to derive from the runtime detection record.

Add unit tests in `SettingsPage.test.ts` for every state above, including:

- error plus stale listed result resolves to `connection-failed`;
- listed with an empty model array resolves to `incompatible`;
- ready remains ready while a background/force refresh is loading;
- the ACP setup step is complete only for ready.

**Verify**:
`bun test apps/desktop/src/renderer/routes/SettingsPage.test.ts`
-> all tests pass, including at least the seven resolver cases and the expanded
setup-step assertions.

### Step 2: Consume the shared Kimi model store from the active settings page

In `RuntimeStatusPanel`, identify the Kimi record first. Pass `"kimi"` to
`useRuntimeModels` only when the command is detected and configuration is
configured; pass `null` otherwise. This avoids spawning `kimi acp` when the CLI
is absent or sign-in/configuration is clearly incomplete.

Use the returned `result`, `models`, `defaultModelId`, `loading`, `error`, and
`refresh`. Derive the setup state only through the Step 1 resolver. The initial
`ensureFresh` call may use the shared 24-hour cache; add a `Check connection`
or `Check again` action that calls `refresh("kimi")` to bypass the TTL.

Do not make the existing top-level `Refresh` button silently perform an ACP
check. Keep its current meaning as command/configuration re-detection; the ACP
check action must be explicit so users understand that Carrent is starting the
local Runtime briefly.

Update the Kimi card to cover all states:

- install/sign-in states retain the current command, Copy, Refresh, Docs, and
  details behavior;
- checking has a stable progress label and disables duplicate connection
  checks;
- ready shows the installed version, number of runtime-owned models, the
  runtime-owned default model name when available, and `Check again`;
- incompatible explains that Kimi ACP did not expose a usable model option and
  offers Docs plus `Check again`;
- connection-failed shows a concise action message, `Check again`, the existing
  `kimi` sign-in command when appropriate, Docs, and the bounded error under
  the existing Details pattern;
- unchecked offers `Check connection` and must not claim Ready.

Never display raw ACP payloads, environment variables, credential locations,
or secret values. Reuse existing Tailwind tokens and Lucide icons; do not add a
new card nested inside the Runtime card.

**Verify**:
`bun test apps/desktop/src/renderer/routes/SettingsPage.test.ts apps/desktop/src/renderer/lib/runtimeModelsCache.test.ts && bun run typecheck`
-> all selected tests pass and typecheck exits 0.

### Step 3: Make every Ready label depend on verified ACP setup

Replace `enabledCount`-based readiness in `RuntimeStatusPanel` with a count that
requires both:

- the Kimi runtime is enabled; and
- the derived Runtime Setup state is `ready`.

Update `getRuntimeStatusLabel`, its badge class, and its status dot inputs so
they use the derived Kimi setup state. Required user-visible meanings:

- `Ready`: enabled and ACP/model verification succeeded;
- `Disabled`: verification succeeded but the user disabled the runtime;
- `Checking`: verification is in progress with no prior success;
- `Setup required`: install, sign-in, incompatible, unchecked, or failed;
- `Unavailable`: reserved for the missing command state if the surrounding UI
  needs to distinguish it from other setup work.

Add pure-helper tests for the label/count behavior. In particular, a detected,
configured, enabled runtime with no ACP result or a failed ACP result must not
contribute to the ready count.

Do not change `RuntimeRecord.enabled` or `resolveRuntimeEnabled`; readiness here
is a Settings presentation decision, not a new persisted runtime flag.

**Verify**:
`bun test apps/desktop/src/renderer/routes/SettingsPage.test.ts`
-> all tests pass, including false-ready regression cases.

### Step 4: Run repository gates

Run the existing backend model-list tests even though their files are out of
scope; they prove the UI still relies on the established no-prompt ACP path.
Do not update snapshots or loosen assertions to pass unrelated failures.

**Verify**:
`bun test apps/desktop/electron/runtime/runtimeModelLister.test.ts apps/desktop/electron/runtime/runtimeIpc.test.ts && bun run lint && bun run typecheck && bun test && bun run build && git diff --check`
-> every command exits 0.

## Test plan

- Extend `SettingsPage.test.ts`; follow its existing exported-pure-helper
  pattern rather than introducing a renderer or Electron test harness.
- Cover all seven setup states, error-over-stale-result precedence, the fourth
  ACP step, Ready/Disabled/Checking/Setup required labels, and ready-count
  behavior.
- Keep `runtimeModelsCache.test.ts` unchanged and passing; it is the contract
  for shared caching, force refresh, and stale-data preservation.
- Keep `runtimeModelLister.test.ts` unchanged and passing; it is the contract
  that Kimi verification sends only `initialize` and `session/new`, returns
  runtime-owned models, closes its transport, and handles failure without a
  real Kimi process.
- Do not launch a real Kimi process, access the network, or use real credentials
  in automated tests.

## Done criteria

- [ ] A detected/configured/enabled Kimi Runtime is not labeled Ready until the
      ACP model-list check succeeds with at least one model.
- [ ] Missing CLI and missing configuration do not start an ACP model request.
- [ ] The Runtime Setup surface shows install, PATH, sign-in, and ACP connection
      progress in one existing Kimi card.
- [ ] Users can force `Check connection` / `Check again` without waiting for the
      24-hour cache TTL.
- [ ] A failed refresh overrides stale success in the displayed setup state.
- [ ] Ready UI shows runtime-owned model count and default model when available.
- [ ] Failure and incompatible states provide a clear next action without
      exposing credentials or raw protocol payloads.
- [ ] `/runtimes` still redirects to the active Runtime Settings tab, and
      `RuntimesPage.tsx` is untouched.
- [ ] `bun run lint`, `bun run typecheck`, `bun test`, `bun run build`, and
      `git diff --check` exit 0.
- [ ] Only the two in-scope source/test files and `plans/README.md` are modified.

## STOP conditions

Stop and report if:

- `runtimes:list-models` no longer verifies Kimi via ACP `initialize` and
  `session/new`, or it sends a model prompt/uses paid tokens.
- The active `/settings?tab=runtime` route no longer renders `SettingsPage` or
  the standalone `RuntimesPage` has become live.
- A reliable connection check requires changing preload, IPC, shared result
  types, or Electron runtime code; that is outside this plan and needs a revised
  scope.
- Kimi can connect successfully without exposing model options and the current
  composer supports that state. In that case, `unsupported` cannot safely mean
  incompatible; stop and request a product decision.
- The only way to verify sign-in requires Carrent to read or store provider
  credentials, or to run a real model prompt.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Reviewers should verify every Ready label comes from one derived setup state;
  duplicating readiness conditions will drift as Kimi ACP changes.
- The model list is runtime-owned truth but cached for 24 hours. Future changes
  to that TTL or cache persistence should preserve the explicit force-refresh
  action in Settings.
- If Kimi later exposes a dedicated, documented health/capability method, it may
  replace model listing as the connection check. Keep the UI resolver contract
  and swap the backend signal rather than adding another parallel setup flow.
- Provider Profile management, plan mode, automatic command execution, other
  first-class Runtimes, and deletion of the dead `RuntimesPage` are explicit
  follow-ups, not part of this plan.
