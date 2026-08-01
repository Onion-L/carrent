# 02 — Synchronize shared application data and Settings

**What to build:** Move Workspace, Project, Workspace-Project Association, Thread metadata, and Settings changes onto the authoritative command path so every Renderer client presents the same durable Carrent data without sharing its route or selection.

**Blocked by:** 01 — Establish Main Process App State authority.

**Status:** done

- [ ] Creating, renaming, reordering, associating, relocating, archiving, restoring, and removing shared Carrent objects uses serialized application commands and broadcasts the accepted result.
- [ ] A change observed in one Renderer client appears in every other subscribed client without reload or polling.
- [ ] Theme, font size, Runtime preferences, terminal preferences, and other Settings persist through the Main Process and update every Renderer client.
- [ ] A Carrent Window derives its active Workspace, Project, Thread, and Settings selection from its own route instead of changing another window's selection.
- [ ] Each Renderer keeps independent browsing history and transient presentation state while shared data updates underneath it.
- [ ] Removing or relocating a shared object makes every affected Renderer resolve its own route through the established nearest-valid-parent fallback.
- [ ] An older Renderer cannot overwrite a newer rename, recreate a removed object, or restore stale Settings through a full-snapshot save.
- [ ] Two-client Renderer tests cover independent routes plus synchronized Workspace, Project, Association, Thread metadata, archive, deletion, relocation, and Settings behavior.


## Comments

- 2026-08-01: Implemented in commits 948fff0 (command vocabulary: `appStateCommands.ts` reducers for workspaces/projects/associations/thread metadata/selection/settings; settings added as optional snapshot field) and 062e45e (renderer cutover: AppStateContext mutations + SettingsContext on commands and broadcasts, one-time localStorage migration, two-client renderer sync tests). Full suite 1233 tests green; typecheck/lint clean.
