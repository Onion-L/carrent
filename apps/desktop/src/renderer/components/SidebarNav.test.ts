import { describe, expect, it } from "bun:test";

import { buildThreadPath } from "./SidebarNav";

describe("buildThreadPath", () => {
  it("builds the real thread route used by sidebar thread clicks", () => {
    expect(buildThreadPath("carrent", "thread-carrent-shared-workspace")).toBe(
      "/thread/carrent/thread-carrent-shared-workspace",
    );
  });
});
