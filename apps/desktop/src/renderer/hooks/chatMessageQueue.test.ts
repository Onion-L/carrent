import { describe, it, expect } from "bun:test";
import {
  enqueueChatMessage,
  getQueuedMessages,
  removeQueuedChatMessage,
  shiftQueuedChatMessage,
  unshiftQueuedChatMessage,
  updateQueuedChatMessage,
  type QueuedChatMessage,
} from "./chatMessageQueue";

function makeItem(id: string, content = `msg ${id}`): QueuedChatMessage {
  return { id, content };
}

describe("chatMessageQueue", () => {
  it("enqueues and shifts in FIFO order", () => {
    enqueueChatMessage("t1", makeItem("a"));
    enqueueChatMessage("t1", makeItem("b"));

    expect(getQueuedMessages("t1").map((item) => item.id)).toEqual(["a", "b"]);
    expect(shiftQueuedChatMessage("t1")?.id).toBe("a");
    expect(shiftQueuedChatMessage("t1")?.id).toBe("b");
    expect(shiftQueuedChatMessage("t1")).toBe(null);
    expect(getQueuedMessages("t1")).toEqual([]);
  });

  it("removes a specific item without disturbing order", () => {
    enqueueChatMessage("t2", makeItem("a"));
    enqueueChatMessage("t2", makeItem("b"));
    enqueueChatMessage("t2", makeItem("c"));

    removeQueuedChatMessage("t2", "b");

    expect(getQueuedMessages("t2").map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("keeps queues isolated per thread", () => {
    enqueueChatMessage("t3", makeItem("a"));
    enqueueChatMessage("t4", makeItem("b"));

    expect(getQueuedMessages("t3").map((item) => item.id)).toEqual(["a"]);
    expect(getQueuedMessages("t4").map((item) => item.id)).toEqual(["b"]);
    expect(getQueuedMessages("unknown")).toEqual([]);

    removeQueuedChatMessage("t3", "a");
    removeQueuedChatMessage("t4", "b");
  });

  it("returns a stable empty reference for threads without a queue", () => {
    expect(getQueuedMessages("nope")).toBe(getQueuedMessages("nope"));
  });

  it("unshifts an item back to the front", () => {
    enqueueChatMessage("t5", makeItem("b"));
    unshiftQueuedChatMessage("t5", makeItem("a"));

    expect(getQueuedMessages("t5").map((item) => item.id)).toEqual(["a", "b"]);

    removeQueuedChatMessage("t5", "a");
    removeQueuedChatMessage("t5", "b");
  });

  it("updates an item's content in place", () => {
    enqueueChatMessage("t6", makeItem("a"));
    enqueueChatMessage("t6", makeItem("b"));

    updateQueuedChatMessage("t6", "b", "edited");
    updateQueuedChatMessage("t6", "missing", "ignored");

    expect(getQueuedMessages("t6")).toEqual([
      { id: "a", content: "msg a" },
      { id: "b", content: "edited" },
    ]);

    removeQueuedChatMessage("t6", "a");
    removeQueuedChatMessage("t6", "b");
  });

  it("does not shift a blocked head item", () => {
    enqueueChatMessage("t7", makeItem("a"));
    enqueueChatMessage("t7", makeItem("b"));

    expect(shiftQueuedChatMessage("t7", { blockedId: "a" })).toBe(null);
    expect(getQueuedMessages("t7").map((item) => item.id)).toEqual(["a", "b"]);

    removeQueuedChatMessage("t7", "a");
    removeQueuedChatMessage("t7", "b");
  });

  it("retains mixed attachment metadata unchanged", () => {
    const attachments = [
      {
        id: "a1",
        kind: "image" as const,
        name: "screenshot.png",
        mimeType: "image/png",
        size: 1024,
        storageKey: "a1.png",
      },
      {
        id: "a2",
        kind: "file" as const,
        name: "main.ts",
        mimeType: "text/plain",
        size: 512,
        storageKey: "a2.ts",
      },
    ];

    enqueueChatMessage("t8", { id: "a", content: "msg a", attachments });

    expect(getQueuedMessages("t8")[0]?.attachments).toEqual(attachments);
    expect(shiftQueuedChatMessage("t8")?.attachments).toEqual(attachments);
    expect(getQueuedMessages("t8")).toEqual([]);
  });
});
