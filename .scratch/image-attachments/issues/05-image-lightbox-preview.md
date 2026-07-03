# Image lightbox preview

Status: ready-for-agent

## Parent

.scratch/image-attachments/PRD.md

## What to build

Add an in-app lightbox for Image Attachment thumbnails. Clicking a thumbnail opens a dark overlay that focuses the image and keeps the user inside Carrent. The preview supports close, zoom controls, download access, and navigation across multiple images. The preview may show the original file name when useful, but never exposes app data raw paths.

## Acceptance criteria

- [x] Clicking a sent-message thumbnail opens an in-app dark overlay preview.
- [x] Clicking a composer thumbnail can open the same preview without sending.
- [x] The preview supports closing through a visible control.
- [x] The preview supports zoom controls.
- [x] The preview supports navigating between images in a multi-image message or pending set.
- [x] The preview supports download/save access without displaying raw storage paths.
- [x] The preview title uses the original file name when available and does not show app data paths.
- [x] Tests cover opening, closing, multi-image navigation, zoom control state, and no raw path display.

## Blocked by

- .scratch/image-attachments/issues/04-sent-message-thumbnails-and-immutable-history.md
