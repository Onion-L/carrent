// Muted mid-tone palette that stays legible with white letters on both
// dark and light surfaces. Picked deterministically from the workspace name
// so a workspace keeps the same color everywhere.
const WORKSPACE_AVATAR_COLORS = [
  "#5b8def",
  "#4aa8a0",
  "#4c9a52",
  "#c98a3d",
  "#d0704a",
  "#c15b5b",
  "#b45a9e",
  "#8a6cd9",
];

export function workspaceAvatarColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return WORKSPACE_AVATAR_COLORS[Math.abs(hash) % WORKSPACE_AVATAR_COLORS.length];
}
