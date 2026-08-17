import { describe, expect, it } from "bun:test";
import { detectMonospaceFamily, queryInstalledFontFamilies } from "./localFonts";

describe("local font helpers", () => {
  it("deduplicates, filters, and sorts installed families", async () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        queryLocalFonts: async () => [
          { family: "Zed" },
          { family: ".Hidden" },
          { family: "Arial" },
          { family: "arial" },
        ],
      },
    });
    try {
      expect(await queryInstalledFontFamilies()).toEqual(["Arial", "arial", "Zed"]);
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    }
  });

  it("returns unknown when canvas measurement is unavailable", () => {
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: () => ({ getContext: () => null }) },
    });
    try {
      expect(detectMonospaceFamily("Fira Code")).toBe("unknown");
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  });
});
