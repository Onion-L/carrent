import { describe, expect, it } from "bun:test";

import {
  getCascadingPanelPosition,
  getActionablePermissionsForThread,
  getDisplayRuntimeModel,
  getPermissionDetail,
  getRuntimeModelIdForSend,
  shouldSubmitComposerOnKeyDown,
  storeImageAttachmentFile,
} from "./Composer";
import type { ChatPermissionRequest } from "../../../shared/chatPermissions";

const piModels = [
  {
    id: "deepseek/deepseek-v4-flash",
    name: "deepseek-v4-flash",
    provider: "deepseek",
    source: "cli" as const,
  },
  {
    id: "minimax-cn/MiniMax-M2.7",
    name: "MiniMax-M2.7",
    provider: "minimax-cn",
    source: "cli" as const,
  },
];

describe("shouldSubmitComposerOnKeyDown", () => {
  it("submits on plain Enter", () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: "Enter",
        shiftKey: false,
        nativeEvent: {},
      }),
    ).toBe(true);
  });

  it("does not submit on Shift+Enter", () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: "Enter",
        shiftKey: true,
        nativeEvent: {},
      }),
    ).toBe(false);
  });

  it("does not submit while IME composition is active", () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true },
      }),
    ).toBe(false);
  });

  it("does not submit IME keydown events reported as keyCode 229", () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: "Enter",
        shiftKey: false,
        keyCode: 229,
        nativeEvent: {},
      }),
    ).toBe(false);
  });

  it("does not submit non-Enter keys", () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: "a",
        shiftKey: false,
        nativeEvent: {},
      }),
    ).toBe(false);
  });
});

describe("getCascadingPanelPosition", () => {
  const panelSize = { width: 240, height: 180 };

  it("places the panel on the right when there is enough space", () => {
    expect(
      getCascadingPanelPosition(
        { left: 100, top: 80, right: 260, bottom: 112, width: 160, height: 32 },
        { width: 800, height: 600 },
        panelSize,
      ),
    ).toEqual({
      left: 268,
      top: 80,
      width: 240,
      side: "right",
    });
  });

  it("places the panel on the left when the right side is too narrow", () => {
    expect(
      getCascadingPanelPosition(
        { left: 520, top: 80, right: 680, bottom: 112, width: 160, height: 32 },
        { width: 700, height: 600 },
        panelSize,
      ),
    ).toEqual({
      left: 272,
      top: 80,
      width: 240,
      side: "left",
    });
  });

  it("keeps the panel inside the viewport when both sides are narrow", () => {
    const result = getCascadingPanelPosition(
      { left: 95, top: 80, right: 205, bottom: 112, width: 110, height: 32 },
      { width: 300, height: 600 },
      { width: 360, height: 180 },
    );

    expect(result).toEqual({
      left: 8,
      top: 80,
      width: 284,
      side: "center",
    });
    expect(result.left >= 8).toBe(true);
    expect(result.left + result.width <= 292).toBe(true);
  });

  it("corrects vertical overflow at the bottom and top", () => {
    expect(
      getCascadingPanelPosition(
        { left: 100, top: 520, right: 260, bottom: 552, width: 160, height: 32 },
        { width: 800, height: 600 },
        panelSize,
      ).top,
    ).toBe(412);

    expect(
      getCascadingPanelPosition(
        { left: 100, top: -20, right: 260, bottom: 12, width: 160, height: 32 },
        { width: 800, height: 600 },
        panelSize,
      ).top,
    ).toBe(8);
  });
});

describe("getDisplayRuntimeModel", () => {
  it("uses the explicit model when one is selected", () => {
    expect(
      getDisplayRuntimeModel({
        models: piModels,
        runtimeModelId: "minimax-cn/MiniMax-M2.7",
        defaultModelId: "deepseek/deepseek-v4-flash",
      }),
    ).toEqual(piModels[1]);
  });

  it("does not display the local CLI default model when no explicit model is selected", () => {
    expect(
      getDisplayRuntimeModel({
        models: piModels,
        runtimeModelId: undefined,
        defaultModelId: "deepseek/deepseek-v4-flash",
      }),
    ).toBeUndefined();
  });
});

describe("getRuntimeModelIdForSend", () => {
  it("does not send the local CLI default as an explicit model override", () => {
    expect(
      getRuntimeModelIdForSend({
        runtimeModelId: undefined,
        defaultModelId: "deepseek/deepseek-v4-flash",
      }),
    ).toBeUndefined();
  });

  it("sends an explicitly selected model", () => {
    expect(
      getRuntimeModelIdForSend({
        runtimeModelId: "minimax-cn/MiniMax-M2.7",
        defaultModelId: "deepseek/deepseek-v4-flash",
      }),
    ).toBe("minimax-cn/MiniMax-M2.7");
  });
});

describe("getActionablePermissionsForThread", () => {
  const kimiPermission: ChatPermissionRequest = {
    id: "perm-kimi",
    runId: "run-1",
    threadId: "thread-1",
    provider: "kimi",
    action: "shell",
    title: "Run command: pwd",
    command: "pwd",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:01:00.000Z",
  };

  it("returns only Kimi permissions for the current thread", () => {
    expect(
      getActionablePermissionsForThread({
        threadId: "thread-1",
        pendingPermissions: [
          kimiPermission,
          {
            ...kimiPermission,
            id: "perm-other-thread",
            threadId: "thread-2",
          },
          {
            ...kimiPermission,
            id: "perm-legacy",
            provider: "claude-code",
          },
        ],
      }),
    ).toEqual([kimiPermission]);
  });
});

describe("getPermissionDetail", () => {
  it("prefers command details", () => {
    expect(
      getPermissionDetail({
        id: "perm-kimi",
        runId: "run-1",
        threadId: "thread-1",
        provider: "kimi",
        action: "shell",
        title: "Run command",
        command: "pwd",
        description: "fallback",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:01:00.000Z",
      }),
    ).toBe("pwd");
  });
});

describe("storeImageAttachmentFile", () => {
  it("reports a clear error when the preload attachment bridge is missing", async () => {
    const file = new File(["hello"], "test.png", { type: "image/png" });

    try {
      await storeImageAttachmentFile(file, undefined);
      throw new Error("Expected storeImageAttachmentFile to reject.");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe(
        "Image attachments are unavailable. Restart Carrent and try again.",
      );
    }
  });

  it("stores file bytes through the preload attachment bridge", async () => {
    const file = new File(["hello"], "test.png", { type: "image/png" });
    let stored: { name: string; mimeType: string; data: Uint8Array } | undefined;

    const metadata = await storeImageAttachmentFile(file, {
      store: async (input: { name: string; mimeType: string; data: Uint8Array }) => {
        stored = input;
        return {
          id: "attachment-1",
          name: input.name,
          mimeType: input.mimeType,
          size: input.data.byteLength,
          storageKey: "attachment-1.png",
        };
      },
    });

    expect(stored?.name).toBe("test.png");
    expect(stored?.mimeType).toBe("image/png");
    expect(Array.from(stored?.data ?? [])).toEqual([104, 101, 108, 108, 111]);
    expect(metadata.storageKey).toBe("attachment-1.png");
  });
});
