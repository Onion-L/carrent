import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DetectedEditor } from "../../src/shared/editors";
import type { EditorDescriptor } from "./editorCatalog";

interface EditorDetectorDeps {
  pathExists?: (targetPath: string) => Promise<boolean>;
  homedir?: () => string;
}

export async function detectEditor(
  editor: EditorDescriptor,
  deps: EditorDetectorDeps = {},
): Promise<DetectedEditor | null> {
  const pathExists = deps.pathExists ?? defaultPathExists;
  const homedir = deps.homedir ?? os.homedir;
  const candidates = [
    path.join("/Applications", editor.appBundleName),
    path.join(homedir(), "Applications", editor.appBundleName),
  ];

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

async function defaultPathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
