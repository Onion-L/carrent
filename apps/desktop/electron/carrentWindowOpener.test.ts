import { describe, expect, it } from "bun:test";

import { openThreadInNewWindow } from "./carrentWindowOpener";

function createSource(overrides: Partial<{ destroyed: boolean }> = {}) {
  const errors: string[] = [];
  return {
    errors,
    source: {
      isDestroyed: () => overrides.destroyed ?? false,
      reportOpenError: (message: string) => errors.push(message),
    },
  };
}

describe("openThreadInNewWindow", () => {
  it("creates a new window with the given Thread route", () => {
    const created: string[] = [];
    const { source } = createSource();

    openThreadInNewWindow({
      route: "/workspace/w/project/p/thread/t",
      source: source,
      create: (route) => created.push(route),
    });

    expect(created).toEqual(["/workspace/w/project/p/thread/t"]);
  });

  it("rejects a malformed route before attempting to create a window", () => {
    const created: string[] = [];
    const { source, errors } = createSource();

    expect(() =>
      openThreadInNewWindow({
        route: 123,
        source,
        create: (route) => created.push(route),
      }),
    ).toThrow("Invalid Thread route.");

    expect(created).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("rejects an empty route", () => {
    const { source } = createSource();
    expect(() =>
      openThreadInNewWindow({ route: "", source, create: () => {} }),
    ).toThrow("Invalid Thread route.");
  });

  it("rejects an oversized route", () => {
    const { source } = createSource();
    expect(() =>
      openThreadInNewWindow({ route: `${"/a".repeat(2049)}`, source, create: () => {} }),
    ).toThrow("Invalid Thread route.");
  });

  it("leaves existing windows unchanged and reports a non-blocking error when creation fails", () => {
    const created: string[] = [];
    const { source, errors } = createSource();

    openThreadInNewWindow({
      route: "/workspace/w/project/p/thread/t",
      source,
      create: () => {
        throw new Error("BrowserWindow could not be created");
      },
    });

    // The create call ran (and threw); no other window was touched.
    expect(created).toEqual([]);
    expect(errors).toEqual(["BrowserWindow could not be created"]);
  });

  it("does not report an error when the source window is already destroyed", () => {
    const { source, errors } = createSource({ destroyed: true });

    openThreadInNewWindow({
      route: "/workspace/w/project/p/thread/t",
      source,
      create: () => {
        throw new Error("BrowserWindow could not be created");
      },
    });

    expect(errors).toEqual([]);
  });

  it("does not report an error when there is no source window", () => {
    openThreadInNewWindow({
      route: "/workspace/w/project/p/thread/t",
      source: null,
      create: () => {
        throw new Error("BrowserWindow could not be created");
      },
    });
    // No source to report to; existing windows are unchanged.
  });
});
