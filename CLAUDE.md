# CLAUDE.md

This file provides guidance to Claude (claude.ai/code) when working with code in this repository.

## What Is Carrent

Carrent is a local-first Electron desktop app that serves as an agent chat workspace for code projects. Users define agents (with a name, responsibility prompt, and default runtime), bind them to local CLI runtimes (Codex, Claude Code, pi), and chat within project-scoped threads. The app shells out to these CLI tools to execute agent turns — it does not call model APIs directly.

## Build & Dev Commands

Package manager is **Bun 1.3.11**. Monorepo orchestration via **Turborepo**.

| Command | What it does |
|---|---|
| `bun install` | Install all workspace dependencies |
| `bun run dev` | Run all workspace dev tasks (Turbo) |
| `bun run dev:desktop` | Start Electron app only (`electron-vite dev`) |
| `bun run dev:web` | Start Astro landing site only |
| `bun run build` | Build all packages/apps |
| `bun run lint` | Run `oxlint` across the repo |
| `bun run typecheck` | Typecheck all workspaces via Turbo |
| `bun run fmt` | Format with `oxfmt` |
| `bun test apps/desktop/electron apps/desktop/src` | Run all tests (matches CI) |
| `bun test apps/desktop/electron/runtime` | Run runtime module tests only |
| `bun test apps/desktop/electron/chat/chatRunner.test.ts` | Run a single test file |

Tests use `bun:test`. CI (`.github/workflows/ci.yml`) runs: test → typecheck → lint → build.

## Workspace Layout

Bun workspaces with three packages:

- **`apps/desktop`** (`@carrent/desktop`) — Electron app built with `electron-vite`. Main entry: `electron/main.ts`. Renderer: `src/renderer/`. Shared types: `src/shared/`.
- **`apps/landing`** (`@carrent/landing`) — Astro marketing site with Tailwind.
- **`packages/ui`** (`@carrent/ui`) — Shared React component library (Button, Card, Dialog, etc.) and CSS tokens. Consumed by both apps via `workspace:*`. No build step — exports raw TypeScript source.

## Architecture: Desktop App

### Electron Process Boundary

The app follows strict `contextIsolation` — no `nodeIntegration`. All main↔renderer communication goes through IPC channels defined in `electron/preload.ts`, which exposes a `window.carrent` API.

Three IPC domains are registered in `electron/main.ts`:
- **`registerRuntimeIpc`** — runtime detection, start/stop, version refresh, model ping
- **`registerChatIpc`** — chat send/stop/permission-response, streaming events via `chat:event`
- **`registerWorkspaceIpc`** — workspace snapshot load/save/remember

### Chat System (`electron/chat/`)

The chat system spawns CLI processes (codex, claude, pi) and streams their output back to the renderer:

- **`chatSessionManager.ts`** — Core orchestrator. Spawns child processes per chat turn, parses provider-specific streaming JSON (Claude stream-json, Codex JSON), emits typed `ChatRunEvent`s (delta, shell, reasoning, permission-requested, completed, failed). Handles Claude session resumption via `--resume` flag and falls back to fresh sessions on failure.
- **`chatRunner.ts`** — Simpler non-streaming runner (used for basic process execution).
- **`chatPrompt.ts`** — Builds the prompt string from request data (agent responsibility, transcript, message).
- **`providerPermissionProtocol.ts`** — Extracts Claude permission requests from stream; interactive approvals are not currently supported in `--print` mode.

### Runtime System (`electron/runtime/`)

- **`runtimeCatalog.ts`** — Static catalog of supported runtimes (codex, claude-code, pi) with version args, config markers, and verification settings.
- **`runtimeDetector.ts`** — Detects if CLI binaries exist locally (`which`/path resolution).
- **`runtimeVerifier.ts`** — Verifies runtimes via model ping.
- **`runtimeProcessManager.ts`** — Manages runtime process lifecycle (start/stop).
- **`processRunner.ts`** — Generic child process execution wrapper.

### Shared Types (`src/shared/`)

Types shared between main and renderer processes. Key files:
- **`chat.ts`** — `ChatTurnRequest`, `ChatRunEvent` discriminated union (started, delta, reasoning, shell, completed, failed, permission-requested, etc.)
- **`runtimes.ts`** — `RuntimeId`, `RuntimeRecord`, `RuntimeDescriptor`
- **`runtimeMode.ts`** — Three permission modes: `approval-required`, `auto-accept-edits`, `full-access`. Maps to provider-specific CLI flags.
- **`workspacePersistence.ts`** — `WorkspaceSnapshot` shape and normalization.

### Renderer (`src/renderer/`)

React 19 + React Router + Tailwind CSS 3.

Routes: `/` (Home), `/draft/:draftId`, `/thread/:projectId/:threadId`, `/chat/:threadId`, `/agents`, `/runtimes`, `/settings`.

Context providers wrap the app: `WorkspaceProvider` → `SettingsProvider` → `AgentProvider` → `DraftThreadProvider` → `ToastProvider`.

### Workspace Persistence (`electron/workspace/`)

- **`workspaceStore.ts`** — Reads/writes `workspace.json` and `provider-sessions.json` in Electron's `userData` directory. Uses atomic writes (write-to-tmp + rename). Corrupted files are renamed with `.corrupt-{timestamp}` suffix.
- **`workspaceIpc.ts`** — Exposes load/save/remember IPC handlers. Keeps a last-snapshot reference for saving on quit.

## Coding Conventions

- TypeScript + ES modules throughout. Formatting handled by `oxfmt`, linting by `oxlint`.
- React components: `PascalCase` files. Hooks: `useXxx.ts`. Tests: `*.test.ts` mirroring source.
- Reused types go in `src/shared/`. Prefer extending existing modules over new abstractions.
- Tailwind for styling; shared tokens in `packages/ui/src/styles/tokens.css`.
- Commits: Conventional Commits — `feat(desktop): ...`, `fix: ...`, `refactor: ...`, `docs: ...` with scope when helpful.

## Design Documents

`docs/` contains product and architecture notes. Key doc: `docs/2026-04-23-carrent-v1-chat-workspace-design.md` — the V1 PRD defining the core product model (Project, Agent, Runtime, Thread, Message, Run).
