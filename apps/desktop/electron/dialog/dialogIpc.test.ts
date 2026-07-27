import { describe, expect, it } from "bun:test";

import { registerDialogIpc } from "./dialogIpc";

describe("registerDialogIpc", () => {
  it("canonicalizes selected directory paths before returning them", async () => {
    const handlers = new Map<string, () => unknown>();
    registerDialogIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      async () => ({ canceled: false, filePaths: ["/linked/project"] }),
      async (filePath, ...extraArguments: unknown[]) => {
        expect(extraArguments).toEqual([]);
        return `/real${filePath}`;
      },
    );

    expect(await handlers.get("dialog:open-directory")?.()).toEqual({
      canceled: false,
      filePaths: ["/real/linked/project"],
    });
  });

  it("propagates canonicalization failures", async () => {
    const handlers = new Map<string, () => unknown>();
    registerDialogIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      async () => ({ canceled: false, filePaths: ["/missing/project"] }),
      async () => {
        throw new Error("directory disappeared");
      },
    );

    let error: unknown;
    try {
      await handlers.get("dialog:open-directory")?.();
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toContain("directory disappeared");
  });
});
