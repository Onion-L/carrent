import { describe, expect, it } from "bun:test";
import { getInitialReasoningBlockExpanded } from "./ReasoningBlock";

describe("ReasoningBlock", () => {
  it("is collapsed by default", () => {
    expect(getInitialReasoningBlockExpanded()).toBe(false);
  });
});
