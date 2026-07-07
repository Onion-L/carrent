import { describe, expect, it } from "bun:test";

import { buildChatPath, buildThreadPath, getWorkspaceNavItems } from "./SidebarNav";

describe("buildThreadPath", () => {
  it("builds the real thread route used by sidebar thread clicks", () => {
    expect(buildThreadPath("carrent", "thread-carrent-shared-workspace")).toBe(
      "/thread/carrent/thread-carrent-shared-workspace",
    );
  });
});

describe("buildChatPath", () => {
  it("builds the chat route used by sidebar chat clicks", () => {
    expect(buildChatPath("chat-1")).toBe("/chat/chat-1");
  });
});

describe("getWorkspaceNavItems", () => {
  it("keeps workspace utilities out of the primary nav", () => {
    expect(getWorkspaceNavItems()).toEqual([]);
  });
});
