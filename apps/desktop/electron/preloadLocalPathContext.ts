import type { LocalPathResolutionResult } from "../src/shared/localPathContext";

type GetPathForFile = (file: File) => string;
type ResolvePaths = (paths: string[]) => Promise<LocalPathResolutionResult>;

export function createLocalPathContextPreloadApi(
  getPathForFile: GetPathForFile,
  resolvePaths: ResolvePaths,
) {
  return {
    resolveDroppedItems: (files: File[]) =>
      resolvePaths(files.map((file) => getPathForFile(file))),
  };
}
