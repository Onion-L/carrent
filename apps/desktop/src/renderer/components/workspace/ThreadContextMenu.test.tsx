import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { getMenuPosition } from "./ContextMenu";
import { ThreadContextMenuContent, type ThreadContextMenuContentProps } from "./ThreadContextMenu";

function renderMenu(overrides: Partial<ThreadContextMenuContentProps> = {}) {
  return renderToStaticMarkup(
    <ThreadContextMenuContent
      threadTitle="Fix sidebar"
      pinned={false}
      archiveBlockedReason={null}
      onOpenInNewWindow={() => {}}
      onPin={() => {}}
      onRename={() => {}}
      onArchive={() => {}}
      onRevealInFinder={() => {}}
      {...overrides}
    />,
  );
}

describe("getMenuPosition", () => {
  it("keeps the menu inside the viewport", () => {
    expect(
      getMenuPosition({ x: 295, y: 195 }, { width: 120, height: 80 }, { width: 300, height: 200 }),
    ).toEqual({ left: 172, top: 112 });
  });

  it("preserves the viewport margin at the top-left", () => {
    expect(
      getMenuPosition({ x: 0, y: 0 }, { width: 120, height: 80 }, { width: 300, height: 200 }),
    ).toEqual({ left: 8, top: 8 });
  });
});

describe("ThreadContextMenuContent", () => {
  it("renders the five thread actions in order with two separators", () => {
    const markup = renderMenu();

    expect(markup).toContain('role="menu"');
    expect((markup.match(/role="menuitem"/gu) ?? []).length).toBe(5);
    expect((markup.match(/role="separator"/gu) ?? []).length).toBe(2);

    const openInNewWindow = markup.indexOf("Open in new window");
    const pin = markup.indexOf("Pin thread");
    const rename = markup.indexOf("Rename thread");
    const archive = markup.indexOf("Archive thread");
    const reveal = markup.indexOf("Open in Finder");
    expect(openInNewWindow).toBeGreaterThan(-1);
    expect(openInNewWindow).toBeLessThan(pin);
    expect(pin).toBeLessThan(rename);
    expect(rename).toBeLessThan(archive);
    expect(archive).toBeLessThan(reveal);
  });

  it("offers to unpin when the thread is pinned", () => {
    const markup = renderMenu({ pinned: true });

    expect(markup).toContain("Unpin thread");
    expect(markup).not.toContain("Pin thread");
  });

  it("disables archiving with the supplied blocked reason", () => {
    const markup = renderMenu({
      archiveBlockedReason: "Wait for the Run to finish before archiving",
    });

    expect(markup).toContain('title="Wait for the Run to finish before archiving"');
    expect(markup).toContain("disabled");
  });
});
