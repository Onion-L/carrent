import { describe, expect, it } from "bun:test";
import { RTK_AGENTS_BLOCK, upsertRtkAgentsBlock } from "./rtk";

describe("upsertRtkAgentsBlock", () => {
  it("adds the RTK block to empty content", () => {
    expect(upsertRtkAgentsBlock("")).toBe(`${RTK_AGENTS_BLOCK}\n`);
  });

  it("appends the RTK block without removing existing instructions", () => {
    expect(upsertRtkAgentsBlock("# Global\n\nBe concise.\n")).toBe(
      `# Global\n\nBe concise.\n\n${RTK_AGENTS_BLOCK}\n`,
    );
  });

  it("replaces an existing managed RTK block", () => {
    const content = "# Global\n\n<!-- carrent:rtk:start -->\nold\n<!-- carrent:rtk:end -->\n";

    expect(upsertRtkAgentsBlock(content)).toBe(`# Global\n\n${RTK_AGENTS_BLOCK}\n`);
  });
});
