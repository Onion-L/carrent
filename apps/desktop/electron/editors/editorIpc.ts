import type { DetectedEditor } from "../../src/shared/editors";
import { editorCatalog, getEditorDescriptor } from "./editorCatalog";
import { detectEditor, detectEditors } from "./editorDetector";
import { createProcessRunner, type ProcessRunner } from "../runtime/processRunner";

const OPEN_TIMEOUT_MS = 10000;

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (
      event: unknown,
      editorId?: unknown,
      workingDirectory?: unknown,
    ) => Promise<DetectedEditor[] | string> | void,
  ) => void;
}

interface EditorsIpcDeps {
  pathExists?: (targetPath: string) => Promise<boolean>;
  homedir?: () => string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  run?: ProcessRunner["run"];
}

export function registerEditorsIpc(ipcMainLike: IpcMainLike, deps: EditorsIpcDeps = {}): void {
  ipcMainLike.handle("editors:list", async () => listInstalledEditors(deps));
  ipcMainLike.handle("editors:open", async (_event, editorId, workingDirectory) =>
    openInEditor(assertEditorId(editorId), assertWorkingDirectory(workingDirectory), deps),
  );
}

export async function listInstalledEditors(deps: EditorsIpcDeps = {}): Promise<DetectedEditor[]> {
  return detectEditors(editorCatalog, deps);
}

export async function openInEditor(
  editorId: string,
  workingDirectory: string,
  deps: EditorsIpcDeps = {},
): Promise<string> {
  const editor = getEditorDescriptor(editorId);
  const detected = await detectEditor(editor, deps);

  if (detected == null) {
    return `${editor.name} is not installed.`;
  }

  const run = deps.run ?? createProcessRunner().run;
  // macOS launches .app bundles through `open -a`; elsewhere the detected
  // path is the executable itself.
  const platform = deps.platform ?? process.platform;
  const result =
    platform === "darwin"
      ? await run("open", ["-a", detected.appPath, workingDirectory], {
          timeoutMs: OPEN_TIMEOUT_MS,
        })
      : await run(detected.appPath, [workingDirectory], { timeoutMs: OPEN_TIMEOUT_MS });

  if (result.ok) {
    return "";
  }

  const detail = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout);
  return detail ? `Failed to open ${editor.name}: ${detail}` : `Failed to open ${editor.name}.`;
}

function assertEditorId(editorId: unknown): string {
  if (typeof editorId !== "string" || editorId.length === 0) {
    throw new Error("Editor id is required.");
  }

  return editorId;
}

function assertWorkingDirectory(workingDirectory: unknown): string {
  if (typeof workingDirectory !== "string" || workingDirectory.length === 0) {
    throw new Error("Invalid directory path.");
  }

  return workingDirectory;
}

function firstNonEmptyLine(value: string): string {
  return (
    value
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}
