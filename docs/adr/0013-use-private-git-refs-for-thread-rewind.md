# Use private Git refs for Thread Rewind

Carrent will persist each rewindable Run's before and after project trees under private `refs/carrent/rewind/*` refs. Private refs preserve complete Git objects across app restarts and Git GC without changing `HEAD`, branches, the index, or the worktree, and are removed when their owning Thread history is deleted.

## Consequences

Snapshots include tracked and non-ignored untracked project content, so Carrent must document that local recovery data may contain source or secrets and that deleting refs does not immediately erase Git objects. Normal push refspecs do not publish these refs, but mirror pushes and full repository backups may include them. Snapshot and restore code must enforce storage limits, use opaque validated ref names, verify expected object IDs, stay within the project path, and avoid repository hooks, filters, and shell evaluation. When the project limit is reached, Carrent removes the oldest recovery refs, exposes those points as Rewind Barriers, and keeps recording recent Runs.
