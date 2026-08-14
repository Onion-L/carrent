import { describe, expect, it } from "bun:test";

import type { RevealPathResult } from "../../shared/localPathContext";

import { revealLocalPathContext } from "./revealLocalPathContext";

const item = {
  path: "/Users/test/My Notes (draft) [v2].md",
  basename: "My Notes (draft) [v2].md",
  kind: "file" as const,
};

function makeDeps(revealPath: (path: string) => Promise<RevealPathResult>) {
  const errors: string[] = [];
  const revealedPaths: string[] = [];
  return {
    errors,
    revealedPaths,
    deps: {
      revealPath: (path: string) => {
        revealedPaths.push(path);
        return revealPath(path);
      },
      showError: (message: string) => errors.push(message),
    },
  };
}

describe("revealLocalPathContext", () => {
  it("reveals the item path without reporting an error", async () => {
    const { errors, revealedPaths, deps } = makeDeps(async () => ({ revealed: true }));

    await revealLocalPathContext(item, deps);

    expect(revealedPaths).toEqual([item.path]);
    expect(errors).toEqual([]);
  });

  it("reports a missing path without throwing", async () => {
    const { errors, revealedPaths, deps } = makeDeps(async () => ({
      revealed: false,
      reason: "missing",
    }));

    await revealLocalPathContext(item, deps);

    expect(revealedPaths).toEqual([item.path]);
    expect(errors).toEqual([`Could not reveal “${item.basename}”: the path no longer exists.`]);
  });

  it("reports a bridge failure without throwing", async () => {
    const { errors, deps } = makeDeps(async () => {
      throw new Error("bridge is down");
    });

    await revealLocalPathContext(item, deps);

    expect(errors).toEqual([`Could not reveal “${item.basename}” in the file manager.`]);
  });
});
