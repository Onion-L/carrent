import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { JsonTree, toStructuredJson } from "./DebugTimeline";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("Runtime Debug structured JSON", () => {
  it("parses JSON strings and rejects plain text", () => {
    expect(toStructuredJson('{"tools":[{"name":"terminal/create"}]}')).toEqual({
      ok: true,
      value: { tools: [{ name: "terminal/create" }] },
    });
    expect(toStructuredJson("terminal output")).toEqual({ ok: false });
  });

  it("renders complete values and toggles nested containers", async () => {
    const longDescription = "Complete description ".repeat(40);
    const parsed = toStructuredJson({
      tools: [{ name: "terminal/create", details: { description: longDescription } }],
    });
    if (!parsed.ok) throw new Error("Expected structured JSON");

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(<JsonTree value={parsed.value} />));

    const toolButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand JSON root.tools[0]"]',
    );
    expect(toolButton?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain(longDescription);

    await act(async () => toolButton?.click());
    expect(toolButton?.getAttribute("aria-expanded")).toBe("true");

    const detailsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand JSON root.tools[0].details"]',
    );
    await act(async () => detailsButton?.click());
    expect(container.textContent).toContain(longDescription);
  });
});
