import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildOrderedWorkspaceDiffReviewTargets,
  buildWorkspaceDiffFollowUp,
  classifyDiffLine,
  extractFilePathFromHeader,
  getSelectedHunkSummary,
  splitFileBlockIntoHunks,
  splitPatchIntoFileBlocks,
  WorkspaceDiffContent,
  WorkspaceDiffViewer,
  type WorkspaceDiffSnapshot,
} from "./WorkspaceDiffViewer";
import type { ChangedFile } from "../../mock/uiShellData";

function renderContent(
  snapshot: WorkspaceDiffSnapshot,
  files: ChangedFile[],
  onCreateFollowUp?: (content: string) => void,
): string {
  return renderToStaticMarkup(
    <WorkspaceDiffContent snapshot={snapshot} files={files} onCreateFollowUp={onCreateFollowUp} />,
  );
}

function getThrownMessage(callback: () => unknown): string {
  try {
    callback();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected callback to throw.");
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
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("stays read-only without the follow-up callback", () => {
    const snapshot: WorkspaceDiffSnapshot = {
      baseRevision: "abcdef1234567890",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: ["diff --git a/file.txt b/file.txt", "@@ -1 +1 @@", "-old", "+new"].join("\n"),
      truncated: false,
    };
    const files: ChangedFile[] = [
      { path: "file.txt", additions: 1, deletions: 1, binary: false, untracked: false },
    ];

    const html = renderContent(snapshot, files);
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("What should change?");
    expect(html).not.toContain("Add follow-up");
    expect(html).toContain(
      "Snapshot against HEAD after the run; may include pre-existing or external changes.",
    );
  });

  it("renders review controls with the action initially disabled", () => {
    const snapshot: WorkspaceDiffSnapshot = {
      baseRevision: "abcdef1234567890",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: ["diff --git a/file.txt b/file.txt", "@@ -1 +1 @@", "-old", "+new"].join("\n"),
      truncated: false,
    };
    const files: ChangedFile[] = [
      { path: "file.txt", additions: 1, deletions: 1, binary: false, untracked: false },
    ];

    const html = renderContent(snapshot, files, () => {});
    expect(html).toContain('aria-label="Select entire file file.txt"');
    expect(html).toContain('aria-label="Select hunk @@ -1 +1 @@ in file.txt"');
    expect(html).toContain('placeholder="What should change?"');
    expect(html).toContain("Add follow-up");
    expect(html).toContain('disabled=""');
  });

  it("renders whole-file controls for binary, omitted, and summary-only files", () => {
    const snapshot: WorkspaceDiffSnapshot = {
      baseRevision: "abcdef1234567890",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: ["diff --git a/visible.txt b/visible.txt", "@@ -1 +1 @@", "-old", "+new"].join("\n"),
      truncated: true,
    };
    const files: ChangedFile[] = [
      { path: "visible.txt", additions: 1, deletions: 1, binary: false, untracked: false },
      { path: "image.png", additions: 0, deletions: 0, binary: true, untracked: false },
      {
        path: "huge.txt",
        additions: 10,
        deletions: 0,
        binary: false,
        untracked: false,
        omitted: true,
      },
      { path: "summary.txt", additions: 2, deletions: 1, binary: false, untracked: false },
    ];

    const html = renderContent(snapshot, files, () => {});
    expect(html).toContain("Files without visible diff");
    expect(html).toContain('aria-label="Select entire file image.png"');
    expect(html).toContain('aria-label="Select entire file huge.txt"');
    expect(html).toContain('aria-label="Select entire file summary.txt"');
    expect(html).toContain("Diff truncated and some files omitted.");
  });

  it("keeps known patch paths selectable when they are absent from the summary", () => {
    const snapshot: WorkspaceDiffSnapshot = {
      baseRevision: "abcdef1234567890",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: [
        "@@ -1 +1 @@",
        "-unparsed old",
        "+unparsed new",
        "diff --git a/unlisted.txt b/unlisted.txt",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
      truncated: true,
    };
    const files: ChangedFile[] = [
      { path: "unknown", additions: 1, deletions: 1, binary: false, untracked: false },
    ];

    const html = renderContent(snapshot, files, () => {});
    expect(html).toContain('aria-label="Select entire file unlisted.txt"');
    expect(html).not.toContain('aria-label="Select entire file unknown"');
  });
});

describe("WorkspaceDiffViewer", () => {
  it("renders as a non-modal side pane", () => {
    const html = renderToStaticMarkup(
      <WorkspaceDiffViewer
        snapshot={{
          baseRevision: "abcdef1234567890",
          capturedAt: "2024-01-01T00:00:00.000Z",
          patch: "",
          truncated: false,
        }}
        files={[]}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).not.toContain("aria-modal");
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

describe("splitFileBlockIntoHunks", () => {
  it("returns one hunk with its complete line range", () => {
    expect(
      splitFileBlockIntoHunks({
        path: "src/one.ts",
        lines: ["diff --git a/src/one.ts b/src/one.ts", "@@ -1 +1,2 @@", " old", "+new"],
      }),
    ).toEqual([
      {
        header: "@@ -1 +1,2 @@",
        lines: ["@@ -1 +1,2 @@", " old", "+new"],
      },
    ]);
  });

  it("returns hunks in patch order and excludes pre-hunk headers", () => {
    const hunks = splitFileBlockIntoHunks({
      path: "src/file.ts",
      lines: [
        "diff --git a/src/file.ts b/src/file.ts",
        "index 123..456 100644",
        "@@ -1,2 +1,2 @@",
        "-old one",
        "+new one",
        "@@ -10 +10,2 @@",
        " context",
        "+added",
      ],
    });

    expect(hunks).toEqual([
      {
        header: "@@ -1,2 +1,2 @@",
        lines: ["@@ -1,2 +1,2 @@", "-old one", "+new one"],
      },
      {
        header: "@@ -10 +10,2 @@",
        lines: ["@@ -10 +10,2 @@", " context", "+added"],
      },
    ]);
  });

  it("returns no hunks when a block has no hunk header", () => {
    expect(
      splitFileBlockIntoHunks({
        path: "image.png",
        lines: ["diff --git a/image.png b/image.png", "Binary files differ"],
      }),
    ).toEqual([]);
  });
});

describe("buildWorkspaceDiffFollowUp", () => {
  const snapshot: WorkspaceDiffSnapshot = {
    baseRevision: "abcdef1234567890abcdef1234567890abcdef12",
    capturedAt: "2026-07-16T08:30:45.123Z",
    patch: "-secret old line\n+secret new line",
    truncated: true,
  };

  it("formats mixed targets in the provided order with full snapshot metadata", () => {
    expect(
      buildWorkspaceDiffFollowUp({
        snapshot,
        reviewNote: "  Check the edge case.  ",
        targets: [
          { path: "src/file.ts", scope: "file" },
          { path: "src/other.ts", scope: "hunk", header: "@@ -10,2 +10,3 @@" },
        ],
      }),
    ).toBe(
      [
        "Follow up on this workspace diff review.",
        "",
        "Review note:",
        "Check the edge case.",
        "",
        "Snapshot:",
        "- Base revision: abcdef1234567890abcdef1234567890abcdef12",
        "- Captured at: 2026-07-16T08:30:45.123Z",
        "- This may include pre-existing or external changes.",
        "",
        "Selected changes:",
        '- Entire file: "src/file.ts"',
        '- Hunk in "src/other.ts": "@@ -10,2 +10,3 @@"',
        "",
        "Inspect the current workspace before editing because it may have changed since this snapshot.",
      ].join("\n"),
    );
  });

  it("uses JSON escaping for paths and hunk headers", () => {
    const content = buildWorkspaceDiffFollowUp({
      snapshot,
      reviewNote: "Review escaping",
      targets: [
        { path: 'src/quo"te\\file.ts', scope: "file" },
        { path: "src/other.ts", scope: "hunk", header: '@@ \\ "quoted" @@' },
      ],
    });

    expect(content).toContain(`- Entire file: ${JSON.stringify('src/quo"te\\file.ts')}`);
    expect(content).toContain(
      `- Hunk in ${JSON.stringify("src/other.ts")}: ${JSON.stringify('@@ \\ "quoted" @@')}`,
    );
  });

  it("preserves internal note newlines while trimming only the outside", () => {
    const content = buildWorkspaceDiffFollowUp({
      snapshot,
      reviewNote: "\n  First line\n\nSecond line  \n",
      targets: [{ path: "src/file.ts", scope: "file" }],
    });

    expect(content).toContain("Review note:\nFirst line\n\nSecond line");
  });

  it("never includes patch bodies or diff line content", () => {
    const content = buildWorkspaceDiffFollowUp({
      snapshot,
      reviewNote: "Review this",
      targets: [{ path: "src/file.ts", scope: "hunk", header: "@@ -1 +1 @@" }],
    });

    expect(content).not.toContain("secret old line");
    expect(content).not.toContain("secret new line");
  });

  it("rejects an empty trimmed note", () => {
    expect(
      getThrownMessage(() =>
        buildWorkspaceDiffFollowUp({
          snapshot,
          reviewNote: " \n\t ",
          targets: [{ path: "src/file.ts", scope: "file" }],
        }),
      ),
    ).toBe("A review note is required.");
  });

  it("rejects an empty target list", () => {
    expect(
      getThrownMessage(() =>
        buildWorkspaceDiffFollowUp({
          snapshot,
          reviewNote: "Review this",
          targets: [],
        }),
      ),
    ).toBe("At least one review target is required.");
  });

  it("rejects the unknown path sentinel", () => {
    expect(
      getThrownMessage(() =>
        buildWorkspaceDiffFollowUp({
          snapshot,
          reviewNote: "Review this",
          targets: [{ path: "unknown", scope: "file" }],
        }),
      ),
    ).toBe("Unknown diff paths cannot be reviewed.");
  });
});

describe("buildOrderedWorkspaceDiffReviewTargets", () => {
  it("orders summary paths first, then unmatched known blocks in patch order", () => {
    const files: ChangedFile[] = [
      { path: "summary-b.ts", additions: 1, deletions: 0, binary: false, untracked: false },
      { path: "summary-a.ts", additions: 1, deletions: 0, binary: false, untracked: false },
      { path: "unknown", additions: 1, deletions: 0, binary: false, untracked: false },
    ];
    const blocks = [
      { path: "unmatched-c.ts", lines: ["@@ -1 +1 @@", "+c"] },
      { path: "summary-a.ts", lines: ["@@ -2 +2 @@", "+a"] },
      { path: "unmatched-d.ts", lines: ["@@ -3 +3 @@", "+d"] },
      { path: "unknown", lines: ["@@ -4 +4 @@", "+unknown"] },
    ];
    const selectedFiles = new Set(["summary-b.ts", "unmatched-d.ts", "unknown"]);
    const selectedHunks = new Set([
      "summary-a.ts\u0000@@ -2 +2 @@",
      "unmatched-c.ts\u0000@@ -1 +1 @@",
      "unknown\u0000@@ -4 +4 @@",
    ]);

    expect(
      buildOrderedWorkspaceDiffReviewTargets({
        files,
        blocks,
        isFileSelected: (path) => selectedFiles.has(path),
        isHunkSelected: (path, header) => selectedHunks.has(`${path}\u0000${header}`),
      }),
    ).toEqual([
      { path: "summary-b.ts", scope: "file" },
      { path: "summary-a.ts", scope: "hunk", header: "@@ -2 +2 @@" },
      { path: "unmatched-c.ts", scope: "hunk", header: "@@ -1 +1 @@" },
      { path: "unmatched-d.ts", scope: "file" },
    ]);
  });
});

describe("getSelectedHunkSummary", () => {
  const hunks = [
    { header: "@@ -1 +1 @@", lines: ["@@ -1 +1 @@"] },
    { header: "@@ -3 +3 @@", lines: ["@@ -3 +3 @@"] },
  ];

  it("returns compact singular and plural collapsed-file status", () => {
    expect(
      getSelectedHunkSummary({
        path: "src/file.ts",
        hunks,
        isSelected: (_path, header) => header === "@@ -1 +1 @@",
      }),
    ).toBe("1 hunk selected");
    expect(
      getSelectedHunkSummary({
        path: "src/file.ts",
        hunks,
        isSelected: () => true,
      }),
    ).toBe("2 hunks selected");
  });

  it("returns no status when no hunks are selected", () => {
    expect(
      getSelectedHunkSummary({
        path: "src/file.ts",
        hunks,
        isSelected: () => false,
      }),
    ).toBe(null);
  });
});
