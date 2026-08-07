import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import type { ChatPermissionRequest } from "../../../shared/chatPermissions";
import { getPlanDecisionOptions, PlanDecisionPanel } from "./PlanDecisionPanel";

const permission: ChatPermissionRequest = {
  id: "permission-plan",
  runId: "run-1",
  threadId: "thread-1",
  provider: "kimi",
  action: "unknown",
  title: "Review plan",
  options: [
    { optionId: "plan_opt_0", name: "Approach A", kind: "allow_once" },
    { optionId: "plan_opt_1", name: "Approach B", kind: "allow_once" },
    { optionId: "plan_revise", name: "Revise", kind: "reject_once" },
    {
      optionId: "plan_reject_and_exit",
      name: "Reject and Exit",
      kind: "reject_once",
    },
  ],
  planReview: { content: "# Plan" },
  createdAt: "2026-08-07T00:00:00.000Z",
  expiresAt: "2026-08-07T00:01:00.000Z",
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container?.remove();
  container = null;
  root = null;
});

async function mountPanel(
  onRespond: (optionId: string) => Promise<boolean>,
  onRequestRevision: (optionId: string, feedback: string) => Promise<boolean>,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <PlanDecisionPanel
        permission={permission}
        onRespond={onRespond}
        onRequestRevision={onRequestRevision}
      />,
    );
  });
}

function buttonNamed(name: string) {
  return [...container!.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(name),
  )!;
}

describe("PlanDecisionPanel", () => {
  it("maps native Kimi options onto plan decision roles", () => {
    const options = getPlanDecisionOptions(permission);

    expect(options.execution.map((option) => option.optionId)).toEqual([
      "plan_opt_0",
      "plan_opt_1",
    ]);
    expect(options.revise?.optionId).toBe("plan_revise");
    expect(options.exit?.optionId).toBe("plan_reject_and_exit");
  });

  it("presents approaches and user-facing plan actions without protocol wording", () => {
    const markup = renderToStaticMarkup(
      createElement(PlanDecisionPanel, {
        permission,
        onRespond: async () => true,
        onRequestRevision: async () => true,
      }),
    );

    expect(markup).toContain("Plan ready");
    expect(markup).toContain("Approach A");
    expect(markup).toContain("Approach B");
    expect(markup).toContain("Request changes");
    expect(markup).toContain("Run approach");
    expect(markup).toContain("Exit plan mode");
    expect(markup).not.toContain("Reject and Exit");
  });

  it("submits the selected approach through the native permission option", async () => {
    const responses: string[] = [];
    await mountPanel(
      async (optionId) => {
        responses.push(optionId);
        return true;
      },
      async () => true,
    );

    await act(async () => buttonNamed("Run approach").click());

    expect(responses).toEqual(["plan_opt_0"]);
  });

  it("collects feedback before requesting a revision", async () => {
    const revisions: Array<{ optionId: string; feedback: string }> = [];
    await mountPanel(
      async () => true,
      async (optionId, feedback) => {
        revisions.push({ optionId, feedback });
        return true;
      },
    );

    await act(async () => buttonNamed("Request changes").click());
    const textarea = container!.querySelector("textarea")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      textarea.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
      setValue.call(textarea, "Keep the current sidebar width.");
      textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
      textarea.dispatchEvent(new window.Event("change", { bubbles: true }));
      textarea.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: "a" }));
    });
    await act(async () => buttonNamed("Request revision").click());

    expect(revisions).toEqual([
      { optionId: "plan_revise", feedback: "Keep the current sidebar width." },
    ]);
  });
});
