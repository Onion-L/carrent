import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  classifyDiffLine,
  WorkspaceDiffContent,
  type WorkspaceDiffSnapshot,
} from "./WorkspaceDiffViewer";
import type { ChangedFile } from "../../mock/uiShellData";

function renderContent(snapshot: WorkspaceDiffSnapshot, files: ChangedFile[]): string {
  return renderToStaticMarkup(<WorkspaceDiffContent snapshot={snapshot} files={files} />);
}

describe("classifyDiffLine", () => {
  it("classifies diff headers", () => {
    expect(classifyDiffLine("diff --git a/file.txt b/file.txt")).toBe("header");
    expect(classifyDiffLine("index 1234567..abcdefg 100644")).toBe("header");
    expect(classifyDiffLine("--- a/file.txt")).toBe("header");
    expect(classifyDiffLine("+++ b/file.txt")).toBe("header");
    expect(classifyDiffLine("new file mode 100644")).toBe("header");
    expect(classifyDiffLine("deleted file mode 100644")).toBe("header");
    expect(classifyDiffLine("Binary files differ")).toBe("header");
  });

  it("classifies hunk markers", () => {
    expect(classifyDiffLine("@@ -1,3 +1,4 @@")).toBe("hunk");
  });

  it("classifies additions and deletions by prefix", () => {
    expect(classifyDiffLine("+added line")).toBe("addition");
    expect(classifyDiffLine("-removed line")).toBe("deletion");
  });

  it("classifies context lines", () => {
    expect(classifyDiffLine(" context line")).toBe("context");
    expect(classifyDiffLine("no prefix line")).toBe("context");
  });

  it("classifies empty lines", () => {
    expect(classifyDiffLine("")).toBe("empty");
  });
});

describe("WorkspaceDiffContent", () => {
  it("renders classified lines with non-color prefixes", () => {
    const snapshot: WorkspaceDiffSnapshot = {
      baseRevision: "abcdef1234567890",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: [
        "diff --git a/file.txt b/file.txt",
        "@@ -1,2 +1,3 @@",
        " context",
        "-deleted",
        "+added",
        "",
      ].join("\n"),
      truncated: false,
    };
    const files: ChangedFile[] = [
      { path: "file.txt", additions: 1, deletions: 1, binary: false, untracked: false },
    ];

    const html = renderContent(snapshot, files);
    expect(html).toContain("diff --git a/file.txt b/file.txt");
    expect(html).toContain("@@ -1,2 +1,3 @@");
    expect(html).toContain(" context");
    expect(html).toContain("-deleted");
    expect(html).toContain("+added");
  });

  it("escapes source-like script tags as text", () => {
    const snapshot: WorkspaceDiffSnapshot = {
      baseRevision: "abcdef1234567890",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: '+<script>alert("xss")</script>',
      truncated: false,
    };
    const files: ChangedFile[] = [
      { path: "bad.txt", additions: 1, deletions: 0, binary: false, untracked: false },
    ];

    const html = renderContent(snapshot, files);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("shows a truncation warning when truncated", () => {
    const snapshot: WorkspaceDiffSnapshot = {
      baseRevision: "abcdef1234567890",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: "diff --git a/file.txt b/file.txt",
      truncated: true,
    };
    const files: ChangedFile[] = [
      { path: "file.txt", additions: 0, deletions: 0, binary: false, untracked: false },
    ];

    const html = renderContent(snapshot, files);
    expect(html).toContain("Diff truncated.");
  });

  it("shows an omission warning when a file is omitted", () => {
    const snapshot: WorkspaceDiffSnapshot = {
      baseRevision: "abcdef1234567890",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: "",
      truncated: false,
    };
    const files: ChangedFile[] = [
      { path: "huge.txt", additions: 0, deletions: 0, binary: false, untracked: true, omitted: true },
    ];

    const html = renderContent(snapshot, files);
    expect(html).toContain("Some files omitted.");
  });

  it("shows empty-patch copy when every file is binary or omitted", () => {
    const snapshot: WorkspaceDiffSnapshot = {
      baseRevision: "abcdef1234567890",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: "diff --git a/image.png b/image.png",
      truncated: false,
    };
    const files: ChangedFile[] = [
      { path: "image.png", additions: 0, deletions: 0, binary: true, untracked: false },
      { path: "huge.bin", additions: 0, deletions: 0, binary: false, untracked: true, omitted: true },
    ];

    const html = renderContent(snapshot, files);
    expect(html).toContain("Every changed file is binary or omitted");
  });

  it("abbreviates the base revision in the header", () => {
    const snapshot: WorkspaceDiffSnapshot = {
      baseRevision: "abcdef1234567890abcdef1234567890abcdef12",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: "",
      truncated: false,
    };
    const files: ChangedFile[] = [];

    const html = renderContent(snapshot, files);
    expect(html).toContain("abcdef1");
    expect(html).not.toContain("abcdef1234567890abcdef1234567890abcdef12");
  });
});
