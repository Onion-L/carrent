import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { ThreadRunChecklist } from "../../../shared/runChecklist";
import { getRunChecklistProgress, RunChecklist } from "./RunChecklist";

const checklist: ThreadRunChecklist = {
  runId: "run-1",
  runtimeId: "kimi",
  outcome: "running",
  expanded: true,
  entries: [
    { content: "Inspect the existing flow", status: "completed" },
    { content: "Implement the checklist", status: "in_progress" },
    { content: "Run verification", status: "pending" },
  ],
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderChecklist(
  value: ThreadRunChecklist,
  onExpandedChange: (expanded: boolean) => void = () => {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RunChecklist checklist={value} onExpandedChange={onExpandedChange} />);
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

describe("getRunChecklistProgress", () => {
  it("uses the first active position, completed count, zero, and total", () => {
    expect(getRunChecklistProgress(checklist.entries)).toBe(2);
    expect(
      getRunChecklistProgress([
        { content: "One", status: "completed" },
        { content: "Two", status: "pending" },
      ]),
    ).toBe(1);
    expect(getRunChecklistProgress([{ content: "One", status: "pending" }])).toBe(0);
    expect(getRunChecklistProgress([{ content: "One", status: "completed" }])).toBe(1);
    expect(
      getRunChecklistProgress([
        { content: "One", status: "completed" },
        { content: "Two", status: "in_progress" },
        { content: "Three", status: "in_progress" },
      ]),
    ).toBe(2);
  });
});

describe("RunChecklist", () => {
  it("renders ordered item states and an accessible disclosure", async () => {
    await renderChecklist(checklist);

    const button = container!.querySelector("button")!;
    expect(button.textContent).toContain("Step 2 of 3");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container!.querySelector('[role="list"]')?.textContent).toContain(
      "Inspect the existing flow",
    );
    expect(container!.textContent).toContain("Completed");
    expect(container!.textContent).toContain("In progress");
    expect(container!.textContent).toContain("Pending");
    expect(container!.querySelectorAll("li")).toHaveLength(3);
  });

  it("requests disclosure changes without making items interactive", async () => {
    const changes: boolean[] = [];
    await renderChecklist(checklist, (expanded) => changes.push(expanded));

    await act(async () => container!.querySelector("button")!.click());

    expect(changes).toEqual([false]);
    expect(container!.querySelectorAll("li button")).toHaveLength(0);
  });

  it("shows terminal outcome text and keeps the list internally scrollable", async () => {
    await renderChecklist({ ...checklist, outcome: "failed" });

    expect(container!.textContent).toContain("Run failed");
    expect(container!.querySelector('[role="list"]')?.className).toContain("overflow-y-auto");
    expect(container!.querySelector('[role="list"]')?.className).toContain("max-h-");
  });
});
