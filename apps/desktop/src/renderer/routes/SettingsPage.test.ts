import { afterEach, describe, expect, it } from "bun:test";

import "../test/registerHappyDom";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  FontFamilyInput,
  DefaultEditorControl,
  formatGlobalAgentInstructionsSize,
  getGlobalAgentInstructionsByteLength,
  readGlobalAgentInstructions,
  readRtkGainStats,
  revealInFinder,
  writeGlobalAgentInstructions,
  writeGlobalRtkInstructions,
} from "./SettingsPage";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderFontFamilyInput(onChange: (value: string) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(
      createElement(FontFamilyInput, {
        value: "Geist",
        label: "Font family",
        onChange,
      }),
    );
  });

  return container.querySelector<HTMLInputElement>("#font-family-input")!;
}

async function renderDefaultEditorControl(onChange: (value: string) => void) {
  window.carrent = {
    editors: {
      list: async () => [
        { id: "cursor", name: "Cursor", appPath: "/Applications/Cursor.app" },
        {
          id: "vscode",
          name: "VS Code",
          appPath: "/Applications/Visual Studio Code.app",
        },
      ],
      open: async () => "",
    },
  } as unknown as Window["carrent"];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(
      createElement(DefaultEditorControl, {
        defaultEditorId: "vscode",
        onChange,
      }),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function typeIntoInput(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  input.focus();
  setter.call(input, text);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: text.at(-1) }));
}

describe("Font family setting", () => {
  it("discards an uncommitted draft when Escape is pressed", async () => {
    const changes: string[] = [];
    const input = await renderFontFamilyInput((value) => changes.push(value));

    await act(async () => {
      typeIntoInput(input, "Inter");
    });
    expect(input.value).toBe("Inter");

    await act(async () => {
      input.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    });

    expect(changes).toEqual([]);
    expect(input.value).toBe("Geist");
  });
});

describe("Default editor setting", () => {
  it("shows installed editors and updates the selection", async () => {
    const changes: string[] = [];
    await renderDefaultEditorControl((value) => changes.push(value));

    const trigger = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Default editor"]',
    )!;
    expect(trigger.textContent).toContain("VS Code");
    expect(trigger.querySelector("img")).not.toBeNull();

    await act(async () => trigger.click());
    const options = container!.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options).toHaveLength(2);
    expect(Array.from(options).every((option) => option.querySelector("img"))).toBe(true);
    const cursorOption = Array.from(options).find((button) =>
      button.textContent?.includes("Cursor"),
    )!;
    await act(async () => cursorOption.click());

    expect(changes).toEqual(["cursor"]);
  });
});

describe("readRtkGainStats", () => {
  it("returns a restart hint when the current preload does not expose RTK stats", async () => {
    const stats = await readRtkGainStats({});

    expect(stats.available).toBe(false);
    expect(stats.error).toContain("Restart Carrent");
  });

  it("returns RTK stats from the preload API when available", async () => {
    const stats = await readRtkGainStats({
      rtkGain: async () => ({
        available: true,
        totalCommands: 12,
        inputTokens: 1000,
        outputTokens: 200,
        tokensSaved: 800,
        efficiency: 80,
        lastCheckedAt: "2026-07-05T00:00:00.000Z",
      }),
    });

    expect(stats.available).toBe(true);
    expect(stats.tokensSaved).toBe(800);
  });
});

describe("revealInFinder", () => {
  it("returns a restart hint when the preload does not expose revealPath", async () => {
    await revealInFinder({}, "/Users/test/.agents/AGENTS.md")
      .then(() => {
        throw new Error("Expected reveal to fail.");
      })
      .catch((error) => {
        expect((error as Error).message).toContain("Restart Carrent");
      });
  });

  it("reveals the file in Finder through the preload API", async () => {
    const revealed: string[] = [];

    await revealInFinder(
      {
        revealPath: async (filePath) => {
          revealed.push(filePath);
        },
      },
      "/Users/test/.agents/AGENTS.md",
    );

    expect(revealed).toEqual(["/Users/test/.agents/AGENTS.md"]);
  });
});

describe("global agent instructions helpers", () => {
  it("measures utf-8 byte length", () => {
    expect(getGlobalAgentInstructionsByteLength("abc")).toBe(3);
    expect(getGlobalAgentInstructionsByteLength("你好")).toBe(6);
  });

  it("formats byte counts", () => {
    expect(formatGlobalAgentInstructionsSize(512)).toBe("512B");
    expect(formatGlobalAgentInstructionsSize(1536)).toBe("1.5KB");
  });

  it("returns a restart hint when preload does not expose global instructions", async () => {
    await readGlobalAgentInstructions({})
      .then(() => {
        throw new Error("Expected read to fail.");
      })
      .catch((error) => {
        expect((error as Error).message).toContain("Restart Carrent");
      });

    await writeGlobalAgentInstructions({}, "")
      .then(() => {
        throw new Error("Expected write to fail.");
      })
      .catch((error) => {
        expect((error as Error).message).toContain("Restart Carrent");
      });

    await writeGlobalRtkInstructions({}, "")
      .then(() => {
        throw new Error("Expected write to fail.");
      })
      .catch((error) => {
        expect((error as Error).message).toContain("Restart Carrent");
      });
  });

  it("forwards reads and writes to the preload API", async () => {
    const snapshot = {
      path: "/Users/test/.agents/AGENTS.md",
      content: "- concise\n",
      exists: true,
      maxBytes: 262144,
    };
    const writes: string[] = [];

    expect(
      await readGlobalAgentInstructions({
        readGlobalAgentInstructions: async () => snapshot,
      }),
    ).toEqual(snapshot);

    expect(
      await writeGlobalAgentInstructions(
        {
          writeGlobalAgentInstructions: async (content) => {
            writes.push(content);
            return { ...snapshot, content };
          },
        },
        "- simple\n",
      ),
    ).toEqual({ ...snapshot, content: "- simple\n" });
    expect(writes).toEqual(["- simple\n"]);
  });

  it("forwards RTK writes to the preload API", async () => {
    const writes: string[] = [];

    expect(
      await writeGlobalRtkInstructions(
        {
          writeGlobalRtkInstructions: async (content) => {
            writes.push(content);
            return { path: "/Users/test/.agents/RTK.md", content };
          },
        },
        "# RTK\n",
      ),
    ).toEqual({ path: "/Users/test/.agents/RTK.md", content: "# RTK\n" });
    expect(writes).toEqual(["# RTK\n"]);
  });
});
