import { describe, expect, it } from "bun:test";
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
      onClose={() => {}}
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
    expect(html).toContain("Environment &amp; agents");
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
});

describe("shouldOpenDiffSurface", () => {
  it("only opens a diff for the current thread", () => {
    expect(shouldOpenDiffSurface("thread-1", "thread-1")).toBe(true);
    expect(shouldOpenDiffSurface("thread-1", "thread-2")).toBe(false);
    expect(shouldOpenDiffSurface(null, "thread-1")).toBe(false);
  });
});
