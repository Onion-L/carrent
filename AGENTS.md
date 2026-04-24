# Repository Guidelines

## Project Structure & Module Organization

This repo is a Bun workspace managed with Turbo.

- `apps/desktop`: Electron desktop app built with `electron-vite`. Renderer code lives in `src/renderer`, Electron main/preload/runtime code in `electron`, and app assets in `build/`.
- `apps/landing`: Astro marketing site. Pages are in `src/pages`, layouts in `src/layouts`, and styles in `src/styles`.
- `packages/ui`: Shared React UI components and CSS tokens exported to both apps.
- `docs`: product and architecture notes for larger UX or runtime changes.

## Build, Test, and Development Commands

Install dependencies with `bun install`.

- `bun run dev`: run all workspace dev tasks through Turbo.
- `bun run dev:desktop`: start the Electron app only.
- `bun run dev:web`: start the Astro site only.
- `bun run build`: build all packages/apps.
- `bun run lint`: run `oxlint` across the repo.
- `bun run typecheck`: run workspace type checks.
- `bun run format`: format the repo with `oxfmt`.
- `cd apps/desktop && bun test electron/runtime`: run Bun tests for runtime modules.

## Coding Style & Naming Conventions

Use TypeScript and ES modules. Let `oxfmt` handle formatting.

- React components: `PascalCase` files, e.g. `RuntimesPage.tsx`.
- Hooks: `useXxx.ts`, e.g. `useRuntimes.ts`.
- Tests: mirror the source file name with `.test.ts`.
- Keep solutions simple and local; prefer extending an existing module over adding new abstractions.
- Follow existing Tailwind patterns and keep reused types in `src/shared`.

## Testing Guidelines

Current automated tests are concentrated in `apps/desktop/electron/runtime` and use `bun:test`.

- Add or update tests when touching runtime detection, IPC, or process execution.
- Name tests after behavior, not implementation details.
- Before opening a PR, run `bun run lint`, `bun run typecheck`, and targeted Bun tests for changed runtime files.

## Commit & Pull Request Guidelines

Recent history favors short imperative commits, usually Conventional Commit style: `feat(desktop): ...`, `fix: ...`.

- Prefer `feat`, `fix`, `refactor`, or `docs`, with scope when helpful.
- Keep commits focused; avoid mixing landing, desktop, and shared UI changes unless tightly coupled.
- PRs should explain the user-visible change, list validation commands, link the issue if any, and include screenshots for desktop or landing UI changes.

## Configuration Notes

Do not commit secrets, local paths, or generated release artifacts. Runtime-related code calls local CLIs; keep defaults generic and document new environment assumptions in `docs/`.
