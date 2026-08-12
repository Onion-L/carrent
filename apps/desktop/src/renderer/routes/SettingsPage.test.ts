import { afterEach, describe, expect, it } from "bun:test";

import "../test/registerHappyDom";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FontFamilyInput,
  KimiConnectionCheckError,
  KimiCliSetupNotice,
  ThreadTitleModelControl,
  canCheckKimiConnection,
  formatGlobalAgentInstructionsSize,
  getGlobalAgentInstructionsByteLength,
  getRuntimeVersionLabel,
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

const kimiModel = {
  id: "kimi-k2.5",
  name: "Kimi K2.5",
  source: "cli" as const,
};
const kimiK3Model = {
  id: "kimi-k3",
  name: "Kimi K3",
  source: "cli" as const,
};

function renderThreadTitleModelControl(
  overrides: Partial<Parameters<typeof ThreadTitleModelControl>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(ThreadTitleModelControl, {
      threadTitleModelId: undefined,
      models: [kimiModel],
      defaultModelId: undefined,
      loading: false,
      error: undefined,
      onChange: () => {},
      onRefresh: () => {},
      ...overrides,
    }),
  );
}

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

function typeIntoInput(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  input.focus();
  setter.call(input, text);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: text.at(-1) }));
}

describe("Thread title model setting", () => {
  it("follows the live Kimi default model when unset, tagged (default)", () => {
    const markup = renderThreadTitleModelControl({
      models: [kimiModel, kimiK3Model],
      defaultModelId: kimiK3Model.id,
    });
    expect(markup).toContain("Thread title model");
    expect(markup).toContain("Kimi K3 (default)");
    expect(markup).toContain("<title>Kimi</title>");
    expect(markup).toContain("w-[200px]");
    expect(markup).toContain("h-4 w-4");
    expect(markup).toContain("whitespace-nowrap");
  });

  it("shows a pinned concrete model without the default tag", () => {
    const markup = renderThreadTitleModelControl({
      threadTitleModelId: kimiModel.id,
      models: [kimiModel, kimiK3Model],
      defaultModelId: kimiK3Model.id,
    });
    expect(markup).toContain("Kimi K2.5");
    expect(markup).not.toContain("Kimi K2.5 (default)");
  });

  it("keeps an unavailable saved concrete model visible", () => {
    const markup = renderThreadTitleModelControl({
      threadTitleModelId: "kimi-removed",
      models: [],
    });
    expect(markup).toContain("kimi-removed (unavailable)");
  });

  it("shows catalog loading and failure states", () => {
    expect(renderThreadTitleModelControl({ models: [], loading: true })).toContain(
      "Loading Kimi models…",
    );

    const failed = renderThreadTitleModelControl({
      models: [],
      error: "Authentication required",
    });
    expect(failed).toContain("Kimi model catalog unavailable");
    expect(failed).toContain('aria-label="Retry loading Kimi models"');
    expect(failed).toContain('title="Authentication required"');
  });
});

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

describe("canCheckKimiConnection", () => {
  it("requires the detected Kimi command and configured runtime", () => {
    expect(
      canCheckKimiConnection({
        id: "kimi",
        availability: "detected",
        configuration: "configured",
      }),
    ).toBe(true);
    expect(
      canCheckKimiConnection({
        id: "kimi",
        availability: "unavailable",
        configuration: "unknown",
      }),
    ).toBe(false);
    expect(
      canCheckKimiConnection({
        id: "kimi",
        availability: "detected",
        configuration: "missing",
      }),
    ).toBe(false);
  });
});

describe("Kimi CLI setup guidance", () => {
  it("replaces the unknown version and explains how to finish setup when Kimi is unavailable", () => {
    const runtime = {
      id: "kimi" as const,
      availability: "unavailable" as const,
    };

    expect(getRuntimeVersionLabel(runtime)).toBe("Not installed");

    const markup = renderToStaticMarkup(createElement(KimiCliSetupNotice, { runtime }));
    expect(markup).toContain("Kimi CLI was not detected on this computer.");
    expect(markup).toContain("Download and install Kimi Code");
    expect(markup).toContain("sign in before checking again");
  });

  it("keeps the setup guidance hidden when Kimi is detected", () => {
    const runtime = {
      id: "kimi" as const,
      availability: "detected" as const,
      version: "1.2.3",
    };

    expect(getRuntimeVersionLabel(runtime)).toBe("1.2.3");
    expect(renderToStaticMarkup(createElement(KimiCliSetupNotice, { runtime }))).toBe("");
  });
});

describe("Kimi connection check", () => {
  it("shows the model-list error when Kimi is no longer signed in", () => {
    const markup = renderToStaticMarkup(
      createElement(KimiConnectionCheckError, {
        runtimeId: "kimi",
        error: "Authentication required. Run `kimi login`.",
      }),
    );

    expect(markup).toContain("Authentication required. Run `kimi login`.");
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
