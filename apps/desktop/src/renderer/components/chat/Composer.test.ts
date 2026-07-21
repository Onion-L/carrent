import { describe, expect, it } from "bun:test";

import {
  PLAN_REVIEW_FOLLOW_UP_TEXT,
  getCascadingPanelPosition,
  getActionablePermissionsForThread,
  buildSkillReference,
  createWorkspaceDiffCapture,
  filterSkillsForQuery,
  formatKimiModelLabel,
  formatSkillLabel,
  getComposerRuntimeLabel,
  getGitBridge,
  getGitToastMessage,
  getDisplayRuntimeModel,
  getMessageTranscriptContent,
  getPermissionDetail,
  getPlanSubmissionState,
  getRuntimeModelIdForSend,
  getRuntimeSelectionLabel,
  getSkillSlashTrigger,
  getChatHistoryMode,
  mergeComposerDraftContent,
  normalizeGitBranchInfo,
  replaceSkillSlashTrigger,
  shouldShowPlanSlashSuggestion,
  shouldRemoveLastSkillOnBackspace,
  supportsRuntimeModelSelection,
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

describe("mergeComposerDraftContent", () => {
  const incoming = "Follow up on this workspace diff review.\n\nSelected changes:\n- Entire file";

  it("uses the incoming draft when the Composer is empty", () => {
    expect(mergeComposerDraftContent("", incoming)).toBe(incoming);
  });

  it("replaces whitespace-only Composer content", () => {
    expect(mergeComposerDraftContent(" \n\t ", incoming)).toBe(incoming);
  });

  it("preserves existing content with exactly two separating newlines", () => {
    expect(mergeComposerDraftContent("Existing request", incoming)).toBe(
      `Existing request\n\n${incoming}`,
    );
  });

  it("removes trailing whitespace before adding exactly one blank line", () => {
    expect(mergeComposerDraftContent("Existing request  \n", incoming)).toBe(
      `Existing request\n\n${incoming}`,
    );
  });

  it("keeps incoming multiline content unchanged", () => {
    expect(mergeComposerDraftContent("", incoming)).toBe(incoming);
    expect(mergeComposerDraftContent("", incoming).split("\n")).toEqual(incoming.split("\n"));
  });
});

describe("supportsRuntimeModelSelection", () => {
  it("supports model selection for Kimi and pi runtimes", () => {
    expect(supportsRuntimeModelSelection("kimi")).toBe(true);
    expect(supportsRuntimeModelSelection("pi")).toBe(true);
    expect(supportsRuntimeModelSelection("codex")).toBe(false);
    expect(supportsRuntimeModelSelection("claude-code")).toBe(false);
  });
});

describe("getChatHistoryMode", () => {
  it("maps a normal submit to continue", () => {
    expect(getChatHistoryMode(false)).toBe("continue");
  });

  it("maps an edited-message submit to replace", () => {
    expect(getChatHistoryMode(true)).toBe("replace");
  });
});

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

describe("shouldRemoveLastSkillOnBackspace", () => {
  it("removes the last skill when the caret is at the start", () => {
    expect(
      shouldRemoveLastSkillOnBackspace({
        key: "Backspace",
        isComposing: false,
        selectionStart: 0,
        selectionEnd: 0,
        attachedSkillCount: 1,
      }),
    ).toBe(true);
  });

  it("keeps skills while editing text or composing", () => {
    expect(
      shouldRemoveLastSkillOnBackspace({
        key: "Backspace",
        isComposing: false,
        selectionStart: 1,
        selectionEnd: 1,
        attachedSkillCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldRemoveLastSkillOnBackspace({
        key: "Backspace",
        isComposing: true,
        selectionStart: 0,
        selectionEnd: 0,
        attachedSkillCount: 1,
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

  it("sends an explicitly selected Kimi model", () => {
    expect(
      getRuntimeModelIdForSend({
        runtimeId: "kimi",
        runtimeModelId: "kimi-code/kimi-for-coding-highspeed",
      }),
    ).toBe("kimi-code/kimi-for-coding-highspeed");
  });
});

describe("getComposerRuntimeLabel", () => {
  it("uses the product label for the Kimi coding runtime", () => {
    expect(getComposerRuntimeLabel({ id: "kimi", name: "Kimi Code" })).toBe("Kimi for coding");
  });

  it("uses the runtime name for non-Kimi runtimes", () => {
    expect(getComposerRuntimeLabel({ id: "codex", name: "Codex" })).toBe("Codex");
  });
});

describe("formatKimiModelLabel", () => {
  it("formats Kimi model ids for the primary selector", () => {
    expect(formatKimiModelLabel("kimi-for-coding")).toBe("Kimi for Coding");
    expect(formatKimiModelLabel("kimi-for-coding-highspeed")).toBe("Kimi for Coding High Speed");
  });
});

describe("getRuntimeSelectionLabel", () => {
  it("shows only the model name for Kimi", () => {
    expect(
      getRuntimeSelectionLabel({
        runtimeId: "kimi",
        runtimeName: "Kimi Code",
        modelName: "kimi-for-coding-highspeed",
      }),
    ).toBe("kimi-for-coding-highspeed");
  });

  it("keeps the runtime prefix for other runtimes", () => {
    expect(
      getRuntimeSelectionLabel({
        runtimeId: "pi",
        runtimeName: "pi",
        modelName: "deepseek-v4-flash",
      }),
    ).toBe("pi · deepseek-v4-flash");
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
        createBranch: async () => ({
          current: "carrent/feature",
          branches: ["main", "carrent/feature"],
        }),
        workspaceDiff: async () => ({ state: "clean", baseRevision: "abc", capturedAt: "now" }),
      },
    });

    expect(await git.branches("/repo")).toEqual({ current: "main", branches: ["main"] });
    expect(await git.createBranch!("/repo", "carrent/feature")).toEqual({
      current: "carrent/feature",
      branches: ["main", "carrent/feature"],
    });
    expect(await git.workspaceDiff("/repo")).toEqual({
      state: "clean",
      baseRevision: "abc",
      capturedAt: "now",
    });
  });

  it("accepts a preload git bridge before createBranch is available", async () => {
    const git = getGitBridge({
      git: {
        branches: async () => ({ current: "main", branches: ["main"] }),
        checkout: async () => ({ current: "feature", branches: ["main", "feature"] }),
        workspaceDiff: async () => ({ state: "clean", baseRevision: "abc", capturedAt: "now" }),
      },
    });

    expect(await git.branches("/repo")).toEqual({ current: "main", branches: ["main"] });
  });

  it("reports a clear error when the preload git bridge is missing workspaceDiff", () => {
    try {
      getGitBridge({
        git: {
          branches: async () => ({ current: "main", branches: ["main"] }),
          checkout: async () => ({ current: "feature", branches: ["main", "feature"] }),
        },
      });
      throw new Error("Expected getGitBridge to reject.");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Git controls are unavailable. Restart Carrent and try again.");
    }
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
    options: [
      { optionId: "approve_once", name: "Approve once", kind: "allow_once" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ],
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
        options: [],
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

describe("plan slash helpers", () => {
  it("asks for a natural-language response after showing a plan", () => {
    expect(PLAN_REVIEW_FOLLOW_UP_TEXT).toContain("Reply naturally");
    expect(PLAN_REVIEW_FOLLOW_UP_TEXT).not.toContain("button");
  });

  it("includes Plan Review content in fresh-session transcripts", () => {
    expect(
      getMessageTranscriptContent({
        id: "assistant-plan",
        role: "assistant",
        timestamp: "12:00",
        threadId: "thread-1",
        content: PLAN_REVIEW_FOLLOW_UP_TEXT,
        parts: [
          {
            type: "reasoning",
            id: "reasoning-1",
            content: "Preparing the plan",
            status: "completed",
          },
          {
            type: "plan_review",
            id: "plan-review-1",
            permissionId: "permission-1",
            content: "# Plan\n\n- Implement the feature",
            status: "rejected",
            options: [],
          },
          { type: "text", content: PLAN_REVIEW_FOLLOW_UP_TEXT },
        ],
      }),
    ).toBe(`# Plan\n\n- Implement the feature\n\n${PLAN_REVIEW_FOLLOW_UP_TEXT}`);
  });

  it("keeps ordinary transcript content unchanged", () => {
    expect(
      getMessageTranscriptContent({
        id: "assistant-text",
        role: "assistant",
        timestamp: "12:00",
        threadId: "thread-1",
        content: "Done",
        parts: [{ type: "text", content: "Done" }],
      }),
    ).toBe("Done");
  });

  it("attaches Plan mode without sending a bare command", () => {
    expect(getPlanSubmissionState("/plan", "kimi", false)).toEqual({
      command: { task: "" },
      task: "",
      planMode: true,
      attachOnly: true,
    });
    expect(getPlanSubmissionState("  /plan  ", "kimi", false).attachOnly).toBe(true);
  });

  it("strips the command and preserves multiline task text", () => {
    expect(getPlanSubmissionState("/plan  inspect first\nthen implement", "kimi", false)).toEqual({
      command: { task: "inspect first\nthen implement" },
      task: "inspect first\nthen implement",
      planMode: true,
      attachOnly: false,
    });
  });

  it("does not parse non-leading or similar commands", () => {
    expect(getPlanSubmissionState("please use /plan", "kimi", false).command).toBe(null);
    expect(getPlanSubmissionState("/planner task", "kimi", false).command).toBe(null);
    expect(getPlanSubmissionState("/plan task", "codex", false).command).toBe(null);
  });

  it("keeps an already attached marker active for normal input", () => {
    expect(getPlanSubmissionState("implement it", "kimi", true)).toMatchObject({
      command: null,
      task: "implement it",
      planMode: true,
      attachOnly: false,
    });
  });

  it("shows the suggestion only for a leading Kimi slash token", () => {
    expect(shouldShowPlanSlashSuggestion("kimi", "/pl", getSkillSlashTrigger("/pl"))).toBe(true);
    expect(shouldShowPlanSlashSuggestion("kimi", "  /plan", getSkillSlashTrigger("  /plan"))).toBe(
      true,
    );
    expect(
      shouldShowPlanSlashSuggestion("kimi", "use /plan", getSkillSlashTrigger("use /plan")),
    ).toBe(false);
    expect(shouldShowPlanSlashSuggestion("codex", "/plan", getSkillSlashTrigger("/plan"))).toBe(
      false,
    );
  });
});

describe("createWorkspaceDiffCapture", () => {
  it("does not capture for General chat", async () => {
    const workspaceDiff = async () => ({
      state: "clean" as const,
      baseRevision: "abc",
      capturedAt: "now",
    });
    const append = () => {
      throw new Error("should not append");
    };
    const capture = createWorkspaceDiffCapture({
      mode: "chat",
      threadId: "t1",
      workspaceDiff,
      appendWorkspaceDiffMessage: append,
      showToast: () => {},
    });
    capture();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("does not append for clean or unavailable results", async () => {
    const append = () => {
      throw new Error("should not append");
    };
    const captureClean = createWorkspaceDiffCapture({
      mode: "thread",
      projectPath: "/repo",
      threadId: "t1",
      workspaceDiff: async () => ({
        state: "clean" as const,
        baseRevision: "abc",
        capturedAt: "now",
      }),
      appendWorkspaceDiffMessage: append,
      showToast: () => {},
    });
    captureClean();

    const captureUnavailable = createWorkspaceDiffCapture({
      mode: "thread",
      projectPath: "/repo",
      threadId: "t1",
      workspaceDiff: async () => ({ state: "unavailable" as const, reason: "no-head" as const }),
      appendWorkspaceDiffMessage: append,
      showToast: () => {},
    });
    captureUnavailable();

    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("appends a ready result with files", async () => {
    let appended: { threadId: string; result: { state: "ready" } } | null = null;
    const capture = createWorkspaceDiffCapture({
      mode: "thread",
      projectPath: "/repo",
      threadId: "t1",
      workspaceDiff: async () => ({
        state: "ready" as const,
        baseRevision: "abc",
        capturedAt: "now",
        files: [{ path: "a.txt", additions: 1, deletions: 0, binary: false, untracked: false }],
        patch: "diff",
        truncated: false,
      }),
      appendWorkspaceDiffMessage: (threadId, result) => {
        appended = { threadId, result: { state: result.state } };
      },
      showToast: () => {},
    });
    capture();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(appended).toEqual({ threadId: "t1", result: { state: "ready" } });
  });

  it("suppresses duplicate terminal capture attempts", async () => {
    let diffCalls = 0;
    const capture = createWorkspaceDiffCapture({
      mode: "thread",
      projectPath: "/repo",
      threadId: "t1",
      workspaceDiff: async () => {
        diffCalls++;
        return {
          state: "ready" as const,
          baseRevision: "abc",
          capturedAt: "now",
          files: [{ path: "a.txt", additions: 1, deletions: 0, binary: false, untracked: false }],
          patch: "diff",
          truncated: false,
        };
      },
      appendWorkspaceDiffMessage: () => {},
      showToast: () => {},
    });
    capture();
    capture();
    capture();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(diffCalls).toBe(1);
  });

  it("shows a toast when workspace diff capture fails", async () => {
    const toasts: Array<{ message: string; type: "error" }> = [];
    const capture = createWorkspaceDiffCapture({
      mode: "thread",
      projectPath: "/repo",
      threadId: "t1",
      workspaceDiff: async () => {
        throw new Error("git failed");
      },
      appendWorkspaceDiffMessage: () => {},
      showToast: (message, type) => {
        toasts.push({ message, type });
      },
    });
    capture();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toasts).toEqual([
      { message: "Run finished, but workspace diff could not be captured.", type: "error" },
    ]);
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
