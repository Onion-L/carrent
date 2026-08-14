// Local Path Context: a structured reference to a user-dropped local file or
// folder. Unlike a File Attachment (ADR-0010), Carrent stores no bytes and owns
// no snapshot — it keeps only the original absolute path and whether the item
// is a file or a directory. Canonicalization (realpath) happens later, at Run
// start, when the Runtime read allowlist is built; this layer deliberately
// preserves the user-selected path verbatim so visually distinct selections
// (including case differences and non-resolved symlinks) are not collapsed.

export type LocalPathContextKind = "file" | "directory";

export type LocalPathContextItem = {
  // Platform-normalized absolute path (forward slashes, collapsed "."/".."),
  // never symlink-collapsed here. Original casing is preserved.
  path: string;
  basename: string;
  kind: LocalPathContextKind;
};

export type LocalPathResolutionRejectionReason = "non-local" | "unavailable" | "unsupported-kind";

export type LocalPathResolutionRejection = {
  index: number;
  reason: LocalPathResolutionRejectionReason;
};

// Result of resolving dropped DOM File objects through the privileged preload
// capability. Rejections stay typed so the Renderer can report one concise
// error without accepting a path the Main Process did not validate.
export type LocalPathResolutionResult = {
  items: LocalPathContextItem[];
  rejections: LocalPathResolutionRejection[];
};

// Result of asking the OS to reveal a path in the file manager. The privileged
// handler verifies the target still exists before asking the OS to reveal it;
// failures surface through the toast system rather than throwing.
export type RevealPathResult = { revealed: true } | { revealed: false; reason: "missing" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Normalizes a candidate filesystem path to a platform-neutral absolute form.
// Returns null for relative or empty paths. Mirrors the absoluteness rules of
// normalizeProjectWorkingDirectory but preserves casing and never lowercases,
// so dedupe stays by exact normalized path text.
export function normalizeLocalPathContextPath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const isWindowsPath = /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\");
  const withForwardSlashes = isWindowsPath ? value.replace(/\\/g, "/") : value;
  const drive = withForwardSlashes.match(/^([A-Za-z]:)(?:\/|$)/)?.[1] ?? "";
  const isUnc = withForwardSlashes.startsWith("//");
  const isAbsolute = isUnc || withForwardSlashes.startsWith("/") || Boolean(drive);
  if (!isAbsolute) return null;

  const segments: string[] = [];
  for (const segment of withForwardSlashes.slice(drive.length).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      // Preserve leading ".." only inside relative roots; absolute paths drop
      // them to stay within the filesystem root.
      if (segments.length > 0 && segments.at(-1) !== "..") {
        segments.pop();
      }
      continue;
    }
    segments.push(segment);
  }

  const prefix = drive ? `${drive}/` : isUnc ? "//" : "/";
  return `${prefix}${segments.join("/")}` || prefix;
}

export function localPathBasename(normalizedPath: string): string {
  const trimmed = normalizedPath.replace(/\/+$/u, "");
  const index = trimmed.lastIndexOf("/");
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

// Strict per-item validation used wherever a single Local Path Context item is
// trusted. Returns null for any malformed item so callers can filter leniently.
export function normalizeLocalPathContextItem(value: unknown): LocalPathContextItem | null {
  if (!isRecord(value)) return null;
  const path = normalizeLocalPathContextPath(value.path);
  if (!path) return null;
  if (value.kind !== "file" && value.kind !== "directory") return null;

  const basename =
    typeof value.basename === "string" && value.basename.trim().length > 0
      ? value.basename
      : localPathBasename(path);
  if (!basename) return null;

  return { path, basename, kind: value.kind };
}

// Platform-normalized identity key for dedupe within a single composition.
// The same path may be referenced again in a later message; dedupe is scoped by
// the caller to one composition (draft or message), never globally.
export function localPathContextIdentityKey(item: LocalPathContextItem): string {
  return `${item.kind}\u0000${item.path}`;
}

// Deduplicates Local Path Context items by normalized identity within one
// composition, preserving Finder/input order of the first occurrence.
export function dedupeLocalPathContexts(items: LocalPathContextItem[]): LocalPathContextItem[] {
  const seen = new Set<string>();
  const result: LocalPathContextItem[] = [];
  for (const item of items) {
    const key = localPathContextIdentityKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

// Lenient list normalization: an absent or non-array field resolves to an empty
// list (never throws, never rejects a whole snapshot), and malformed present
// items are dropped rather than failing the load. This is the backward-
// compatibility boundary — old persisted state without Local Path Context loads
// unchanged because an absent field produces no items here. It preserves every
// valid item without a count cap so persisted snapshots and accumulated Thread
// history round-trip faithfully.
export function normalizeLocalPathContexts(value: unknown): LocalPathContextItem[] {
  if (!Array.isArray(value)) return [];
  const items: LocalPathContextItem[] = [];
  for (const entry of value) {
    const item = normalizeLocalPathContextItem(entry);
    if (item) items.push(item);
  }
  return items;
}
