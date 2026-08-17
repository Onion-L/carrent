import { describe, expect, it } from "bun:test";
import "../../test/registerHappyDom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import { RightSurfacePane, shouldOpenDiffSurface } from "./RightSurfacePane";

function renderPane(
  availability: Parameters<typeof RightSurfacePane>[0]["availability"] = {
    browser: true,
    terminal: true,
    changes: true,
    inspector: true,
  },
) {
  return renderToStaticMarkup(
    <RightSurfacePane
      activeSurface="chooser"
      availability={availability}
      width={null}
      onWidthChange={() => {}}
      onSelect={() => {}}
    />,
  );
}

describe("RightSurfacePane", () => {
  it("starts with a panel chooser instead of browser content", () => {
    const html = renderPane();

    expect(html).toContain("Open a panel");
    expect(html).toContain("Browser");
    expect(html).toContain("Terminal");
    expect(html).toContain("Changes");
    expect(html).toContain("Subagents");
  });

  it("keeps unavailable surfaces visible and disabled", () => {
    const html = renderPane({
      browser: true,
      terminal: true,
      changes: false,
      inspector: true,
    });

    expect(html).toContain('title="Changes unavailable"');
    expect(html).toContain("disabled");
  });

  it("starts collapsing immediately while retaining its content", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = {
      availability: { browser: true, terminal: true, changes: true, inspector: true },
      width: 480,
      onWidthChange: () => {},
      onSelect: () => {},
    };

    try {
      await act(async () => root.render(<RightSurfacePane {...props} activeSurface="chooser" />));
      expect(container.querySelector<HTMLElement>('[aria-label="Right panel"]')?.style.width).toBe(
        "480px",
      );

      await act(async () => root.render(<RightSurfacePane {...props} activeSurface={null} />));

      expect(container.querySelector<HTMLElement>('[aria-label="Right panel"]')?.style.width).toBe(
        "0px",
      );
      expect(container.textContent).toContain("Open a panel");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

describe("shouldOpenDiffSurface", () => {
  it("only opens a diff for the current thread", () => {
    expect(shouldOpenDiffSurface("thread-1", "thread-1")).toBe(true);
    expect(shouldOpenDiffSurface("thread-1", "thread-2")).toBe(false);
    expect(shouldOpenDiffSurface(null, "thread-1")).toBe(false);
  });
});
