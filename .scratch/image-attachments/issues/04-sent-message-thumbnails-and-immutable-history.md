# Sent-message thumbnails and immutable history

Status: ready-for-agent

## Parent

.scratch/image-attachments/PRD.md

## What to build

Make sent Image Attachments feel like part of the user message history. Sent messages display thumbnails near the message text, matching the confirmed sent-message visual direction. The message body remains clean and never shows raw app data paths. Sent attachments can be viewed but cannot be removed from historical messages, so the UI remains consistent with what the Coding Agent received.

## Acceptance criteria

- [x] Sent user messages render attached image thumbnails near the text as one message group.
- [x] Sent message text remains the user's original visible text.
- [x] Raw local paths are not displayed in normal message history.
- [x] Sent attachments have no delete/remove control in history.
- [x] Rehydrated messages with attachment metadata render thumbnails after workspace load.
- [x] Missing image files fail gracefully in the UI without corrupting the message.
- [x] Tests cover visible history rendering, no raw path display, immutable sent attachments, and rehydrated attachment metadata.

## Blocked by

- .scratch/image-attachments/issues/01-single-image-attachment-tracer-bullet.md
