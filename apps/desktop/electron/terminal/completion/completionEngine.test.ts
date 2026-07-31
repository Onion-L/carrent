import { describe, expect, it } from "bun:test";

import { provideCommandCandidates } from "./completionEngine";

const base = {
  cwd: "/work/carrent",
  executables: ["git", "gh", "bun", "pnpm", "printf"],
  builtins: ["cd", "echo"],
  aliases: ["gst"],
  functions: ["mkcd"],
  paths: [
    { name: "src", directory: true },
    { name: "README.md", directory: false },
    { name: "hello world.txt", directory: false },
  ],
  packageScripts: ["build", "test:unit"],
};

describe("provideCommandCandidates", () => {
  it("combines and deduplicates executable and shell-symbol candidates", () => {
    const result = provideCommandCandidates({ ...base, commandLine: "g", cursor: 1 });
    expect(result.map((candidate) => [candidate.label, candidate.kind])).toEqual([
      ["gh", "executable"],
      ["git", "executable"],
      ["gst", "alias"],
    ]);
    expect(result[0].replacement).toEqual({ start: 0, end: 1 });
  });

  it("offers escaped paths with the current token replacement range", () => {
    const result = provideCommandCandidates({ ...base, commandLine: "cat hel", cursor: 7 });
    expect(result.find((candidate) => candidate.label === "hello world.txt")).toMatchObject({
      insertText: "hello\\ world.txt",
      kind: "file",
      replacement: { start: 4, end: 7 },
    });
  });

  it("replaces the whole token when the cursor is in the middle", () => {
    const result = provideCommandCandidates({
      ...base,
      commandLine: "git switch",
      cursor: 6,
    });
    expect(result.find((candidate) => candidate.label === "switch")?.replacement).toEqual({
      start: 4,
      end: 10,
    });
  });

  it("provides Git and GitHub CLI rules at command positions", () => {
    expect(
      provideCommandCandidates({ ...base, commandLine: "git sw", cursor: 6 }).map(
        (candidate) => candidate.label,
      ),
    ).toContain("switch");
    expect(
      provideCommandCandidates({ ...base, commandLine: "gh pr c", cursor: 7 }).map(
        (candidate) => candidate.label,
      ),
    ).toContain("create");
    expect(
      provideCommandCandidates({ ...base, commandLine: "echo git sw", cursor: 11 }).map(
        (candidate) => candidate.label,
      ),
    ).not.toContain("switch");
  });

  it("provides JavaScript tool commands and local package scripts without network input", () => {
    for (const command of ["bun", "npm", "npx", "pnpm", "yarn"]) {
      const labels = provideCommandCandidates({
        ...base,
        commandLine: `${command} `,
        cursor: command.length + 1,
      }).map((candidate) => candidate.label);
      expect(labels).toHaveLength(labels.length);
      expect(labels.length).toBeGreaterThan(0);
    }
    const scripts = provideCommandCandidates({ ...base, commandLine: "pnpm run t", cursor: 11 });
    expect(scripts.map((candidate) => candidate.label)).toContain("test:unit");
  });

  it("uses the imported static Fig tracer rule without executing generators", () => {
    const labels = provideCommandCandidates({
      ...base,
      executables: [...base.executables, "docker"],
      commandLine: "docker bu",
      cursor: 9,
    }).map((candidate) => candidate.label);
    expect(labels).toContain("build");
  });

  it("bounds deterministic results and suppresses non-repeatable options already present", () => {
    const first = provideCommandCandidates({
      ...base,
      commandLine: "git commit --amend --",
      cursor: 22,
      limit: 4,
    });
    const second = provideCommandCandidates({
      ...base,
      commandLine: "git commit --amend --",
      cursor: 22,
      limit: 4,
    });
    expect(first).toEqual(second);
    expect(first).toHaveLength(4);
    expect(first.map((candidate) => candidate.label)).not.toContain("--amend");
  });
});
