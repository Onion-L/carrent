import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAgentTools } from "./tools";
import { canonicalizePath } from "./paths";

describe("agent tools", () => {
  it("edits an exact match and returns a diff", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "carrent-tools-"));
    await writeFile(path.join(directory, "example.txt"), "before\n", "utf8");
    const edit = createAgentTools(directory).find((tool) => tool.name === "edit")!;
    const result = await edit.execute("call-1", {
      path: "example.txt",
      oldText: "before",
      newText: "after",
    });

    expect(await readFile(path.join(directory, "example.txt"), "utf8")).toBe("after\n");
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("+after");
  });
});

describe("canonicalizePath", () => {
  it("supports multiple missing parent directories", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "carrent-paths-"));
    expect(await canonicalizePath(path.join(directory, "new", "nested", "file.txt"))).toBe(
      path.join(await realpath(directory), "new", "nested", "file.txt"),
    );
  });
});
