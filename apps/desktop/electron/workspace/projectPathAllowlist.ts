import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { AppStateSnapshot } from "../../src/shared/workspacePersistence";

export type AssertProjectPathAllowed = (projectPath: string) => Promise<void>;

export interface ProjectPathAllowlistDeps {
  getSnapshot: () => AppStateSnapshot | null | undefined;
  realpath?: (value: string) => Promise<string>;
}

// Renderer-supplied paths are untrusted: git and editor commands may only run
// inside directories the user registered as Carrent Projects. Candidate and
// registered root alike resolve through the real filesystem, so a symlink
// cannot smuggle a path outside its Project.
export function createProjectPathAllowlist(
  deps: ProjectPathAllowlistDeps,
): AssertProjectPathAllowed {
  const resolvePath = deps.realpath ?? realpath;

  return async (projectPath) => {
    if (!isAbsolute(projectPath)) {
      throw new Error("Project path must be absolute.");
    }

    const projects = deps.getSnapshot()?.projects ?? [];
    const candidate = await resolveExistingPath(resolvePath, projectPath);

    for (const project of projects) {
      const root = await resolveExistingPath(resolvePath, project.workingDirectory);
      if (isPathWithin(root, candidate)) {
        return;
      }
    }

    throw new Error("Project path is outside registered Carrent Projects.");
  };
}

// A missing path falls back to lexical resolution so a not-yet-created
// descendant of an existing Project stays usable; everything else keeps its
// canonical on-disk identity.
async function resolveExistingPath(
  resolvePath: (value: string) => Promise<string>,
  value: string,
): Promise<string> {
  try {
    return await resolvePath(value);
  } catch {
    return resolve(value);
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}
