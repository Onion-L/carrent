import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DetectedEditor } from "../../src/shared/editors";
import type { EditorDescriptor } from "./editorCatalog";

interface EditorDetectorDeps {
  pathExists?: (targetPath: string) => Promise<boolean>;
  homedir?: () => string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export async function detectEditor(
  editor: EditorDescriptor,
  deps: EditorDetectorDeps = {},
): Promise<DetectedEditor | null> {
  const pathExists = deps.pathExists ?? defaultPathExists;
  const candidates = candidatePaths(editor, deps);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return { id: editor.id, name: editor.name, appPath: candidate };
    }
  }

  return null;
}

export async function detectEditors(
  editors: EditorDescriptor[],
  deps: EditorDetectorDeps = {},
): Promise<DetectedEditor[]> {
  const results = await Promise.all(editors.map((editor) => detectEditor(editor, deps)));
  return results.filter((editor): editor is DetectedEditor => editor != null);
}

function candidatePaths(editor: EditorDescriptor, deps: EditorDetectorDeps): string[] {
  const platform = deps.platform ?? process.platform;
  const homedir = deps.homedir ?? os.homedir;

  if (platform === "win32") {
    const env = deps.env ?? process.env;
    return (editor.windowsExecutables ?? []).map((candidate) =>
      expandWindowsVariables(candidate, env),
    );
  }
  if (platform === "linux") {
    return (editor.linuxExecutables ?? []).map((candidate) =>
      candidate.startsWith("~/") ? path.join(homedir(), candidate.slice(2)) : candidate,
    );
  }
  return [
    path.join("/Applications", editor.appBundleName),
    path.join(homedir(), "Applications", editor.appBundleName),
  ];
}

// An unset variable leaves %VAR% in place, producing a path that cannot exist
// and is therefore skipped like any other missing candidate.
function expandWindowsVariables(candidate: string, env: NodeJS.ProcessEnv): string {
  return candidate.replace(/%([^%]+)%/gu, (match, name: string) => {
    const value = env[name];
    return typeof value === "string" && value !== "" ? value : match;
  });
}

async function defaultPathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
