import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  getThreadMenuPosition,
  ThreadContextMenuContent,
  type ThreadContextMenuContentProps,
} from "./ThreadContextMenu";

function renderMenu(overrides: Partial<ThreadContextMenuContentProps> = {}) {
  return renderToStaticMarkup(
    <ThreadContextMenuContent
      threadTitle="Fix sidebar"
      pinned={false}
      sessionId="session-1"
      archiveBlockedReason={null}
      onPin={() => {}}
      onRename={() => {}}
      onArchive={() => {}}
      onRevealInFinder={() => {}}
      onCopySessionId={() => {}}
      {...overrides}
    />,
  );
}

describe("getThreadMenuPosition", () => {
  it("keeps the menu inside the viewport", () => {
    expect(
      getThreadMenuPosition(
        { x: 295, y: 195 },
        { width: 120, height: 80 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ left: 172, top: 112 });
  });

  it("preserves the viewport margin at the top-left", () => {
    expect(
      getThreadMenuPosition(
        { x: 0, y: 0 },
        { width: 120, height: 80 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ left: 8, top: 8 });
  });
});

describe("ThreadContextMenuContent", () => {
  it("renders the five thread actions in order with one separator", () => {
    const markup = renderMenu();

    expect(markup).toContain('role="menu"');
    expect((markup.match(/role="menuitem"/gu) ?? []).length).toBe(5);
    expect((markup.match(/role="separator"/gu) ?? []).length).toBe(1);

    const pin = markup.indexOf("Pin thread");
    const rename = markup.indexOf("Rename thread");
    const archive = markup.indexOf("Archive thread");
    const reveal = markup.indexOf("Open in Finder");
    const copy = markup.indexOf("Copy session ID");
    expect(pin).toBeGreaterThan(-1);
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

  it("disables archiving with the blocked reason while a run is live", () => {
    const markup = renderMenu({ archiveBlockedReason: "Stop the live Run before archiving" });

    expect(markup).toContain('title="Stop the live Run before archiving"');
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
