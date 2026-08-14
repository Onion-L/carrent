import { describe, expect, it } from "bun:test";

import {
  dedupeLocalPathContexts,
  localPathBasename,
  normalizeLocalPathContextItem,
  normalizeLocalPathContextPath,
  normalizeLocalPathContexts,
} from "./localPathContext";

describe("normalizeLocalPathContextPath", () => {
  it("preserves a backslash inside an absolute POSIX filename", () => {
    expect(normalizeLocalPathContextPath(String.raw`/tmp/a\b.md`)).toBe(String.raw`/tmp/a\b.md`);
  });

  it("keeps an absolute POSIX path and collapses redundant segments", () => {
    expect(normalizeLocalPathContextPath("/Users/onion/./work/../work/carrent")).toBe(
      "/Users/onion/work/carrent",
    );
  });

  it("normalizes Windows backslashes to forward slashes and keeps drive casing", () => {
    expect(normalizeLocalPathContextPath("C:\\Users\\onion\\work")).toBe("C:/Users/onion/work");
    expect(normalizeLocalPathContextPath("D:/data\\sets\\raw")).toBe("D:/data/sets/raw");
  });

  it("preserves casing so visually distinct selections are not collapsed", () => {
    expect(normalizeLocalPathContextPath("/Users/Onion/Notes")).toBe("/Users/Onion/Notes");
    expect(normalizeLocalPathContextPath("/users/onion/notes")).toBe("/users/onion/notes");
  });

  it("rejects relative and empty paths", () => {
    expect(normalizeLocalPathContextPath("relative/path")).toBeNull();
    expect(normalizeLocalPathContextPath("./notes")).toBeNull();
    expect(normalizeLocalPathContextPath("")).toBeNull();
    expect(normalizeLocalPathContextPath(undefined)).toBeNull();
  });

  it("preserves edge-case characters verbatim", () => {
    expect(normalizeLocalPathContextPath("/Users/onion/My Notes (draft) [v2]/文件.txt")).toBe(
      "/Users/onion/My Notes (draft) [v2]/文件.txt",
    );
  });
});

describe("normalizeLocalPathContextItem", () => {
  it("normalizes the path and validates the kind union", () => {
    expect(normalizeLocalPathContextItem({ path: "/a/b.ts", kind: "file" })).toEqual({
      path: "/a/b.ts",
      basename: "b.ts",
      kind: "file",
    });
    expect(normalizeLocalPathContextItem({ path: "/a/b", kind: "directory" })).toEqual({
      path: "/a/b",
      basename: "b",
      kind: "directory",
    });
  });

  it("rejects unknown kinds and relative paths", () => {
    expect(normalizeLocalPathContextItem({ path: "/a/b", kind: "folder" })).toBeNull();
    expect(normalizeLocalPathContextItem({ path: "a/b", kind: "file" })).toBeNull();
    expect(normalizeLocalPathContextItem({ path: "/a/b" })).toBeNull();
  });

  it("keeps an explicit basename and falls back to the path basename when blank", () => {
    expect(
      normalizeLocalPathContextItem({ path: "/a/b.ts", kind: "file", basename: "renamed.ts" }),
    ).toEqual({ path: "/a/b.ts", basename: "renamed.ts", kind: "file" });
    expect(
      normalizeLocalPathContextItem({ path: "/a/b.ts", kind: "file", basename: "  " }),
    ).toEqual({ path: "/a/b.ts", basename: "b.ts", kind: "file" });
  });
});

describe("localPathBasename", () => {
  it("extracts the last segment", () => {
    expect(localPathBasename("/a/b/c.ts")).toBe("c.ts");
    expect(localPathBasename("/a/folder")).toBe("folder");
  });
});

describe("normalizeLocalPathContexts (leniency)", () => {
  it("returns an empty list for absent or non-array values", () => {
    expect(normalizeLocalPathContexts(undefined)).toEqual([]);
    expect(normalizeLocalPathContexts(null)).toEqual([]);
    expect(normalizeLocalPathContexts("nope")).toEqual([]);
    expect(normalizeLocalPathContexts({})).toEqual([]);
  });

  it("drops malformed entries instead of rejecting the list", () => {
    const result = normalizeLocalPathContexts([
      { path: "/a/keep.ts", kind: "file" },
      { path: "relative", kind: "file" },
      { kind: "file" },
      { path: "/a/dir", kind: "directory" },
      "nope",
    ]);
    expect(result).toEqual([
      { path: "/a/keep.ts", basename: "keep.ts", kind: "file" },
      { path: "/a/dir", basename: "dir", kind: "directory" },
    ]);
  });

  it("preserves order and exact edge-case path text including long basenames", () => {
    const longName = `very-long-source-file-name-with-many-words-and-qualifiers-${"x".repeat(120)}.test.ts`;
    const items = [
      { path: "/Users/onion/My Notes (draft) [v2].md", kind: "file" },
      { path: "/Users/onion/项目 文件", kind: "directory" },
      { path: "/tmp/a b/c[d].ts", kind: "file" },
      { path: `/repo/src/${longName}`, kind: "file" },
    ];
    expect(normalizeLocalPathContexts(items)).toEqual([
      {
        path: "/Users/onion/My Notes (draft) [v2].md",
        basename: "My Notes (draft) [v2].md",
        kind: "file",
      },
      { path: "/Users/onion/项目 文件", basename: "项目 文件", kind: "directory" },
      { path: "/tmp/a b/c[d].ts", basename: "c[d].ts", kind: "file" },
      { path: `/repo/src/${longName}`, basename: longName, kind: "file" },
    ]);
  });

  it("preserves every valid item on load (the staging cap is enforced elsewhere)", () => {
    const items = Array.from({ length: 60 }, (_, index) => ({
      path: `/a/f${index}.ts`,
      kind: "file" as const,
    }));
    expect(normalizeLocalPathContexts(items)).toHaveLength(60);
  });
});

describe("dedupeLocalPathContexts", () => {
  it("keeps the first occurrence and preserves order", () => {
    expect(
      dedupeLocalPathContexts([
        { path: "/a/notes.md", basename: "notes.md", kind: "file" },
        { path: "/b/assets", basename: "assets", kind: "directory" },
        { path: "/a/notes.md", basename: "notes.md", kind: "file" },
      ]),
    ).toEqual([
      { path: "/a/notes.md", basename: "notes.md", kind: "file" },
      { path: "/b/assets", basename: "assets", kind: "directory" },
    ]);
  });

  it("treats the same path with a different kind as a distinct item", () => {
    expect(
      dedupeLocalPathContexts([
        { path: "/a/thing", basename: "thing", kind: "file" },
        { path: "/a/thing", basename: "thing", kind: "directory" },
      ]),
    ).toHaveLength(2);
  });
});
