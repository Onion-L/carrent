# Carrent

Carrent is a desktop GUI for project-scoped coding agents. It brings agent
threads, runtime controls, approvals, terminal sessions, and project context
together in one workspace.

> Carrent is a hobby project under active development. Major changes may happen
> at any time, and features and APIs may change without notice. Thank you to
> everyone who has taken an interest in and supported the project.

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
