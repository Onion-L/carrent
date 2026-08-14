import { describe, expect, it } from "bun:test";

import { editorCatalog } from "./editorCatalog";
import { detectEditor, detectEditors } from "./editorDetector";

const darwin = {
  platform: "darwin" as const,
  homedir: () => "/Users/tester",
};

describe("detectEditor", () => {
  it("returns the detected editor with the system Applications path on macOS", async () => {
    const checkedPaths: string[] = [];

    const result = await detectEditor(editorCatalog[0], {
      ...darwin,
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
      ...darwin,
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
      ...darwin,
      pathExists: async () => false,
    });

    expect(result).toBe(null);
  });

  it("expands Windows environment variables in executable candidates", async () => {
    const checkedPaths: string[] = [];
    const vscode = editorCatalog.find((editor) => editor.id === "vscode");
    if (!vscode) throw new Error("vscode descriptor missing");

    const missing = await detectEditor(vscode, {
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
      pathExists: async (targetPath) => {
        checkedPaths.push(targetPath);
        return false;
      },
    });

    expect(missing).toBe(null);
    expect(checkedPaths).toEqual([
      "C:\\Users\\tester\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
      "%ProgramFiles%\\Microsoft VS Code\\Code.exe",
    ]);
  });

  it("detects Windows editors from their per-user install location", async () => {
    const cursor = editorCatalog.find((editor) => editor.id === "cursor");
    if (!cursor) throw new Error("cursor descriptor missing");

    const result = await detectEditor(cursor, {
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
      pathExists: async (targetPath) =>
        targetPath === "C:\\Users\\tester\\AppData\\Local\\Programs\\Cursor\\Cursor.exe",
    });

    expect(result).toEqual({
      id: "cursor",
      name: "Cursor",
      appPath: "C:\\Users\\tester\\AppData\\Local\\Programs\\Cursor\\Cursor.exe",
    });
  });

  it("skips macOS-only editors on Windows and Linux", async () => {
    const xcode = editorCatalog.find((editor) => editor.id === "xcode");
    if (!xcode) throw new Error("xcode descriptor missing");

    for (const platform of ["win32", "linux"] as const) {
      const result = await detectEditor(xcode, {
        platform,
        homedir: () => "/home/tester",
        pathExists: async () => true,
      });
      expect(result).toBe(null);
    }
  });

  it("expands the home directory in Linux executable candidates", async () => {
    const zed = editorCatalog.find((editor) => editor.id === "zed");
    if (!zed) throw new Error("zed descriptor missing");

    const result = await detectEditor(zed, {
      platform: "linux",
      homedir: () => "/home/tester",
      pathExists: async (targetPath) => targetPath === "/home/tester/.local/bin/zed",
    });

    expect(result).toEqual({
      id: "zed",
      name: "Zed",
      appPath: "/home/tester/.local/bin/zed",
    });
  });
});

describe("detectEditors", () => {
  it("returns only installed editors in catalog order", async () => {
    const installed = new Set(["/Applications/Cursor.app", "/Users/tester/Applications/Zed.app"]);

    const results = await detectEditors(editorCatalog, {
      ...darwin,
      pathExists: async (targetPath) => installed.has(targetPath),
    });

    expect(results).toEqual([
      { id: "cursor", name: "Cursor", appPath: "/Applications/Cursor.app" },
      { id: "zed", name: "Zed", appPath: "/Users/tester/Applications/Zed.app" },
    ]);
  });
});
