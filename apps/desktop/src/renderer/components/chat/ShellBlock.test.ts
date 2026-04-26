import { describe, expect, it } from "bun:test";

import { getInitialShellBlockExpanded } from "./ShellBlock";

describe("ShellBlock", () => {
  it("is collapsed by default", () => {
    expect(getInitialShellBlockExpanded()).toBe(false);
  });
});
