import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  buildChatPath,
  buildThreadPath,
  getProjectActionsMenuPosition,
  getWorkspaceNavItems,
  ProjectActionsMenu,
  ProjectActionsTrigger,
  RenameProjectDialog,
} from "./SidebarNav";

describe("buildThreadPath", () => {
  it("builds the real thread route used by sidebar thread clicks", () => {
    expect(buildThreadPath("carrent", "thread-carrent-shared-workspace")).toBe(
      "/thread/carrent/thread-carrent-shared-workspace",
    );
  });
});

describe("buildChatPath", () => {
  it("builds the chat route used by sidebar chat clicks", () => {
    expect(buildChatPath("chat-1")).toBe("/chat/chat-1");
  });
});

describe("getWorkspaceNavItems", () => {
  it("keeps workspace utilities out of the primary nav", () => {
    expect(getWorkspaceNavItems()).toEqual([]);
  });
});

describe("getProjectActionsMenuPosition", () => {
  it("opens to the right of a collapsed-rail trigger when space exists", () => {
    expect(
      getProjectActionsMenuPosition(
        { left: 30, top: 40, right: 50, bottom: 60, width: 20, height: 20 },
        { width: 176, height: 128 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 58, top: 40 });
  });

  it("falls back left when the right side does not fit", () => {
    expect(
      getProjectActionsMenuPosition(
        { left: 220, top: 40, right: 240, bottom: 60, width: 20, height: 20 },
        { width: 176, height: 128 },
        { width: 400, height: 600 },
      ),
    ).toEqual({ left: 36, top: 40 });
  });

  it("clamps a menu near the viewport top and bottom", () => {
    const menuSize = { width: 176, height: 128 };
    const viewport = { width: 400, height: 300 };

    expect(
      getProjectActionsMenuPosition(
        { left: 30, top: -10, right: 50, bottom: 10, width: 20, height: 20 },
        menuSize,
        viewport,
      ),
    ).toEqual({ left: 58, top: 8 });
    expect(
      getProjectActionsMenuPosition(
        { left: 30, top: 290, right: 50, bottom: 310, width: 20, height: 20 },
        menuSize,
        viewport,
      ),
    ).toEqual({ left: 58, top: 164 });
  });
});

describe("project actions markup", () => {
  it("renders the existing actions with menu semantics", () => {
    const markup = renderToStaticMarkup(
      createElement(ProjectActionsMenu, {
        project: { id: "carrent", name: "Carrent", path: "/tmp/carrent" },
        onOpenInFinder: () => {},
        onRename: () => {},
        onCopyPath: () => {},
        onDelete: () => {},
      }),
    );

    expect(markup).toContain('role="menu"');
    expect((markup.match(/role="menuitem"/gu) ?? []).length).toBe(4);
    expect(markup).toContain("Open in Finder");
    expect(markup).toContain("Rename project");
    expect(markup).toContain("Copy path");
    expect(markup).toContain("Delete");
  });

  it("renders the collapsed action trigger with a project-specific accessible name", () => {
    const markup = renderToStaticMarkup(
      createElement(ProjectActionsTrigger, {
        projectName: "Carrent",
        collapsed: true,
        menuOpen: false,
        onClick: () => {},
      }),
    );

    expect(markup).toContain('aria-label="Project actions for Carrent"');
  });

  it("renders the rename dialog with the current name and commands", () => {
    const markup = renderToStaticMarkup(
      createElement(RenameProjectDialog, {
        projectName: "Carrent",
        value: "Carrent",
        onChange: () => {},
        onCancel: () => {},
        onSubmit: () => {},
      }),
    );

    expect(markup).toContain('aria-label="Rename Carrent"');
    expect(markup).toContain('value="Carrent"');
    expect(markup).toContain("Cancel");
    expect(markup).toContain("Rename");
  });
});
