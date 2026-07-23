import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProviderSessionSnapshot } from "../../../shared/workspacePersistence";
import {
  getThreadContextMenuPosition,
  getThreadRuntimeSessionId,
  ThreadContextMenu,
} from "./ThreadHistoryPane";

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

describe("getThreadRuntimeSessionId", () => {
  const snapshot = {
    version: 1,
    sessions: {
      "kimi:project:/tmp/carrent:thread-1": "kimi-session",
      "codex:project:/tmp/carrent:thread-1": "codex-session",
    },
  } satisfies ProviderSessionSnapshot;

  it("uses the thread's selected runtime", () => {
    expect(
      getThreadRuntimeSessionId(snapshot, "/tmp/carrent", {
        id: "thread-1",
        title: "Test",
        updatedAt: "now",
        runtimeId: "codex",
      }),
    ).toBe("codex-session");
  });

  it("uses Kimi for threads without a persisted runtime", () => {
    expect(
      getThreadRuntimeSessionId(snapshot, "/tmp/carrent", {
        id: "thread-1",
        title: "Test",
        updatedAt: "now",
      }),
    ).toBe("kimi-session");
  });
});

describe("ThreadContextMenu", () => {
  it("renders only the requested copy actions", () => {
    const markup = renderToStaticMarkup(
      <ThreadContextMenu
        threadTitle="Fix sidebar"
        sessionId="session-1"
        onCopyProjectPath={() => {}}
        onCopySessionId={() => {}}
      />,
    );

    expect(markup).toContain('role="menu"');
    expect((markup.match(/role="menuitem"/gu) ?? []).length).toBe(2);
    expect(markup).toContain("Copy project path");
    expect(markup).toContain("Copy session ID");
    expect(markup).not.toContain("Archive");
    expect(markup).not.toContain("deep link");
  });

  it("disables session copying when no session exists", () => {
    const markup = renderToStaticMarkup(
      <ThreadContextMenu
        threadTitle="New thread"
        sessionId={null}
        onCopyProjectPath={() => {}}
        onCopySessionId={() => {}}
      />,
    );

    expect(markup).toContain('title="No session ID available"');
    expect(markup).toContain("disabled");
  });
});
