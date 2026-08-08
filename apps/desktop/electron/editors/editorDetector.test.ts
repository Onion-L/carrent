import { describe, expect, it } from "bun:test";

import { editorCatalog } from "./editorCatalog";
import { detectEditor, detectEditors } from "./editorDetector";

describe("detectEditor", () => {
  it("returns the detected editor with the system Applications path", async () => {
    const checkedPaths: string[] = [];

    const result = await detectEditor(editorCatalog[0], {
      homedir: () => "/Users/tester",
      pathExists: async (targetPath) => {
        checkedPaths.push(targetPath);
        return true;
      },
    });

    expect(result).toEqual({
      id: "cursor",
      name: "Cursor",
      appPath: "/Applications/Cursor.app",
    });
    expect(checkedPaths).toEqual(["/Applications/Cursor.app"]);
  });

  it("falls back to the user Applications directory", async () => {
    const result = await detectEditor(editorCatalog[2], {
      homedir: () => "/Users/tester",
      pathExists: async (targetPath) => targetPath === "/Users/tester/Applications/Zed.app",
    });

    expect(result).toEqual({
      id: "zed",
      name: "Zed",
      appPath: "/Users/tester/Applications/Zed.app",
    });
  });

  it("returns null when the app bundle is missing everywhere", async () => {
    const result = await detectEditor(editorCatalog[3], {
      homedir: () => "/Users/tester",
      pathExists: async () => false,
    });

    expect(result).toBe(null);
  });
});

describe("detectEditors", () => {
  it("returns only installed editors in catalog order", async () => {
    const installed = new Set(["/Applications/Cursor.app", "/Users/tester/Applications/Zed.app"]);

    const results = await detectEditors(editorCatalog, {
      homedir: () => "/Users/tester",
      pathExists: async (targetPath) => installed.has(targetPath),
    });

    expect(results).toEqual([
      { id: "cursor", name: "Cursor", appPath: "/Applications/Cursor.app" },
      { id: "zed", name: "Zed", appPath: "/Users/tester/Applications/Zed.app" },
    ]);
  });
});
