# Use peer Carrent Windows with Main Process authority

Carrent supports multiple peer top-level windows rather than one Main Window with restricted auxiliary windows. Every Carrent Window has complete navigation and independent presentation state, while Workspace, Project, Thread, Composer, Run, Settings, and Terminal data remain shared application objects. The Main Process is authoritative for shared state and serializes commands from all Renderers because independent Renderer-owned snapshots can overwrite newer changes, duplicate Run controls, and diverge while showing the same Thread. Production App State and Runtime Session mappings are persisted through the Main Process's single SQLite Store and operation queue; Renderer processes never access SQLite directly.

## Considered Options

- **Peer Carrent Windows with Main Process authority**: Chosen because every window behaves consistently and all windows can safely present and control the same Thread, Run, or Terminal Tab.
- **One Main Window with auxiliary windows**: Rejected because it creates two navigation and capability models and makes window behavior depend on which window was created first.
- **Independent Renderer-owned snapshots**: Rejected because last-writer-wins persistence can lose concurrent edits or recreate removed objects.
- **Allow multiple windows but restrict a Thread to one window**: Rejected because users require the same Thread, including messages and controls, to remain live in multiple windows.

## Consequences

Window routes, history, bounds, and transient presentation state remain window-owned. Shared mutations use idempotent application commands with explicit SQLite row mappings. The Main Process advances the process-local revision and broadcasts only after the database transaction commits; a persistence failure leaves the revision, authoritative App State Snapshot, and subscribers unchanged. Recovery rereads, Full Reset, Permanent Thread Deletion, and Project Working Directory relocation publish through the same authority. Runs and Terminal Tabs survive individual window closure, and Terminal resize authority follows the focused terminal viewport.
