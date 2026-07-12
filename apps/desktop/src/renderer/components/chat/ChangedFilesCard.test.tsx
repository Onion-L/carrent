import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChangedFilesCard } from "./ChangedFilesCard";
import type { ChangedFilesMessage } from "../../mock/uiShellData";

function renderCard(message: ChangedFilesMessage): string {
  return renderToStaticMarkup(<ChangedFilesCard message={message} />);
}

function makeMessage(overrides: Partial<ChangedFilesMessage> = {}): ChangedFilesMessage {
  return {
    id: "m1",
    role: "assistant",
    threadId: "t1",
    timestamp: "09:00",
    type: "changed_files",
    content: "Workspace changes",
    changedFiles: [
      { path: "a.txt", additions: 1, deletions: 0, binary: false, untracked: false },
    ],
    ...overrides,
  };
}

describe("ChangedFilesCard", () => {
  it("shows Workspace changes copy and an enabled View diff for a new snapshot", () => {
    const message = makeMessage({
      snapshot: {
        baseRevision: "abcdef1234567890",
        capturedAt: "2024-01-01T00:00:00.000Z",
        patch: "diff",
        truncated: false,
      },
    });
    const html = renderCard(message);
    expect(html).toContain("WORKSPACE CHANGES");
    expect(html).toContain("View diff");
    expect(html).not.toContain("Diff unavailable");
  });

  it("shows a disabled Diff unavailable control for a legacy message without a snapshot", () => {
    const message = makeMessage();
    const html = renderCard(message);
    expect(html).toContain("WORKSPACE CHANGES");
    expect(html).toContain("Diff unavailable");
    expect(html).not.toContain("View diff");
  });

  it("labels binary and omitted files", () => {
    const message = makeMessage({
      changedFiles: [
        { path: "image.png", additions: 0, deletions: 0, binary: true, untracked: false },
        { path: "huge.txt", additions: 0, deletions: 0, binary: false, untracked: true, omitted: true },
      ],
    });
    const html = renderCard(message);
    expect(html).toContain("Binary");
    expect(html).toContain("Omitted");
  });

  it("does not render misleading Agent attribution copy", () => {
    const message = makeMessage();
    const html = renderCard(message);
    expect(html).not.toContain("Agent changes");
    expect(html).not.toContain("Changes made by this run");
  });
});
