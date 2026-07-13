import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  classifyDiffLine,
  extractFilePathFromHeader,
  splitPatchIntoFileBlocks,
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
  it("renders classified lines with prefix markers and stripped content", () => {
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
    expect(html).toContain("> </span>context</div>");
    expect(html).toContain(">-</span>deleted</div>");
    expect(html).toContain(">+</span>added</div>");
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
      {
        path: "huge.txt",
        additions: 0,
        deletions: 0,
        binary: false,
        untracked: true,
        omitted: true,
      },
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
      {
        path: "huge.bin",
        additions: 0,
        deletions: 0,
        binary: false,
        untracked: true,
        omitted: true,
      },
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

  it("expands the first file block by default and collapses the rest", () => {
    const snapshot: WorkspaceDiffSnapshot = {
      baseRevision: "abcdef1234567890",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: [
        "diff --git a/first.txt b/first.txt",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/second.txt b/second.txt",
        "@@ -1 +1 @@",
        "-a",
        "+b",
      ].join("\n"),
      truncated: false,
    };
    const files: ChangedFile[] = [
      { path: "first.txt", additions: 1, deletions: 1, binary: false, untracked: false },
      { path: "second.txt", additions: 1, deletions: 1, binary: false, untracked: false },
    ];

    const html = renderContent(snapshot, files);
    expect(html).toContain("first.txt");
    expect(html).toContain("second.txt");
    expect(html).toContain(">+</span>new</div>");
    expect(html).not.toContain(">+</span>b</div>");
  });
});

describe("extractFilePathFromHeader", () => {
  it("extracts the b/ path from a diff --git header", () => {
    const header = ["diff --git a/src/foo.txt b/src/foo.txt"];
    expect(extractFilePathFromHeader(header)).toBe("src/foo.txt");
  });

  it("falls back to the +++ b/ line when diff --git is missing", () => {
    const header = ["--- a/file.txt", "+++ b/deep/path/file.txt"];
    expect(extractFilePathFromHeader(header)).toBe("deep/path/file.txt");
  });

  it("returns unknown when no recognizable header is present", () => {
    expect(extractFilePathFromHeader(["@@ -1,2 +1,3 @@"])).toBe("unknown");
  });
});

describe("splitPatchIntoFileBlocks", () => {
  it("splits a tracked file patch into one block", () => {
    const patch = [
      "diff --git a/file.txt b/file.txt",
      "index 1234567..abcdefg 100644",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const blocks = splitPatchIntoFileBlocks(patch);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].path).toBe("file.txt");
    expect(blocks[0].lines).toHaveLength(7);
  });

  it("splits an untracked file patch that uses /dev/null as the old path", () => {
    const patch = [
      "diff --git /dev/null b/new/file.txt",
      "new file mode 100644",
      "index 0000000..abcdefg",
      "--- /dev/null",
      "+++ b/new/file.txt",
      "@@ -0,0 +1,2 @@",
      "+line one",
      "+line two",
    ].join("\n");

    const blocks = splitPatchIntoFileBlocks(patch);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].path).toBe("new/file.txt");
    expect(blocks[0].lines.some((line) => line.startsWith("+line"))).toBe(true);
  });

  it("handles multiple files in a single patch", () => {
    const patch = [
      "diff --git a/one.txt b/one.txt",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "diff --git a/two.txt b/two.txt",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");

    const blocks = splitPatchIntoFileBlocks(patch);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].path).toBe("one.txt");
    expect(blocks[1].path).toBe("two.txt");
  });
});
