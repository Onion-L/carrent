/**
 * Validation for user-chosen names of newly created empty Project directories.
 *
 * The name becomes a single path segment under the New Project base directory.
 * Names are preserved as typed (after trimming outer whitespace): Unicode and
 * internal spaces are fine, and nothing is slugified or auto-rewritten. The
 * rejected set targets cross-platform filesystem safety — path separators,
 * control characters, Windows-invalid characters, dot names, trailing
 * spaces/periods, and Windows device names.
 */

export const MAX_NEW_PROJECT_NAME_LENGTH = 100;

// Matches a whole Windows device name, optionally followed by an extension.
const WINDOWS_DEVICE_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Path separators and Windows-invalid characters.
const INVALID_CHARACTER_PATTERN = /[<>:"/\\|?*]/;

// C0/C1 control characters and DEL (checked without a control-char regex).
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

export type NewProjectNameValidation = { ok: true; name: string } | { ok: false; error: string };

/** IPC contract for `project-directory:create-empty`. */
export type CreateEmptyProjectDirectoryRequest = {
  name: string;
  /** Per-creation base override; wins over the configured New Project location. */
  baseDirectory?: string;
};

export type CreateEmptyProjectDirectoryResult = {
  /** Canonical absolute path of the newly created empty Project directory. */
  workingDirectory: string;
};

export function validateNewProjectName(value: string): NewProjectNameValidation {
  const name = value.trim();
  if (!name) {
    return { ok: false, error: "Project name is required." };
  }
  if (name.length > MAX_NEW_PROJECT_NAME_LENGTH) {
    return {
      ok: false,
      error: `Project name must be ${MAX_NEW_PROJECT_NAME_LENGTH} characters or fewer.`,
    };
  }
  if (INVALID_CHARACTER_PATTERN.test(name) || hasControlCharacter(name)) {
    return { ok: false, error: 'Project name cannot contain <>:"/\\|?* or control characters.' };
  }
  if (name === "." || name === "..") {
    return { ok: false, error: 'Project name cannot be "." or "..".' };
  }
  if (name.endsWith(" ") || name.endsWith(".")) {
    return { ok: false, error: "Project name cannot end with a space or period." };
  }
  if (WINDOWS_DEVICE_NAME_PATTERN.test(name)) {
    return { ok: false, error: "Project name is a reserved Windows device name." };
  }
  return { ok: true, name };
}
