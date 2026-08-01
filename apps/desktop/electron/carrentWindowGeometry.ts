export type WindowBounds = { x: number; y: number; width: number; height: number };

export const DEFAULT_CASCADE_OFFSET = 24;

// A new Carrent Window opens on the source window's display, inherits the
// source window's *normal* (un-maximized) bounds, and is cascaded down and
// right by the cascade offset while remaining inside the display work area.
// A maximized source never makes the new window start maximized.
export function cascadeWindowBounds(
  source: WindowBounds,
  workArea: WindowBounds,
  cascadeOffset = DEFAULT_CASCADE_OFFSET,
): WindowBounds {
  const width = source.width;
  const height = source.height;
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  const x = Math.min(Math.max(source.x + cascadeOffset, workArea.x), Math.max(workArea.x, maxX));
  const y = Math.min(Math.max(source.y + cascadeOffset, workArea.y), Math.max(workArea.y, maxY));
  return { x, y, width, height };
}
