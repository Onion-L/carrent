import { describe, expect, it } from "bun:test";

import { createLocalPathContextPreloadApi } from "./preloadLocalPathContext";

describe("Local Path Context preload boundary", () => {
  it("passes the original DOM File to getPathForFile before invoking Main", async () => {
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    const receivedFiles: File[] = [];
    const receivedPaths: string[][] = [];
    const expected = {
      items: [{ path: "/Users/test/notes.md", basename: "notes.md", kind: "file" as const }],
      rejections: [],
    };
    const api = createLocalPathContextPreloadApi(
      (receivedFile) => {
        receivedFiles.push(receivedFile);
        return "/Users/test/notes.md";
      },
      async (paths) => {
        receivedPaths.push(paths);
        return expected;
      },
    );

    expect(await api.resolveDroppedItems([file])).toEqual(expected);
    expect(receivedFiles).toEqual([file]);
    expect(receivedFiles[0]).toBe(file);
    expect(receivedPaths).toEqual([["/Users/test/notes.md"]]);
  });
});
