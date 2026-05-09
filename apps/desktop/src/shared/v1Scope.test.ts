import { describe, expect, it } from "bun:test";

import { isAgentUiEnabled } from "./v1Scope";

describe("v1Scope", () => {
  it("keeps agent UI hidden for V1", () => {
    expect(isAgentUiEnabled()).toBe(false);
  });
});
