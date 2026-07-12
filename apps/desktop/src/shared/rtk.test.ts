import { describe, expect, it } from "bun:test";
import { getRtkAgentsBlock, upsertRtkAgentsBlock } from "./rtk";

const TEST_RTK_MD_PATH = "/Users/test/.agents/RTK.md";

describe("upsertRtkAgentsBlock", () => {
  it("adds the RTK block to empty content", () => {
    expect(upsertRtkAgentsBlock("", TEST_RTK_MD_PATH)).toBe(
      `${getRtkAgentsBlock(TEST_RTK_MD_PATH)}\n`,
    );
  });

  it("appends the RTK block without removing existing instructions", () => {
    expect(upsertRtkAgentsBlock("# Global\n\nBe concise.\n", TEST_RTK_MD_PATH)).toBe(
      `# Global\n\nBe concise.\n\n${getRtkAgentsBlock(TEST_RTK_MD_PATH)}\n`,
    );
  });

  it("replaces an existing managed RTK block", () => {
    const content = "# Global\n\n<!-- carrent:rtk:start -->\nold\n<!-- carrent:rtk:end -->\n";

    expect(upsertRtkAgentsBlock(content, TEST_RTK_MD_PATH)).toBe(
      `# Global\n\n${getRtkAgentsBlock(TEST_RTK_MD_PATH)}\n`,
    );
  });
});
