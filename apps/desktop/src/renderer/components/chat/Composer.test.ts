import { describe, expect, it } from "bun:test";

import {
  getCascadingPanelPosition,
  getActionablePermissionsForThread,
  buildSkillReference,
  filterSkillsForQuery,
  formatSkillLabel,
  getGitBridge,
  getGitToastMessage,
  getDisplayRuntimeModel,
  getPermissionDetail,
  getRuntimeModelIdForSend,
  getSkillSlashTrigger,
  normalizeGitBranchInfo,
  replaceSkillSlashTrigger,
  shouldSubmitComposerOnKeyDown,
  storeImageAttachmentFile,
} from "./Composer";
import type { ChatPermissionRequest } from "../../../shared/chatPermissions";
import type { SkillRecord } from "../../../shared/skills";

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

describe("normalizeGitBranchInfo", () => {
  it("accepts valid branch info", () => {
    expect(normalizeGitBranchInfo({ current: "main", branches: ["main", "feature"] })).toEqual({
      current: "main",
      branches: ["main", "feature"],
      branchWorktrees: [],
    });
  });

  it("accepts branch worktree metadata", () => {
    expect(
      normalizeGitBranchInfo({
        current: "main",
        branches: ["main", "feature"],
        branchWorktrees: [{ branch: "feature", path: "/tmp/feature" }],
      }),
    ).toEqual({
      current: "main",
      branches: ["main", "feature"],
      branchWorktrees: [{ branch: "feature", path: "/tmp/feature" }],
    });
  });

  it("reports a clear error when the git bridge returns no branch info", () => {
    try {
      normalizeGitBranchInfo(undefined);
      throw new Error("Expected normalizeGitBranchInfo to reject.");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Git branch information is unavailable. Restart Carrent and try again.");
    }
  });

  it("reports a clear error when the git bridge returns malformed branch info", () => {
    try {
      normalizeGitBranchInfo({ current: "main" });
      throw new Error("Expected normalizeGitBranchInfo to reject.");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Git branch information is unavailable. Restart Carrent and try again.");
    }
  });

  it("reports a clear error when branch worktree metadata is malformed", () => {
    try {
      normalizeGitBranchInfo({
        current: "main",
        branches: ["main"],
        branchWorktrees: [{ branch: "feature" }],
      });
      throw new Error("Expected normalizeGitBranchInfo to reject.");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Git branch information is unavailable. Restart Carrent and try again.");
    }
  });
});

describe("getGitBridge", () => {
  it("accepts the preload git bridge", async () => {
    const git = getGitBridge({
      git: {
        branches: async () => ({ current: "main", branches: ["main"] }),
        checkout: async () => ({ current: "feature", branches: ["main", "feature"] }),
      },
    });

    expect(await git.branches("/repo")).toEqual({ current: "main", branches: ["main"] });
  });

  it("reports a clear error when the preload git bridge is missing", () => {
    try {
      getGitBridge({});
      throw new Error("Expected getGitBridge to reject.");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Git controls are unavailable. Restart Carrent and try again.");
    }
  });
});

describe("getGitToastMessage", () => {
  it("summarizes dirty worktree checkout errors", () => {
    expect(
      getGitToastMessage(
        new Error(
          "Error invoking remote method 'git:checkout': Error: Command failed: git checkout codex/polish error: Your local changes to the following files would be overwritten by checkout: apps/desktop/electron/git/gitIpc.ts Please commit your changes or stash them before you switch branches. Aborting",
        ),
      ),
    ).toBe("Cannot switch branches because you have local changes. Commit or stash them first.");
  });

  it("removes the Electron git IPC prefix from readable errors", () => {
    expect(
      getGitToastMessage(
        new Error(
          "Error invoking remote method 'git:checkout': Error: Branch \"feature\" is already checked out at /tmp/feature.",
        ),
      ),
    ).toBe('Branch "feature" is already checked out at /tmp/feature.');
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

describe("skill slash helpers", () => {
  const skills: SkillRecord[] = [
    {
      name: "grilling",
      description: "Interview the user relentlessly.",
      path: "/Users/test/.agents/skills/grilling/SKILL.md",
      source: "agents",
    },
    {
      name: "browser:control-in-app-browser",
      description: "Control the in-app Browser.",
      path: "/Users/test/.codex/plugins/cache/browser/SKILL.md",
      source: "plugin",
    },
    {
      name: "openai-docs",
      description: "Use official OpenAI docs.",
      path: "/Users/test/.codex/skills/openai-docs/SKILL.md",
      source: "codex",
    },
    {
      name: "diagnosing-bugs",
      description: "Diagnose bugs and performance regressions.",
      path: "/Users/test/.agents/skills/diagnosing-bugs/SKILL.md",
      source: "agents",
    },
  ];

  it("finds a slash token at the cursor", () => {
    expect(getSkillSlashTrigger("/", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(getSkillSlashTrigger("use /grill please", 10)).toEqual({
      start: 4,
      end: 10,
      query: "grill",
    });
    expect(getSkillSlashTrigger("use /Users/test", 15)).toEqual(null);
  });

  it("filters skills by name, label, and description", () => {
    expect(filterSkillsForQuery(skills, "grill").map((skill) => skill.name)).toEqual(["grilling"]);
    expect(filterSkillsForQuery(skills, "browser").map((skill) => skill.name)).toEqual([
      "browser:control-in-app-browser",
    ]);
    expect(filterSkillsForQuery(skills, "official").map((skill) => skill.name)).toEqual([
      "openai-docs",
    ]);
  });

  it("treats spaces and hyphens as equivalent for multi-word skill names", () => {
    expect(filterSkillsForQuery(skills, "diagnosing-bugs").map((skill) => skill.name)).toEqual([
      "diagnosing-bugs",
    ]);
    expect(filterSkillsForQuery(skills, "diagnosing bugs").map((skill) => skill.name)).toEqual([
      "diagnosing-bugs",
    ]);
    expect(filterSkillsForQuery(skills, "diagnosingbugs").map((skill) => skill.name)).toEqual([]);
  });

  it("formats and inserts the selected skill reference", () => {
    const trigger = getSkillSlashTrigger("please /grill now", 13);
    expect(trigger).toEqual({ start: 7, end: 13, query: "grill" });

    expect(formatSkillLabel("browser:control-in-app-browser")).toBe(
      "Browser: Control In App Browser",
    );
    expect(buildSkillReference(skills[0])).toBe(
      "[$grilling](/Users/test/.agents/skills/grilling/SKILL.md)",
    );
    expect(replaceSkillSlashTrigger("please /grill now", trigger!, skills[0])).toBe(
      "please [$grilling](/Users/test/.agents/skills/grilling/SKILL.md) now",
    );
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
      expect(message).toBe("Image attachments are unavailable. Restart Carrent and try again.");
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
