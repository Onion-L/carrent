# Multi-image composer controls

Status: ready-for-agent

## Parent

.scratch/image-attachments/PRD.md

## What to build

Polish the composer Image Attachment state for many images. Pending images appear as fixed-size thumbnails inside the top-left area of the composer shell. Each pending thumbnail has a remove control. When many images are attached, the preview row scrolls horizontally and does not make the composer excessively tall.

## Acceptance criteria

- [x] Pending Image Attachments render as fixed-size thumbnails in the composer.
- [x] Each pending thumbnail has a visible remove control before send.
- [x] Removing one pending image updates the pending attachment set without changing the typed text.
- [x] Attaching many images uses horizontal scrolling rather than growing the composer vertically.
- [x] The composer remains usable at the 30-image limit.
- [x] The layout matches the confirmed input-box visual direction.
- [x] Tests cover removing pending images and preserving input state.

## Blocked by

- .scratch/image-attachments/issues/01-single-image-attachment-tracer-bullet.md
- .scratch/image-attachments/issues/02-paste-input-and-attachment-validation.md
