import { describe, it, expect } from "bun:test";
import {
  clearThreadDraft,
  enqueueChatMessage,
  getQueuedMessages,
  getThreadDraft,
  getThreadWorkSnapshot,
  getThreadWorkVersion,
  hydrateThreadWork,
  removeQueuedChatMessage,
  removeThreadWork,
  setThreadDraft,
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

describe("chatMessageQueue threadWork persistence", () => {
  const draft = (content: string) => ({
    content,
    attachedSkillNames: ["pdf"],
    attachments: [
      {
        id: "a1",
        kind: "image" as const,
        name: "screenshot.png",
        mimeType: "image/png",
        size: 1024,
        storageKey: "a1.png",
      },
    ],
  });

  it("hydrates queues and drafts, replacing stale in-memory state", () => {
    enqueueChatMessage("stale", makeItem("old"));
    setThreadDraft("stale", draft("old draft"));

    hydrateThreadWork({
      t10: {
        draft: draft("restored draft"),
        queuedMessages: [{ id: "q1", content: "recovered" }],
      },
    });

    expect(getQueuedMessages("stale")).toEqual([]);
    expect(getThreadDraft("stale")).toBe(null);
    expect(getQueuedMessages("t10")).toEqual([
      { id: "q1", content: "recovered", requiresConfirmation: true },
    ]);
    expect(getThreadDraft("t10")).toEqual(draft("restored draft"));

    removeThreadWork(["t10"]);
  });

  it("clears all state on an empty or missing snapshot load", () => {
    enqueueChatMessage("t11", makeItem("a"));
    setThreadDraft("t11", draft("draft"));

    hydrateThreadWork(undefined);

    expect(getQueuedMessages("t11")).toEqual([]);
    expect(getThreadDraft("t11")).toBe(null);
  });

  it("round-trips hydrated work through the snapshot getter", () => {
    hydrateThreadWork({
      t12: {
        draft: draft("keep me"),
        queuedMessages: [{ id: "q1", content: "recovered" }],
      },
    });

    expect(getThreadWorkSnapshot(["t12", "empty"])).toEqual({
      t12: {
        draft: draft("keep me"),
        queuedMessages: [{ id: "q1", content: "recovered", requiresConfirmation: true }],
      },
    });

    removeThreadWork(["t12"]);
  });

  it("returns a stable snapshot reference until the store changes", () => {
    setThreadDraft("t13", draft("draft"));
    const first = getThreadWorkSnapshot(["t13"]);
    expect(getThreadWorkSnapshot(["t13"])).toBe(first);

    setThreadDraft("t13", draft("changed"));
    const second = getThreadWorkSnapshot(["t13"]);
    expect(second).not.toBe(first);
    expect(second["t13"]?.draft?.content).toBe("changed");

    removeThreadWork(["t13"]);
  });

  it("returns copies so callers cannot mutate stored drafts", () => {
    setThreadDraft("t14", draft("draft"));

    const read = getThreadDraft("t14");
    read?.attachedSkillNames.push("mutated");
    read?.attachments.pop();

    expect(getThreadDraft("t14")).toEqual(draft("draft"));

    removeThreadWork(["t14"]);
  });

  it("sets, reads, and clears drafts per Thread", () => {
    setThreadDraft("t15", draft("one"));
    setThreadDraft("t16", draft("two"));

    expect(getThreadDraft("t15")?.content).toBe("one");
    expect(getThreadDraft("t16")?.content).toBe("two");

    clearThreadDraft("t15");
    expect(getThreadDraft("t15")).toBe(null);
    expect(getThreadDraft("t16")?.content).toBe("two");

    clearThreadDraft("t16");
    clearThreadDraft("t16");
    expect(getThreadDraft("t16")).toBe(null);
  });

  it("never auto-shifts a recovered head item but allows explicit removal", () => {
    hydrateThreadWork({
      t17: {
        queuedMessages: [
          { id: "recovered", content: "from disk" },
          { id: "behind", content: "also from disk" },
        ],
      },
    });

    expect(shiftQueuedChatMessage("t17")).toBe(null);
    expect(getQueuedMessages("t17").map((item) => item.id)).toEqual(["recovered", "behind"]);

    removeQueuedChatMessage("t17", "recovered");
    expect(getQueuedMessages("t17").map((item) => item.id)).toEqual(["behind"]);

    removeThreadWork(["t17"]);
  });

  it("shifts live items queued after recovery once the recovered head is removed", () => {
    hydrateThreadWork({
      t18: { queuedMessages: [{ id: "recovered", content: "from disk" }] },
    });
    enqueueChatMessage("t18", makeItem("live"));

    expect(shiftQueuedChatMessage("t18")).toBe(null);
    removeQueuedChatMessage("t18", "recovered");
    expect(shiftQueuedChatMessage("t18")?.id).toBe("live");
    expect(getQueuedMessages("t18")).toEqual([]);
  });

  it("supports edit and unshift on recovered items", () => {
    hydrateThreadWork({
      t19: { queuedMessages: [{ id: "recovered", content: "from disk" }] },
    });

    updateQueuedChatMessage("t19", "recovered", "edited");
    expect(getQueuedMessages("t19")[0]).toEqual({
      id: "recovered",
      content: "edited",
      requiresConfirmation: true,
    });

    removeQueuedChatMessage("t19", "recovered");
    unshiftQueuedChatMessage("t19", {
      id: "recovered",
      content: "edited",
      requiresConfirmation: true,
    });
    expect(getQueuedMessages("t19").map((item) => item.id)).toEqual(["recovered"]);

    removeThreadWork(["t19"]);
  });

  it("removeThreadWork clears both the queue and the draft", () => {
    enqueueChatMessage("t20", makeItem("a"));
    setThreadDraft("t20", draft("draft"));
    setThreadDraft("t21", draft("keep"));

    removeThreadWork(["t20"]);

    expect(getQueuedMessages("t20")).toEqual([]);
    expect(getThreadDraft("t20")).toBe(null);
    expect(getThreadDraft("t21")?.content).toBe("keep");

    removeThreadWork(["t21"]);
  });

  it("bumps the store version on queue and draft mutations", () => {
    const before = getThreadWorkVersion();
    setThreadDraft("t22", draft("draft"));
    const afterDraft = getThreadWorkVersion();
    enqueueChatMessage("t22", makeItem("a"));

    expect(afterDraft).toBeGreaterThan(before);
    expect(getThreadWorkVersion()).toBeGreaterThan(afterDraft);

    removeThreadWork(["t22"]);
  });
});
