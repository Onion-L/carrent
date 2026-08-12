export type KimiMemoryFileType = "user" | "project" | "feedback" | "reference" | "other";

export type KimiMemoryFile = {
  /** Absolute path on disk. */
  path: string;
  /** Basename, e.g. "user-profile.md". */
  fileName: string;
  /** Frontmatter `name`, falling back to the file name without extension. */
  name: string;
  /** Frontmatter `description`; empty string when absent. */
  description: string;
  /** Frontmatter `type`; "other" when missing or unrecognized. */
  type: KimiMemoryFileType;
  /** Markdown body below the frontmatter. */
  body: string;
  /** Full file text, frontmatter included (for the raw view). */
  raw: string;
  /** Epoch ms of the last file modification. */
  modifiedAt: number;
  /** True for the project's MEMORY.md index file. */
  isIndex: boolean;
};

export type KimiMemoryProject = {
  /** Directory name under projects/, e.g. "-Users-onion-workbench-carrent-17e396ae3d2e". */
  key: string;
  /** Display name derived from the key (trailing hash stripped, last segment kept). */
  name: string;
  files: KimiMemoryFile[];
};

export type KimiMemoryIndex = {
  projects: KimiMemoryProject[];
  /** ISO timestamp of when the scan ran. */
  scannedAt: string;
};
