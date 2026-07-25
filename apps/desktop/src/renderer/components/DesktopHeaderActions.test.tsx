import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DESKTOP_HEADER_ACTIONS_ID, DesktopHeaderActionsSlot } from "./DesktopHeaderActions";

describe("DesktopHeaderActionsSlot", () => {
  it("renders the titlebar slot the portal targets", () => {
    const html = renderToStaticMarkup(<DesktopHeaderActionsSlot />);

    expect(html).toContain(`id="${DESKTOP_HEADER_ACTIONS_ID}"`);
    expect(html).toContain("flex h-full items-center");
  });
});
