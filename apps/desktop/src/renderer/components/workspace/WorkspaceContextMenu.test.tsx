import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WorkspaceContextMenuContent,
  type WorkspaceContextMenuContentProps,
} from "./WorkspaceContextMenu";

function renderMenu(overrides: Partial<WorkspaceContextMenuContentProps> = {}) {
  return renderToStaticMarkup(
    <WorkspaceContextMenuContent
      workspaceName="Design"
      deleteBlockedReason={null}
      onRename={() => {}}
      onDelete={() => {}}
      {...overrides}
    />,
  );
}

describe("WorkspaceContextMenuContent", () => {
  it("renders the rename and delete actions in order with one separator", () => {
    const markup = renderMenu();

    expect(markup).toContain('role="menu"');
    expect(markup).toContain(`Workspace actions for Design`);
    expect((markup.match(/role="menuitem"/gu) ?? []).length).toBe(2);
    expect((markup.match(/role="separator"/gu) ?? []).length).toBe(1);

    const rename = markup.indexOf("Rename Workspace");
    const remove = markup.indexOf("Delete Workspace");
    expect(rename).toBeGreaterThan(-1);
    expect(rename).toBeLessThan(remove);
  });

  it("disables deletion with the blocked reason while a run is live", () => {
    const markup = renderMenu({
      deleteBlockedReason: "Stop the affected live Run before deleting",
    });

    expect(markup).toContain('title="Stop the affected live Run before deleting"');
    expect(markup).toContain('disabled=""');
  });

  it("keeps deletion enabled when nothing blocks it", () => {
    const markup = renderMenu();

    expect(markup).not.toContain('disabled=""');
  });
});
