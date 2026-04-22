# Carrent Monorepo Implementation Spec

**Date:** 2026-04-22
**Project:** Carrent
**Goal:** Electron desktop app and Astro landing page share one UI system with the simplest workable monorepo setup.

## Overview

Carrent uses a Bun workspace monorepo with two apps:

- `apps/desktop`: Electron desktop app
- `apps/landing`: Astro landing page

Both apps consume a shared React UI package from `packages/ui`.

This spec is intentionally biased toward simple setup:

- one shared UI package
- no extra shared packages until needed
- no custom Electron window chrome
- no heavy global state layer at bootstrap

## Architecture

```text
carrent/
├── apps/
│   ├── landing/
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── layouts/
│   │   │   └── components/
│   │   ├── astro.config.mjs
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   └── desktop/
│       ├── electron/
│       │   ├── main.ts
│       │   └── preload.ts
│       ├── src/
│       │   ├── renderer/
│       │   │   ├── App.tsx
│       │   │   ├── routes/
│       │   │   └── main.tsx
│       │   └── styles/
│       ├── tailwind.config.ts
│       └── package.json
├── packages/
│   └── ui/
│       ├── src/
│       │   ├── components/
│       │   ├── styles/
│       │   │   ├── tokens.css
│       │   │   └── globals.css
│       │   └── index.ts
│       └── package.json
├── package.json
├── turbo.json
└── tsconfig.base.json
```

## Package Boundaries

### `packages/ui`

Responsibility:

- shared presentational components
- shared design tokens
- shared base styles

Must not contain:

- app business logic
- network requests
- Electron APIs
- Astro page logic

### `apps/landing`

Responsibility:

- marketing pages
- SEO content
- React islands only where interaction is needed

Rules:

- prefer Astro templates first
- only use shared React components for reusable interactive UI
- do not turn the landing into a SPA

### `apps/desktop`

Responsibility:

- desktop application shell
- Electron main/preload process
- React renderer

Rules:

- `electron/main.ts` and `electron/preload.ts` do not import from `packages/ui`
- renderer imports `@carrent/ui`
- desktop-only logic stays inside `apps/desktop`

## Shared UI Package

### Package Name

- `@carrent/ui`

### Export Shape

`packages/ui/package.json`

- export component entry: `./src/index.ts`
- export styles entry: `./src/styles/globals.css`
- export tokens entry: `./src/styles/tokens.css`

Initial approach:

- keep `packages/ui` source-based
- let Astro and desktop bundlers compile workspace source directly
- skip separate UI build step in phase 1

This is simpler than introducing `tsup` or a dedicated package build immediately.

### Initial Component Scope

First batch only:

- `Button`
- `Input`
- `Textarea`
- `Select`
- `Card`
- `Dialog`
- `Badge`
- `Table`
- `EmptyState`
- `FormField`

Do not build speculative components before the apps need them.

### Styling Strategy

- TailwindCSS for layout and utility styling
- CSS variables for semantic tokens
- shared `globals.css` for reset, typography, and component-layer utilities

`tokens.css` should own semantic values such as:

- `--color-bg`
- `--color-fg`
- `--color-muted`
- `--color-border`
- `--color-brand`
- `--color-success`
- `--color-warning`
- `--color-danger`
- `--radius-sm`
- `--radius-md`
- `--radius-lg`
- `--font-sans`
- `--font-mono`

Keep spacing on Tailwind defaults unless a real design need appears.

## Tailwind Setup

Each app keeps its own `tailwind.config.ts`, but both configs must scan shared UI source:

- `../../packages/ui/src/**/*.{ts,tsx}`

Both apps should map semantic colors to CSS variables instead of hardcoded hex values.

Example direction:

```ts
colors: {
  bg: "rgb(var(--color-bg) / <alpha-value>)",
  fg: "rgb(var(--color-fg) / <alpha-value>)",
  brand: "rgb(var(--color-brand) / <alpha-value>)",
  border: "rgb(var(--color-border) / <alpha-value>)",
}
```

## App-Level Decisions

### Landing

- Astro handles routing by file system
- use `@astrojs/react` for islands
- import `@carrent/ui` styles once in the root layout
- favor static rendering unless a page clearly needs SSR

### Client

- use Electron with a React renderer
- keep native OS window frame
- use hash-based routing in renderer for simplicity
- preload exposes a minimal typed bridge

Recommended renderer stack:

- React
- `react-router-dom`
- TailwindCSS

Do not add Zustand, Redux, or TanStack Query at bootstrap unless there is a concrete state or fetching problem.

## TypeScript

Root `tsconfig.base.json` provides shared compiler settings.

Rules:

- strict mode on
- path aliases only when they reduce friction
- prefer package imports like `@carrent/ui` over deep relative imports

## Workspace and Scripts

### Root

Root `package.json` should define:

- `dev`: run all long-running app dev tasks through Turbo
- `build`: build all packages/apps
- `lint`
- `typecheck`
- `format`

### Landing

`apps/landing/package.json` should define:

- `dev`
- `build`
- `preview`

### Client

`apps/desktop/package.json` should define:

- `dev`
- `build`
- `dist`

`dist` is for packaged desktop artifacts. `build` is for app compilation only.

## Turbo Pipeline

Minimum pipeline:

- `dev`: no cache, persistent
- `build`: cacheable
- `lint`: cacheable
- `typecheck`: cacheable

Do not optimize the Turbo graph further in phase 1.

## Dependency Baseline

Required baseline:

- Bun
- Turbo
- TypeScript
- React 18+
- TailwindCSS 3+
- Astro 4+
- `@astrojs/react`
- Electron 28+

Client-side recommendation:

- `electron-vite`

It reduces bootstrap complexity versus wiring Electron + Vite manually.

## Data and State

Phase 1 rules:

- `apps/landing`: mostly static content, no shared desktop state
- `apps/desktop`: local state and React context only

Escalation rule:

- introduce a state library only after renderer state becomes difficult to manage across multiple routes or windows

## Testing

Minimum testing bar:

- component smoke tests for `packages/ui`
- one renderer app smoke test for `apps/desktop`
- one page render smoke test for `apps/landing`

Do not start with a large test matrix.

## Delivery Phases

### Phase 1: Workspace Bootstrap

- create Bun workspace
- add Turbo
- add shared TS config
- scaffold `apps/landing`, `apps/desktop`, `packages/ui`

Exit condition:

- root `bun install` succeeds
- `bun run dev` can start app dev processes

### Phase 2: Shared UI Foundation

- add tokens and globals
- implement first batch of base components
- wire Tailwind in both apps

Exit condition:

- one component is rendered successfully in both landing and desktop

### Phase 3: Landing Shell

- build base layout
- import shared styles
- create homepage using shared components where useful

Exit condition:

- landing page builds and renders correctly

### Phase 4: Client Shell

- create BrowserWindow bootstrap
- add preload bridge
- mount React renderer with hash routing
- render shared UI components in the renderer

Exit condition:

- desktop app launches locally and shows the renderer shell

### Phase 5: Verification

- run build for all workspaces
- verify style consistency between both apps
- verify no Electron-only code leaks into `packages/ui`

## Acceptance Criteria

- `apps/landing` and `apps/desktop` both consume `@carrent/ui`
- shared tokens are loaded in both apps
- at least one shared component renders identically in both apps
- desktop app keeps native window border
- landing remains Astro-first, not React-first
- no unnecessary shared packages beyond `packages/ui`

## Deferred Items

Not in initial scope:

- auth architecture
- backend API package
- shared data access layer
- i18n
- theming variants beyond one default theme
- multi-window Electron support
- component docs site
