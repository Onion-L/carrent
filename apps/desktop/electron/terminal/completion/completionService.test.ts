import { describe, expect, it } from "bun:test";

import { createTerminalCompletionService } from "./completionService";

describe("TerminalCompletionService", () => {
  it("discovers bounded local PATH, directory, shell-symbol, and package-script candidates", async () => {
    const service = createTerminalCompletionService({
      readDirectory: async (path) => {
        if (path === "/bin")
          return [
            { name: "git", directory: false },
            { name: "gh", directory: false },
          ];
        if (path === "/work/carrent") {
          return [
            { name: "src", directory: true },
            { name: "package.json", directory: false },
          ];
        }
        if (path === "/work/carrent/src") {
          return [
            { name: "foo.ts", directory: false },
            { name: "fixtures", directory: true },
          ];
        }
        return [];
      },
      readTextFile: async (path) =>
        path === "/work/carrent/package.json"
          ? JSON.stringify({ scripts: { build: "vite build", test: "bun test" } })
          : "",
    });

    const executableResult = await service.complete({
      commandLine: "g",
      cursor: 1,
      cwd: "/work/carrent",
      path: "/bin",
      aliases: ["gst"],
      functions: ["gco"],
    });
    expect(executableResult.map((candidate) => candidate.label)).toEqual([
      "gco",
      "getopts",
      "gh",
      "git",
      "gst",
    ]);

    const scriptResult = await service.complete({
      commandLine: "bun run b",
      cursor: 9,
      cwd: "/work/carrent",
      path: "/bin",
      aliases: [],
      functions: [],
    });
    expect(scriptResult.map((candidate) => candidate.label)).toContain("build");

    const nestedPathResult = await service.complete({
      commandLine: "cat src/fo",
      cursor: 10,
      cwd: "/work/carrent",
      path: "/bin",
      aliases: [],
      functions: [],
    });
    expect(nestedPathResult.find((candidate) => candidate.label === "src/foo.ts")).toMatchObject({
      insertText: "src/foo.ts",
      replacement: { start: 4, end: 10 },
    });
  });

  it("ignores malformed or oversized package manifests and unreadable directories", async () => {
    const service = createTerminalCompletionService({
      readDirectory: async () => {
        throw new Error("denied");
      },
      readTextFile: async () => "{".repeat(300_000),
    });
    expect(
      await service.complete({
        commandLine: "npm run ",
        cursor: 8,
        cwd: "/private",
        path: "/missing",
        aliases: [],
        functions: [],
      }),
    ).toEqual([]);
  });
});
