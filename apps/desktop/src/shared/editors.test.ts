import { describe, expect, it } from "bun:test";

import { resolveDefaultEditor, type DetectedEditor } from "./editors";

const editors: DetectedEditor[] = [
  { id: "cursor", name: "Cursor", appPath: "/Applications/Cursor.app" },
  { id: "vscode", name: "VS Code", appPath: "/Applications/Code.app" },
];

describe("resolveDefaultEditor", () => {
  it("returns the configured installed editor", () => {
    expect(resolveDefaultEditor(editors, "vscode")?.id).toBe("vscode");
  });

  it("falls back to the first detected editor", () => {
    expect(resolveDefaultEditor(editors, "")?.id).toBe("cursor");
    expect(resolveDefaultEditor(editors, "removed-editor")?.id).toBe("cursor");
  });

  it("returns undefined when no editor is detected", () => {
    expect(resolveDefaultEditor([], "vscode")).toBeUndefined();
  });
});
