import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatHeader } from "./ChatHeader";

function renderHeader(inspector?: Parameters<typeof ChatHeader>[0]["inspector"]) {
  return renderToStaticMarkup(<ChatHeader title="My thread" inspector={inspector} />);
}

describe("ChatHeader", () => {
  it("keeps the title centered and hides the toggle without inspector props", () => {
    const html = renderHeader();

    expect(html).toContain("text-center");
    expect(html).toContain("My thread");
    expect(html).not.toContain("aria-pressed");
  });

  it("renders an accessible icon-only Subagents toggle in the header's right side", () => {
    const html = renderHeader({ open: false, taskCount: 0, onToggle: () => {} });

    expect(html).toContain('aria-label="Toggle subagents pane"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('title="Subagents"');
    expect(html).toContain("lucide-users");
    expect(html).toContain("absolute inset-y-0 right-3");
    expect(html).toContain("focus-visible:ring-2");
    // The centered title is preserved beside the absolutely positioned toggle.
    expect(html).toContain("justify-center");
  });

  it("marks the toggle as selected when the inspector is open", () => {
    const html = renderHeader({ open: true, taskCount: 0, onToggle: () => {} });

    expect(html).toContain('aria-pressed="true"');
  });

  it("shows a compact count badge only when the task count is non-zero", () => {
    const withoutTasks = renderHeader({ open: false, taskCount: 0, onToggle: () => {} });
    expect(withoutTasks).not.toContain("rounded-full");

    const withTasks = renderHeader({ open: false, taskCount: 3, onToggle: () => {} });
    expect(withTasks).toContain("rounded-full");
    expect(withTasks).toContain(">3</span>");
  });
});
