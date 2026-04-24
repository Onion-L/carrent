import { describe, it, expect } from "bun:test";
import { splitProjectThreads } from "./projectThreads";
import type { ThreadRecord } from "../mock/uiShellData";

function makeThread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: "t",
    title: "Thread",
    updatedAt: "1h ago",
    ...overrides,
  };
}

describe("splitProjectThreads", () => {
  it("sorts pinned threads ahead of regular threads", () => {
    const threads = [
      makeThread({ id: "a", title: "Regular A" }),
      makeThread({ id: "b", title: "Pinned B", pinned: true }),
      makeThread({ id: "c", title: "Regular C" }),
      makeThread({ id: "d", title: "Pinned D", pinned: true }),
    ];

    const { active } = splitProjectThreads(threads);
    expect(active.map((t) => t.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("omits archived threads from the active list", () => {
    const threads = [
      makeThread({ id: "a", title: "Active A" }),
      makeThread({ id: "b", title: "Archived B", archived: true }),
      makeThread({ id: "c", title: "Active C" }),
    ];

    const { active } = splitProjectThreads(threads);
    expect(active.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("returns archived threads separately", () => {
    const threads = [
      makeThread({ id: "a", title: "Active A" }),
      makeThread({ id: "b", title: "Archived B", archived: true }),
      makeThread({ id: "c", title: "Archived C", archived: true }),
    ];

    const { archived } = splitProjectThreads(threads);
    expect(archived.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("keeps original order within pinned and regular groups", () => {
    const threads = [
      makeThread({ id: "p2", title: "Pinned 2", pinned: true }),
      makeThread({ id: "r1", title: "Regular 1" }),
      makeThread({ id: "p1", title: "Pinned 1", pinned: true }),
      makeThread({ id: "r2", title: "Regular 2" }),
    ];

    const { active } = splitProjectThreads(threads);
    expect(active.map((t) => t.id)).toEqual(["p2", "p1", "r1", "r2"]);
  });
});
