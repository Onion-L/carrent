import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { getMenuPosition } from "./ContextMenu";
import { ThreadContextMenuContent, type ThreadContextMenuContentProps } from "./ThreadContextMenu";

function renderMenu(overrides: Partial<ThreadContextMenuContentProps> = {}) {
  return renderToStaticMarkup(
    <ThreadContextMenuContent
      threadTitle="Fix sidebar"
      pinned={false}
      sessionId="session-1"
      archiveBlockedReason={null}
      onOpenInNewWindow={() => {}}
      onPin={() => {}}
      onRename={() => {}}
      onArchive={() => {}}
      onRevealInFinder={() => {}}
      onCopySessionId={() => {}}
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
  it("renders the six thread actions in order with two separators", () => {
    const markup = renderMenu();

    expect(markup).toContain('role="menu"');
    expect((markup.match(/role="menuitem"/gu) ?? []).length).toBe(6);
    expect((markup.match(/role="separator"/gu) ?? []).length).toBe(2);

    const openInNewWindow = markup.indexOf("Open in new window");
    const pin = markup.indexOf("Pin thread");
    const rename = markup.indexOf("Rename thread");
    const archive = markup.indexOf("Archive thread");
    const reveal = markup.indexOf("Open in Finder");
    const copy = markup.indexOf("Copy session ID");
    expect(openInNewWindow).toBeGreaterThan(-1);
    expect(openInNewWindow).toBeLessThan(pin);
    expect(pin).toBeLessThan(rename);
    expect(rename).toBeLessThan(archive);
    expect(archive).toBeLessThan(reveal);
    expect(reveal).toBeLessThan(copy);
  });

  it("offers to unpin when the thread is pinned", () => {
    const markup = renderMenu({ pinned: true });

    expect(markup).toContain("Unpin thread");
    expect(markup).not.toContain("Pin thread");
  });

  it("disables archiving with the blocked reason while compacting", () => {
    const markup = renderMenu({
      archiveBlockedReason: "Wait for Compact to finish before archiving",
    });

    expect(markup).toContain('title="Wait for Compact to finish before archiving"');
    expect(markup).toContain("disabled");
  });

  it("disables session copying when no session exists", () => {
    const markup = renderMenu({ sessionId: null });

    expect(markup).toContain('title="No session ID available"');
    expect(markup).toContain("disabled");
  });

  it("shows a loading hint while the session ID loads", () => {
    const markup = renderMenu({ sessionId: undefined });

    expect(markup).toContain('title="Loading session ID"');
    expect(markup).toContain("disabled");
  });
});
