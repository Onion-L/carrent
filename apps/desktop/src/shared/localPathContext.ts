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

// Mirrors the File Attachment count guard (MAX_ATTACHMENT_COUNT). Local Path
// Context copies no bytes, but a composition still caps how many references a
// user can stage so the composer stays scannable.
export const MAX_LOCAL_PATH_CONTEXTS = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Normalizes a candidate filesystem path to a platform-neutral absolute form.
// Returns null for relative or empty paths. Mirrors the absoluteness rules of
// normalizeProjectWorkingDirectory but preserves casing and never lowercases,
// so dedupe stays by exact normalized path text.
export function normalizeLocalPathContextPath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const withForwardSlashes = value.replace(/\\/g, "/");
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

// Lenient list normalization: an absent or non-array field resolves to an empty
// list (never throws, never rejects a whole snapshot), and malformed present
// items are dropped rather than failing the load. This is the backward-
// compatibility boundary — old persisted state without Local Path Context loads
// unchanged because an absent field produces no items here. It preserves every
// valid item (no count cap) so a persisted snapshot round-trips faithfully; the
// staging cap (`MAX_LOCAL_PATH_CONTEXTS`) is enforced at the chat:send boundary.
export function normalizeLocalPathContexts(value: unknown): LocalPathContextItem[] {
  if (!Array.isArray(value)) return [];
  const items: LocalPathContextItem[] = [];
  for (const entry of value) {
    const item = normalizeLocalPathContextItem(entry);
    if (item) items.push(item);
  }
  return items;
}
