# Image-only and runtime prompt behavior

Status: ready-for-agent

## Parent

.scratch/image-attachments/PRD.md

## What to build

Support sending Image Attachments even when the user does not type visible text, and separate visible history from Runtime prompt construction. Image-only messages are allowed. Runtimes that can receive native image parts should receive them. Runtimes that only accept text should receive runtime-only image references in the prompt path, without writing those references back into the visible user message. Carrent must not block sending just because a Runtime capability flag is missing.

## Acceptance criteria

- [x] A user can send a message containing only Image Attachments.
- [x] Image-only sends produce a clear internal request for the Coding Agent to inspect the images.
- [x] Visible history for image-only messages remains clean and does not show implementation-only filler unless product copy explicitly requires it.
- [x] Runtime requests carry Image Attachment payloads internally.
- [x] Text-only Runtime prompt construction can include Carrent-managed image references without changing persisted visible message text.
- [x] Carrent does not block image sends solely because model or Runtime image capability is unknown or false.
- [x] Tests cover image-only sends, visible history cleanliness, runtime request shape, and text-only prompt augmentation.

## Blocked by

- .scratch/image-attachments/issues/01-single-image-attachment-tracer-bullet.md
- .scratch/image-attachments/issues/02-paste-input-and-attachment-validation.md
