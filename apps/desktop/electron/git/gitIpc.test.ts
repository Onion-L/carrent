import { describe, expect, it } from "bun:test";

import { registerGitIpc } from "./gitIpc";

describe("registerGitIpc", () => {
  it("registers git:branches and git:checkout handlers", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

    registerGitIpc({
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    });

    expect(handlers.has("git:branches")).toBe(true);
    expect(handlers.has("git:checkout")).toBe(true);
  });

  it("rejects git:branches when projectPath is missing", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

    registerGitIpc({
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    });

    const branchesHandler = handlers.get("git:branches")!;
    try {
      await branchesHandler({}, undefined);
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toBe("Project path is required.");
    }
  });

  it("rejects git:checkout when projectPath or branch is missing", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

    registerGitIpc({
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    });

    const checkoutHandler = handlers.get("git:checkout")!;
    try {
      await checkoutHandler({}, "/path");
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toBe("Project path and branch are required.");
    }
  });
});
