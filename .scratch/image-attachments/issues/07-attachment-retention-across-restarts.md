# Attachment retention across restarts

Status: ready-for-agent

## Parent

.scratch/image-attachments/PRD.md

## What to build

Verify that Carrent-managed Image Attachments remain viewable across app restarts while avoiding automatic cleanup. Attachment files are retained while their messages remain in history. Workspace state remains small by storing metadata only. This slice should make the restart and retention behavior explicit and tested, without introducing deletion or garbage collection.

## Acceptance criteria

- [x] After workspace reload, messages with Image Attachment metadata still render thumbnails.
- [x] Stored attachment files remain available while messages remain in history.
- [x] Workspace state still stores metadata only and does not embed base64 image data.
- [x] No automatic expiry or cleanup deletes Image Attachments.
- [x] Missing attachment files are handled gracefully without breaking workspace load.
- [x] Tests cover workspace reload, retained attachment previews, metadata-only persistence, and missing-file resilience.

## Blocked by

- .scratch/image-attachments/issues/01-single-image-attachment-tracer-bullet.md
- .scratch/image-attachments/issues/04-sent-message-thumbnails-and-immutable-history.md
