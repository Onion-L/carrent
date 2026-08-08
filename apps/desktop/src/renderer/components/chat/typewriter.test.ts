import { describe, expect, it } from "bun:test";

import {
  StreamingTextRevealer,
  getNextTypewriterText,
  getTypewriterCharsPerFrame,
  hasPendingTypewriterText,
  type StreamingTextRevealerOptions,
} from "./typewriter";

function createControllableFrames() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    requestFrame: (callback: () => void) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    },
    cancelFrame: (id: number) => {
      pending.delete(id);
    },
    runFrame: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
    hasScheduledFrame: () => pending.size > 0,
  };
}

function createRevealer(
  options: { revealAll?: boolean } & Partial<StreamingTextRevealerOptions> = {},
) {
  const { revealAll, ...revealerOptions } = options;
  const frames = createControllableFrames();
  const revealed: string[] = [];
  const revealer = new StreamingTextRevealer({
    onReveal: (text) => revealed.push(text),
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    ...(revealAll ? { shouldRevealAll: () => true } : {}),
    ...revealerOptions,
  });
  return { frames, revealed, revealer, visibleText: () => revealed.join("") };
}

describe("getNextTypewriterText", () => {
  it("advances a small backlog by a readable amount", () => {
    const next = getNextTypewriterText("", "hello world");
    expect(next.length).toBeGreaterThan(0);
    expect(next.length).toBeLessThan("hello world".length);
    expect("hello world".startsWith(next)).toBe(true);
  });

  it("reveals large backlogs faster per frame than small ones", () => {
    const smallStep = getNextTypewriterText("", "x".repeat(40)).length;
    const largeStep = getNextTypewriterText("", "x".repeat(4000)).length;
    expect(largeStep).toBeGreaterThan(smallStep);
  });

  it("never overshoots the received text", () => {
    expect(getNextTypewriterText("hell", "hello")).toBe("hello");
  });

  it("reconciles immediately when the received text is not a prefix extension", () => {
    expect(getNextTypewriterText("hello extra", "hello")).toBe("hello");
    expect(getNextTypewriterText("hello", "goodbye")).toBe("goodbye");
  });
});

describe("getTypewriterCharsPerFrame", () => {
  it("scales with the pending backlog", () => {
    expect(getTypewriterCharsPerFrame(10_000)).toBeGreaterThan(getTypewriterCharsPerFrame(10));
  });
});

describe("hasPendingTypewriterText", () => {
  it("detects pending received text", () => {
    expect(hasPendingTypewriterText("he", "hello")).toBe(true);
    expect(hasPendingTypewriterText("hello", "hello")).toBe(false);
  });
});

describe("StreamingTextRevealer", () => {
  it("coalesces multiple deltas into at most one reveal per frame", () => {
    const { frames, revealed, revealer } = createRevealer();

    revealer.appendDelta("hello");
    revealer.appendDelta(" ");
    revealer.appendDelta("world");
    expect(revealed).toEqual([]);

    frames.runFrame();
    expect(revealed.length).toBe(1);
  });

  it("reveals received text progressively as a growing prefix", () => {
    const { frames, revealed, revealer, visibleText } = createRevealer();
    const fullText = "The quick brown fox jumps over the lazy dog.".repeat(3);

    revealer.appendDelta(fullText);
    const snapshots: string[] = [];
    while (frames.hasScheduledFrame()) {
      frames.runFrame();
      snapshots.push(visibleText());
    }

    expect(snapshots.length).toBeGreaterThan(1);
    for (let index = 1; index < snapshots.length; index += 1) {
      expect(snapshots[index]!.startsWith(snapshots[index - 1]!)).toBe(true);
      expect(snapshots[index]!.length).toBeGreaterThan(snapshots[index - 1]!.length);
    }
    expect(visibleText()).toBe(fullText);
    expect(revealed.join("")).toBe(fullText);
  });

  it("catches up a large backlog in fewer frames per character than a small one", () => {
    const countFrames = (text: string) => {
      const { frames, revealer } = createRevealer();
      revealer.appendDelta(text);
      let frameCount = 0;
      while (frames.hasScheduledFrame()) {
        frames.runFrame();
        frameCount += 1;
      }
      return frameCount;
    };

    const smallText = "s".repeat(30);
    const largeText = "l".repeat(30_000);
    expect(countFrames(largeText) / largeText.length).toBeLessThan(
      countFrames(smallText) / smallText.length,
    );
  });

  it("flush reveals everything immediately and stops scheduling", () => {
    const { frames, revealer, visibleText } = createRevealer();

    revealer.appendDelta("buffered answer text");
    revealer.flush();

    expect(visibleText()).toBe("buffered answer text");
    expect(frames.hasScheduledFrame()).toBe(false);

    frames.runFrame();
    expect(visibleText()).toBe("buffered answer text");
  });

  it("flush on an empty revealer does not emit", () => {
    const { revealed, revealer } = createRevealer();
    revealer.flush();
    expect(revealed).toEqual([]);
  });

  it("a snapshot atomically replaces the buffer and cancels stale scheduling", () => {
    const { frames, revealed, revealer, visibleText } = createRevealer();

    revealer.appendDelta("stale incremental text");
    revealer.applySnapshot("authoritative replacement");

    expect(frames.hasScheduledFrame()).toBe(false);
    frames.runFrame();
    expect(revealed).toEqual([]);
    expect(visibleText()).toBe("");

    revealer.appendDelta(" plus more");
    while (frames.hasScheduledFrame()) frames.runFrame();
    expect(revealed.join("")).toBe(" plus more");
  });

  it("finish animates a small remaining backlog and converges to the exact final text", () => {
    const { frames, revealer, visibleText } = createRevealer();

    revealer.appendDelta("short final answer");
    revealer.flush();
    revealer.appendDelta("tail");
    revealer.finish("short final answertail");

    expect(frames.hasScheduledFrame()).toBe(true);
    while (frames.hasScheduledFrame()) frames.runFrame();
    expect(visibleText()).toBe("short final answertail");
  });

  it("finish reveals a huge remaining backlog immediately instead of animating", () => {
    const { frames, revealer, visibleText } = createRevealer();
    const finalText = "x".repeat(100_000);

    revealer.finish(finalText);

    expect(visibleText()).toBe(finalText);
    expect(frames.hasScheduledFrame()).toBe(false);
  });

  it("finish adopts the authoritative final text when the buffer is empty", () => {
    const { frames, revealer, visibleText } = createRevealer();
    revealer.finish("complete answer");
    while (frames.hasScheduledFrame()) frames.runFrame();
    expect(visibleText()).toBe("complete answer");
  });

  it("reduced motion reveals all received text on the next frame", () => {
    const { frames, revealer, visibleText } = createRevealer({ revealAll: true });

    revealer.appendDelta("a");
    revealer.appendDelta("b".repeat(500));
    frames.runFrame();

    expect(visibleText()).toBe(`a${"b".repeat(500)}`);
    expect(frames.hasScheduledFrame()).toBe(false);
  });

  it("dispose cancels a scheduled frame without revealing", () => {
    const { frames, revealed, revealer } = createRevealer();

    revealer.appendDelta("pending");
    revealer.dispose();

    expect(frames.hasScheduledFrame()).toBe(false);
    frames.runFrame();
    expect(revealed).toEqual([]);
  });
});
