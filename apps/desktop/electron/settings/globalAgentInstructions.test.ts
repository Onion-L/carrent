import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GLOBAL_AGENT_INSTRUCTIONS_MAX_BYTES,
  getGlobalAgentInstructionsPath,
  readGlobalAgentInstructions,
  writeGlobalAgentInstructions,
} from "./globalAgentInstructions";

describe("global agent instructions", () => {
  it("returns an empty snapshot when ~/.agents/AGENTS.md does not exist", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "carrent-agents-home-"));

    try {
      const snapshot = await readGlobalAgentInstructions(homeDir);

      expect(snapshot).toEqual({
        path: path.join(homeDir, ".agents", "AGENTS.md"),
        content: "",
        exists: false,
        maxBytes: GLOBAL_AGENT_INSTRUCTIONS_MAX_BYTES,
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("creates ~/.agents/AGENTS.md when saving", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "carrent-agents-home-"));

    try {
      const snapshot = await writeGlobalAgentInstructions("- keep it simple\n", homeDir);
      const filePath = getGlobalAgentInstructionsPath(homeDir);

      expect(snapshot.exists).toBe(true);
      expect(snapshot.path).toBe(filePath);
      expect(await readFile(filePath, "utf8")).toBe("- keep it simple\n");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("rejects content larger than 256KB", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "carrent-agents-home-"));

    try {
      await writeGlobalAgentInstructions(
        "x".repeat(GLOBAL_AGENT_INSTRUCTIONS_MAX_BYTES + 1),
        homeDir,
      )
        .then(() => {
          throw new Error("Expected write to fail.");
        })
        .catch((error) => {
          expect((error as Error).message).toContain("256KB");
        });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
