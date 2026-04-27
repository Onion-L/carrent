import { describe, expect, it } from "bun:test";

import { buildChatPath, buildDraftPath, buildThreadPath } from "./SidebarNav";

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

describe("buildDraftPath", () => {
  it("builds the draft route used by sidebar draft creation", () => {
    expect(buildDraftPath("draft-123")).toBe("/draft/draft-123");
    expect(buildDraftPath("draft-123")).not.toBe(
      "/thread/carrent/thread-draft-123",
    );
  });
});
