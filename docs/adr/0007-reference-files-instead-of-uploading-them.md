# Use Codex-style thread attachments for user-added files

Importing a single file through the Attach picker or pasting one from the clipboard creates a thread attachment that Carrent and Agent Core can read for that thread without a second approval. Single-file attachments are copied into Carrent's attachment store as snapshots so conversation history remains reproducible if the original file changes, moves, or disappears.

> **Superseded (drag-and-drop):** Dragging a non-image file or folder adds a structured, live Local Path Context instead of copying a snapshot. Carrent stores no bytes and never enumerates a referenced folder. Agent Core applies the current approval policy when it reads that path. Supported image files keep the existing Image Attachment flow.

> ADR-0010 remains authoritative for Attach-picker, clipboard-paste, and supported-image drag snapshot attachments; only non-image file and folder drag behavior is amended here.
