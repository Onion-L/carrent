# Paste input and attachment validation

Status: ready-for-agent

## Parent

.scratch/image-attachments/PRD.md

## What to build

Extend Image Attachment input beyond the first tracer bullet by supporting paste and the full validation rules. Users can paste supported images into the composer and can attach up to 30 images. Carrent validates format, single-image size, and per-message total size before sending. If any image is invalid or cannot be persisted, the entire message remains unsent and the composer keeps the user's text and pending images.

## Acceptance criteria

- [x] Users can paste PNG, JPEG, WebP, and GIF images into the composer.
- [x] Unsupported formats are rejected with clear user feedback.
- [x] More than 30 images cannot be sent in one message.
- [x] Any image over 10MB prevents the message from sending.
- [x] More than 100MB total image size prevents the message from sending.
- [x] If any image fails validation or persistence, no message is appended and no runtime request starts.
- [x] On failure, the composer preserves typed text and pending image previews.
- [x] Tests cover paste input, supported formats, unsupported formats, max count, single-image size, total-size limit, and all-or-nothing send behavior.

## Blocked by

- .scratch/image-attachments/issues/01-single-image-attachment-tracer-bullet.md
