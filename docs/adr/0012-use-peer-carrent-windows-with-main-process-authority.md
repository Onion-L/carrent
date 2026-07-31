# Use peer Carrent Windows with Main Process authority

Carrent supports multiple peer top-level windows rather than one Main Window with restricted auxiliary windows. Every Carrent Window has complete navigation and independent presentation state, while Workspace, Project, Thread, Composer, Run, Settings, and Terminal data remain shared application objects. The Main Process is authoritative for shared state and serializes commands from all Renderers because independent Renderer-owned snapshots can overwrite newer changes, duplicate Run controls, and diverge while showing the same Thread.

## Considered Options

- **Peer Carrent Windows with Main Process authority**: Chosen because every window behaves consistently and all windows can safely present and control the same Thread, Run, or Terminal Tab.
- **One Main Window with auxiliary windows**: Rejected because it creates two navigation and capability models and makes window behavior depend on which window was created first.
- **Independent Renderer-owned snapshots**: Rejected because last-writer-wins persistence can lose concurrent edits or recreate removed objects.
- **Allow multiple windows but restrict a Thread to one window**: Rejected because users require the same Thread, including messages and controls, to remain live in multiple windows.

## Consequences

Window routes, history, bounds, and transient presentation state remain window-owned. Shared mutations must use idempotent application commands and revisioned broadcasts instead of competing full-snapshot writes. Runs and Terminal Tabs survive individual window closure, and Terminal resize authority follows the focused terminal viewport.
