/**
 * Stable per-repository accent colors for the Worktrees Settings Tab. The
 * list rows and the storage summary tint size figures and proportion bars
 * with the owning repository's color so multiple repositories stay visually
 * distinct. Colors never encode safety state.
 */

export const REPOSITORY_HUES: readonly number[] = [210, 150, 25, 280, 340, 100, 190, 55];

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable base color for a repository: FNV-1a hash of its identity → palette hue. */
export function repositoryColor(commonDirectory: string): string {
  const hue = REPOSITORY_HUES[fnv1a(commonDirectory) % REPOSITORY_HUES.length] ?? 0;
  return `hsl(${hue}, 48%, 64%)`;
}
