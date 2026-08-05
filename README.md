# Carrent

Carrent is a desktop GUI for project-scoped coding agents. It brings agent
threads, runtime controls, approvals, terminal sessions, and project context
together in one workspace.

> Carrent is currently under active development. Features and APIs may change.

## Development

Requires [Bun](https://bun.sh/).

```bash
bun install
bun run dev:desktop
```

Useful commands:

```bash
bun run dev:web    # Run the landing site
bun run build      # Build all packages and apps
bun run lint       # Lint the workspace
bun run typecheck  # Type-check the workspace
bun test           # Run tests
```

## Repository Structure

- `apps/desktop` - Electron desktop app
- `apps/landing` - Astro landing site
- `packages/ui` - Shared UI components and styles
