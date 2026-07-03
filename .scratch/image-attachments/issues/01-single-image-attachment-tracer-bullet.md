# Single Image Attachment tracer bullet

Status: ready-for-agent

## Parent

.scratch/image-attachments/PRD.md

## What to build

Build the smallest complete Image Attachment path: a user selects one PNG image, sees it in the composer, sends it with text, and then sees the sent message with a thumbnail in history. Carrent must persist the image into its own app data attachment store, persist only metadata in workspace state, and pass the attachment through the chat turn request so the Runtime path can access it internally. The visible message must not show raw local paths.

## Acceptance criteria

- [x] A user can choose one PNG image and see a thumbnail in the composer before sending.
- [x] Sending a message with one image stores the image in Carrent-managed attachment storage, not in the user project.
- [x] Workspace persistence records attachment metadata only and does not embed base64 image data.
- [x] The sent user message shows the original text and the image thumbnail.
- [x] The sent user message does not display Carrent-managed raw paths.
- [x] The runtime request receives the Image Attachment metadata and stable local reference internally.
- [x] Tests cover the successful one-image path through storage, workspace persistence, visible history, and runtime request shape.

## Blocked by

None - can start immediately
