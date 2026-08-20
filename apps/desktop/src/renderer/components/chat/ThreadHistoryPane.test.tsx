import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { getThreadContextMenuPosition, ThreadContextMenu } from "./ThreadHistoryPane";

describe("getThreadContextMenuPosition", () => {
  it("keeps the menu inside the viewport", () => {
    expect(
      getThreadContextMenuPosition(
        { x: 295, y: 195 },
        { width: 120, height: 80 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ left: 172, top: 112 });
  });

  it("preserves the viewport margin at the top-left", () => {
    expect(
      getThreadContextMenuPosition(
        { x: 0, y: 0 },
        { width: 120, height: 80 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ left: 8, top: 8 });
  });
});

describe("ThreadContextMenu", () => {
  it("renders only the project path action", () => {
    const markup = renderToStaticMarkup(
      <ThreadContextMenu threadTitle="Fix sidebar" onCopyProjectPath={() => {}} />,
    );

    expect(markup).toContain('role="menu"');
    expect((markup.match(/role="menuitem"/gu) ?? []).length).toBe(1);
    expect(markup).toContain("Copy project path");
    expect(markup).not.toContain("Archive");
    expect(markup).not.toContain("deep link");
  });
});
