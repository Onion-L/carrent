import { describe, expect, it } from "bun:test";
import { createAppStateAuthority, type AppStateCommand } from "./appStateAuthority";
import { appStateCommandReducers } from "./appStateCommands";
import {
  APP_STATE_SNAPSHOT_VERSION,
  DEFAULT_APP_STATE_SETTINGS,
  normalizeAppStateSnapshotForWrite,
  type AppProjectRecord,
  type AppStateSnapshot,
  type AppThreadRecord,
  type AssociationThreadDraftRecord,
  type WorkspaceProjectAssociationRecord,
  type WorkspaceRecord,
} from "../../src/shared/workspacePersistence";
import { createAppStateStoreStub } from "./appStateStore.testUtils";

function makeWorkspace(id: string, name: string, order: number): WorkspaceRecord {
  return { id, name, order };
}

function makeProject(id: string, name: string, workingDirectory: string): AppProjectRecord {
  return { id, name, workingDirectory };
}

function makeAssociation(
  workspaceId: string,
  projectId: string,
  order: number,
  overrides: Partial<WorkspaceProjectAssociationRecord> = {},
): WorkspaceProjectAssociationRecord {
  return {
    workspaceId,
    projectId,
    order,
    defaultRuntimeId: "kimi",
    defaultRuntimeMode: "approval-required",
    ...overrides,
  };
}

function makeThread(
  id: string,
  workspaceId: string,
  projectId: string,
  overrides: Partial<AppThreadRecord> = {},
): AppThreadRecord {
  return {
    id,
    workspaceId,
    projectId,
    title: `Thread ${id}`,
    createdAt: "2026-07-01T00:00:00.000Z",
    lastActivityAt: "2026-07-01T00:00:00.000Z",
    runtimeId: "kimi",
    runtimeMode: "approval-required",
    planMode: false,
    ...overrides,
  };
}

function makeDraft(
  id: string,
  threadId: string,
  workspaceId: string,
  projectId: string,
): AssociationThreadDraftRecord {
  return {
    id,
    threadId,
    workspaceId,
    projectId,
    content: "",
    attachedSkillNames: [],
    attachments: [],
    runtimeId: "kimi",
    runtimeMode: "approval-required",
    planMode: false,
  };
}

function makeSnapshot(overrides: Partial<AppStateSnapshot> = {}): AppStateSnapshot {
  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: [makeWorkspace("ws-a", "Alpha", 0), makeWorkspace("ws-b", "Beta", 1)],
    projects: [
      makeProject("proj-1", "one", "/repo/one"),
      makeProject("proj-2", "two", "/repo/two"),
      makeProject("proj-3", "three", "/repo/three"),
    ],
    associations: [
      makeAssociation("ws-a", "proj-1", 0),
      makeAssociation("ws-a", "proj-3", 1),
      makeAssociation("ws-b", "proj-2", 0),
      makeAssociation("ws-b", "proj-3", 1),
    ],
    threads: [
      makeThread("t-1", "ws-a", "proj-1"),
      makeThread("t-2", "ws-a", "proj-3"),
      makeThread("t-3", "ws-a", "proj-1", { archived: true }),
      makeThread("t-4", "ws-b", "proj-2"),
    ],
    threadDrafts: [makeDraft("d-1", "draft-thread-1", "ws-a", "proj-1")],
    threadMessages: [],
    threadRuns: [],
    threadPromotionIntents: [],
    lastThreadIdByWorkspace: { "ws-a": "t-1" },
    activeWorkspaceId: "ws-a",
    ...overrides,
  };
}

function reduce(type: string, snapshot: AppStateSnapshot, payload: unknown) {
  const reducer = appStateCommandReducers[type];
  expect(reducer).toBeDefined();
  if (!reducer) throw new Error(`Missing reducer: ${type}`);
  return reducer(snapshot, payload);
}

describe("workspace:create", () => {
  it("appends a workspace without projects and selects it", () => {
    const next = reduce("workspace:create", makeSnapshot(), {
      workspace: makeWorkspace("ws-c", "Gamma", 2),
    });

    expect(next).not.toBe(null);
    const snapshot = next as AppStateSnapshot;
    expect(snapshot.workspaces.map((workspace) => workspace.id)).toEqual(["ws-a", "ws-b", "ws-c"]);
    expect(snapshot.projects).toHaveLength(3);
    expect(snapshot.associations).toHaveLength(4);
    expect(snapshot.activeWorkspaceId).toBe("ws-c");
  });

  it("appends new projects and associations built by the renderer", () => {
    const next = reduce("workspace:create", makeSnapshot(), {
      workspace: makeWorkspace("ws-c", "Gamma", 2),
      projects: [makeProject("proj-4", "four", "/repo/four")],
      associations: [makeAssociation("ws-c", "proj-4", 0)],
    });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.projects.map((project) => project.id)).toContain("proj-4");
    expect(snapshot.associations.at(-1)).toMatchObject({
      workspaceId: "ws-c",
      projectId: "proj-4",
      order: 0,
    });
    expect(normalizeAppStateSnapshotForWrite(snapshot)).not.toBe(null);
  });

  it("associates an already-known project without duplicating it", () => {
    const next = reduce("workspace:create", makeSnapshot(), {
      workspace: makeWorkspace("ws-c", "Gamma", 2),
      associations: [makeAssociation("ws-c", "proj-2", 0)],
    });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.projects).toHaveLength(3);
    expect(snapshot.associations.at(-1)).toMatchObject({
      workspaceId: "ws-c",
      projectId: "proj-2",
    });
  });

  it("trims the workspace name before storing it", () => {
    const next = reduce("workspace:create", makeSnapshot(), {
      workspace: makeWorkspace("ws-c", "  Gamma  ", 2),
    });

    expect((next as AppStateSnapshot).workspaces.at(-1)?.name).toBe("Gamma");
  });

  it("rejects duplicate names case-insensitively, blank names, and id collisions", () => {
    expect(
      reduce("workspace:create", makeSnapshot(), {
        workspace: makeWorkspace("ws-c", "alpha", 2),
      }),
    ).toBe(null);
    expect(
      reduce("workspace:create", makeSnapshot(), {
        workspace: makeWorkspace("ws-c", "   ", 2),
      }),
    ).toBe(null);
    expect(
      reduce("workspace:create", makeSnapshot(), {
        workspace: makeWorkspace("ws-a", "Gamma", 2),
      }),
    ).toBe(null);
  });

  it("rejects an order that is not the next free slot", () => {
    expect(
      reduce("workspace:create", makeSnapshot(), {
        workspace: makeWorkspace("ws-c", "Gamma", 0),
      }),
    ).toBe(null);
  });

  it("rejects duplicate working directories against the snapshot and within the payload", () => {
    expect(
      reduce("workspace:create", makeSnapshot(), {
        workspace: makeWorkspace("ws-c", "Gamma", 2),
        projects: [makeProject("proj-4", "copy", "/repo/one/../one")],
        associations: [makeAssociation("ws-c", "proj-4", 0)],
      }),
    ).toBe(null);
    expect(
      reduce("workspace:create", makeSnapshot(), {
        workspace: makeWorkspace("ws-c", "Gamma", 2),
        projects: [
          makeProject("proj-4", "four", "/repo/four"),
          makeProject("proj-5", "four-again", "/repo//four"),
        ],
        associations: [makeAssociation("ws-c", "proj-4", 0), makeAssociation("ws-c", "proj-5", 1)],
      }),
    ).toBe(null);
  });

  it("rejects associations with dangling project references or malformed payloads", () => {
    expect(
      reduce("workspace:create", makeSnapshot(), {
        workspace: makeWorkspace("ws-c", "Gamma", 2),
        associations: [makeAssociation("ws-c", "proj-404", 0)],
      }),
    ).toBe(null);
    expect(reduce("workspace:create", makeSnapshot(), null)).toBe(null);
    expect(reduce("workspace:create", makeSnapshot(), { workspace: {} })).toBe(null);
  });
});

describe("workspace:rename", () => {
  it("renames a workspace with the trimmed name", () => {
    const next = reduce("workspace:rename", makeSnapshot(), {
      workspaceId: "ws-a",
      name: "  Renamed  ",
    });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.workspaces.find((workspace) => workspace.id === "ws-a")?.name).toBe("Renamed");
  });

  it("allows keeping the same name", () => {
    const next = reduce("workspace:rename", makeSnapshot(), {
      workspaceId: "ws-a",
      name: "Alpha",
    });

    expect(next).not.toBe(null);
  });

  it("rejects unknown workspaces, duplicates, and blank names", () => {
    expect(
      reduce("workspace:rename", makeSnapshot(), { workspaceId: "ws-404", name: "Renamed" }),
    ).toBe(null);
    expect(reduce("workspace:rename", makeSnapshot(), { workspaceId: "ws-a", name: "BETA" })).toBe(
      null,
    );
    expect(reduce("workspace:rename", makeSnapshot(), { workspaceId: "ws-a", name: " " })).toBe(
      null,
    );
  });
});

describe("workspace:delete", () => {
  it("removes the workspace and cascades through associations, projects, threads, and drafts", () => {
    const next = reduce("workspace:delete", makeSnapshot(), { workspaceId: "ws-a" });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.workspaces).toEqual([makeWorkspace("ws-b", "Beta", 0)]);
    // proj-1 was only referenced by ws-a; proj-3 survives via ws-b.
    expect(snapshot.projects.map((project) => project.id)).toEqual(["proj-2", "proj-3"]);
    expect(snapshot.associations.every((item) => item.workspaceId === "ws-b")).toBe(true);
    expect(snapshot.threads?.map((thread) => thread.id)).toEqual(["t-4"]);
    expect(snapshot.threadDrafts).toEqual([]);
    expect(snapshot.lastThreadIdByWorkspace).toEqual({});
    // The next workspace becomes active.
    expect(snapshot.activeWorkspaceId).toBe("ws-b");
    expect(normalizeAppStateSnapshotForWrite(snapshot)).not.toBe(null);
  });

  it("keeps the active workspace when deleting a non-active one", () => {
    const next = reduce("workspace:delete", makeSnapshot(), { workspaceId: "ws-b" });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.activeWorkspaceId).toBe("ws-a");
    expect(snapshot.projects.map((project) => project.id)).toEqual(["proj-1", "proj-3"]);
    expect(snapshot.threads?.map((thread) => thread.id)).toEqual(["t-1", "t-2", "t-3"]);
    expect(snapshot.lastThreadIdByWorkspace).toEqual({ "ws-a": "t-1" });
    expect(normalizeAppStateSnapshotForWrite(snapshot)).not.toBe(null);
  });

  it("rejects unknown workspaces", () => {
    expect(reduce("workspace:delete", makeSnapshot(), { workspaceId: "ws-404" })).toBe(null);
  });
});

describe("project:add", () => {
  it("appends a new project and association with the next order", () => {
    const next = reduce("project:add", makeSnapshot(), {
      workspaceId: "ws-a",
      project: makeProject("proj-4", "four", "/repo/four"),
      association: makeAssociation("ws-a", "proj-4", 2),
    });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.projects.map((project) => project.id)).toContain("proj-4");
    expect(snapshot.associations.at(-1)).toMatchObject({
      workspaceId: "ws-a",
      projectId: "proj-4",
      order: 2,
    });
    expect(normalizeAppStateSnapshotForWrite(snapshot)).not.toBe(null);
  });

  it("reuses an existing project with the same working directory", () => {
    const next = reduce("project:add", makeSnapshot(), {
      workspaceId: "ws-a",
      existingProjectId: "proj-2",
      project: makeProject("proj-2", "two", "/repo/two"),
      association: makeAssociation("ws-a", "proj-2", 2),
    });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.projects).toHaveLength(3);
    expect(snapshot.associations.at(-1)).toMatchObject({
      workspaceId: "ws-a",
      projectId: "proj-2",
    });
  });

  it("rejects an already-associated project as a no-op", () => {
    expect(
      reduce("project:add", makeSnapshot(), {
        workspaceId: "ws-a",
        existingProjectId: "proj-1",
        project: makeProject("proj-1", "one", "/repo/one"),
        association: makeAssociation("ws-a", "proj-1", 2),
      }),
    ).toBe(null);
  });

  it("rejects unknown workspaces, unknown existing projects, and duplicate directories", () => {
    expect(
      reduce("project:add", makeSnapshot(), {
        workspaceId: "ws-404",
        project: makeProject("proj-4", "four", "/repo/four"),
        association: makeAssociation("ws-404", "proj-4", 0),
      }),
    ).toBe(null);
    expect(
      reduce("project:add", makeSnapshot(), {
        workspaceId: "ws-a",
        existingProjectId: "proj-404",
        project: makeProject("proj-404", "ghost", "/repo/ghost"),
        association: makeAssociation("ws-a", "proj-404", 2),
      }),
    ).toBe(null);
    expect(
      reduce("project:add", makeSnapshot(), {
        workspaceId: "ws-a",
        project: makeProject("proj-4", "copy", "/repo/./one"),
        association: makeAssociation("ws-a", "proj-4", 2),
      }),
    ).toBe(null);
  });

  it("rejects associations that do not match the workspace, project, or next order", () => {
    expect(
      reduce("project:add", makeSnapshot(), {
        workspaceId: "ws-a",
        project: makeProject("proj-4", "four", "/repo/four"),
        association: makeAssociation("ws-b", "proj-4", 2),
      }),
    ).toBe(null);
    expect(
      reduce("project:add", makeSnapshot(), {
        workspaceId: "ws-a",
        project: makeProject("proj-4", "four", "/repo/four"),
        association: makeAssociation("ws-a", "proj-4", 0),
      }),
    ).toBe(null);
    expect(
      reduce("project:add", makeSnapshot(), {
        workspaceId: "ws-a",
        project: makeProject("proj-4", "four", "/repo/four"),
        association: makeAssociation("ws-a", "proj-4", 2, {
          defaultRuntimeId: "not-a-runtime" as never,
        }),
      }),
    ).toBe(null);
  });
});

describe("project:rename", () => {
  it("renames a project with the trimmed name", () => {
    const next = reduce("project:rename", makeSnapshot(), {
      projectId: "proj-1",
      name: "  renamed  ",
    });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.projects.find((project) => project.id === "proj-1")?.name).toBe("renamed");
  });

  it("rejects unknown projects and blank names", () => {
    expect(
      reduce("project:rename", makeSnapshot(), { projectId: "proj-404", name: "renamed" }),
    ).toBe(null);
    expect(reduce("project:rename", makeSnapshot(), { projectId: "proj-1", name: " " })).toBe(null);
  });
});

describe("project:set-alias", () => {
  it("sets and clears the association alias", () => {
    const withAlias = reduce("project:set-alias", makeSnapshot(), {
      workspaceId: "ws-a",
      projectId: "proj-1",
      alias: "  frontend  ",
    }) as AppStateSnapshot;
    const association = withAlias.associations.find(
      (item) => item.workspaceId === "ws-a" && item.projectId === "proj-1",
    );
    expect(association?.alias).toBe("frontend");

    const cleared = reduce("project:set-alias", withAlias, {
      workspaceId: "ws-a",
      projectId: "proj-1",
      alias: "   ",
    }) as AppStateSnapshot;
    expect(
      cleared.associations.find(
        (item) => item.workspaceId === "ws-a" && item.projectId === "proj-1",
      )?.alias,
    ).toBe(undefined);
  });

  it("rejects unknown associations", () => {
    expect(
      reduce("project:set-alias", makeSnapshot(), {
        workspaceId: "ws-a",
        projectId: "proj-2",
        alias: "frontend",
      }),
    ).toBe(null);
  });
});

describe("association:remove", () => {
  it("removes the association and cascades threads, drafts, and orphaned projects", () => {
    const next = reduce("association:remove", makeSnapshot(), {
      workspaceId: "ws-a",
      projectId: "proj-1",
    });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.associations.map((item) => `${item.workspaceId}:${item.projectId}`)).toEqual([
      "ws-a:proj-3",
      "ws-b:proj-2",
      "ws-b:proj-3",
    ]);
    // The remaining ws-a association is reindexed to keep orders contiguous.
    expect(
      snapshot.associations.find(
        (item) => item.workspaceId === "ws-a" && item.projectId === "proj-3",
      )?.order,
    ).toBe(0);
    // proj-1 is orphaned and removed; its threads and drafts are gone, and the
    // remembered location pointing at t-1 is cleared.
    expect(snapshot.projects.map((project) => project.id)).toEqual(["proj-2", "proj-3"]);
    expect(snapshot.threads?.map((thread) => thread.id)).toEqual(["t-2", "t-4"]);
    expect(snapshot.threadDrafts).toEqual([]);
    expect(snapshot.lastThreadIdByWorkspace).toEqual({});
    expect(snapshot.activeWorkspaceId).toBe("ws-a");
    expect(normalizeAppStateSnapshotForWrite(snapshot)).not.toBe(null);
  });

  it("keeps a project that is still associated with another workspace", () => {
    const next = reduce("association:remove", makeSnapshot(), {
      workspaceId: "ws-a",
      projectId: "proj-3",
    });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.projects.map((project) => project.id)).toContain("proj-3");
    expect(snapshot.threads?.map((thread) => thread.id)).toEqual(["t-1", "t-3", "t-4"]);
    expect(normalizeAppStateSnapshotForWrite(snapshot)).not.toBe(null);
  });

  it("rejects unknown associations", () => {
    expect(
      reduce("association:remove", makeSnapshot(), { workspaceId: "ws-a", projectId: "proj-2" }),
    ).toBe(null);
    expect(
      reduce("association:remove", makeSnapshot(), { workspaceId: "ws-404", projectId: "proj-1" }),
    ).toBe(null);
  });
});

describe("association:set-defaults", () => {
  it("updates the runtime defaults of an association", () => {
    const next = reduce("association:set-defaults", makeSnapshot(), {
      workspaceId: "ws-a",
      projectId: "proj-1",
      defaults: { runtimeId: "codex", runtimeModelId: "gpt-5", runtimeMode: "full-access" },
    });

    const snapshot = next as AppStateSnapshot;
    expect(
      snapshot.associations.find(
        (item) => item.workspaceId === "ws-a" && item.projectId === "proj-1",
      ),
    ).toMatchObject({
      defaultRuntimeId: "codex",
      defaultRuntimeModelId: "gpt-5",
      defaultRuntimeMode: "full-access",
    });
  });

  it("clears the default model when none is provided", () => {
    const snapshot = makeSnapshot({
      associations: [
        makeAssociation("ws-a", "proj-1", 0, { defaultRuntimeModelId: "k2" }),
        makeAssociation("ws-a", "proj-3", 1),
        makeAssociation("ws-b", "proj-2", 0),
        makeAssociation("ws-b", "proj-3", 1),
      ],
    });

    const next = reduce("association:set-defaults", snapshot, {
      workspaceId: "ws-a",
      projectId: "proj-1",
      defaults: { runtimeId: "kimi", runtimeMode: "approval-required" },
    }) as AppStateSnapshot;

    expect(
      next.associations.find((item) => item.workspaceId === "ws-a" && item.projectId === "proj-1")
        ?.defaultRuntimeModelId,
    ).toBe(undefined);
  });

  it("rejects unknown associations and invalid runtime values", () => {
    expect(
      reduce("association:set-defaults", makeSnapshot(), {
        workspaceId: "ws-a",
        projectId: "proj-2",
        defaults: { runtimeId: "kimi", runtimeMode: "approval-required" },
      }),
    ).toBe(null);
    expect(
      reduce("association:set-defaults", makeSnapshot(), {
        workspaceId: "ws-a",
        projectId: "proj-1",
        defaults: { runtimeId: "not-a-runtime", runtimeMode: "approval-required" },
      }),
    ).toBe(null);
    expect(
      reduce("association:set-defaults", makeSnapshot(), {
        workspaceId: "ws-a",
        projectId: "proj-1",
        defaults: { runtimeId: "kimi", runtimeMode: "not-a-mode" },
      }),
    ).toBe(null);
  });
});

describe("thread:archive / thread:restore", () => {
  it("archives a thread", () => {
    const next = reduce("thread:archive", makeSnapshot(), { threadId: "t-2" });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.threads?.find((thread) => thread.id === "t-2")?.archived).toBe(true);
  });

  it("clears the remembered location when archiving the remembered thread", () => {
    const next = reduce("thread:archive", makeSnapshot(), { threadId: "t-1" });

    expect((next as AppStateSnapshot).lastThreadIdByWorkspace).toEqual({});
  });

  it("rejects unknown or already-archived threads", () => {
    expect(reduce("thread:archive", makeSnapshot(), { threadId: "t-404" })).toBe(null);
    expect(reduce("thread:archive", makeSnapshot(), { threadId: "t-3" })).toBe(null);
  });

  it("restores an archived thread", () => {
    const next = reduce("thread:restore", makeSnapshot(), { threadId: "t-3" });

    const restored = (next as AppStateSnapshot).threads?.find((thread) => thread.id === "t-3");
    expect(restored).toBeDefined();
    expect(restored?.archived).toBe(undefined);
  });

  it("rejects unknown or non-archived threads on restore", () => {
    expect(reduce("thread:restore", makeSnapshot(), { threadId: "t-404" })).toBe(null);
    expect(reduce("thread:restore", makeSnapshot(), { threadId: "t-1" })).toBe(null);
  });
});

describe("thread:update-config", () => {
  it("updates only the provided fields", () => {
    const next = reduce("thread:update-config", makeSnapshot(), {
      threadId: "t-1",
      config: { runtimeId: "codex", planMode: true },
    });

    const thread = (next as AppStateSnapshot).threads?.find((item) => item.id === "t-1");
    expect(thread).toMatchObject({
      runtimeId: "codex",
      runtimeMode: "approval-required",
      planMode: true,
    });
  });

  it("clears the model override with a blank runtimeModelId", () => {
    const snapshot = makeSnapshot({
      threads: [
        makeThread("t-1", "ws-a", "proj-1", { runtimeModelId: "k2" }),
        makeThread("t-2", "ws-a", "proj-3"),
        makeThread("t-3", "ws-a", "proj-1", { archived: true }),
        makeThread("t-4", "ws-b", "proj-2"),
      ],
    });

    const next = reduce("thread:update-config", snapshot, {
      threadId: "t-1",
      config: { runtimeModelId: "  " },
    }) as AppStateSnapshot;

    expect(next.threads?.find((item) => item.id === "t-1")?.runtimeModelId).toBe(undefined);
  });

  it("rejects unknown threads and invalid config values", () => {
    expect(reduce("thread:update-config", makeSnapshot(), { threadId: "t-404", config: {} })).toBe(
      null,
    );
    expect(
      reduce("thread:update-config", makeSnapshot(), {
        threadId: "t-1",
        config: { runtimeId: "not-a-runtime" },
      }),
    ).toBe(null);
    expect(
      reduce("thread:update-config", makeSnapshot(), {
        threadId: "t-1",
        config: { runtimeMode: "not-a-mode" },
      }),
    ).toBe(null);
    expect(
      reduce("thread:update-config", makeSnapshot(), {
        threadId: "t-1",
        config: { planMode: "yes" },
      }),
    ).toBe(null);
  });
});

describe("state:select-workspace", () => {
  it("switches the active workspace", () => {
    const next = reduce("state:select-workspace", makeSnapshot(), { workspaceId: "ws-b" });

    expect((next as AppStateSnapshot).activeWorkspaceId).toBe("ws-b");
  });

  it("rejects selecting the active or an unknown workspace", () => {
    expect(reduce("state:select-workspace", makeSnapshot(), { workspaceId: "ws-a" })).toBe(null);
    expect(reduce("state:select-workspace", makeSnapshot(), { workspaceId: "ws-404" })).toBe(null);
  });
});

describe("state:remember-thread-location", () => {
  it("remembers the thread and activates its workspace", () => {
    const next = reduce("state:remember-thread-location", makeSnapshot(), {
      workspaceId: "ws-b",
      threadId: "t-4",
    });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.activeWorkspaceId).toBe("ws-b");
    expect(snapshot.lastThreadIdByWorkspace).toEqual({ "ws-a": "t-1", "ws-b": "t-4" });
  });

  it("rejects unknown, archived, or cross-workspace threads and redundant locations", () => {
    expect(
      reduce("state:remember-thread-location", makeSnapshot(), {
        workspaceId: "ws-a",
        threadId: "t-404",
      }),
    ).toBe(null);
    expect(
      reduce("state:remember-thread-location", makeSnapshot(), {
        workspaceId: "ws-a",
        threadId: "t-3",
      }),
    ).toBe(null);
    expect(
      reduce("state:remember-thread-location", makeSnapshot(), {
        workspaceId: "ws-b",
        threadId: "t-1",
      }),
    ).toBe(null);
    expect(
      reduce("state:remember-thread-location", makeSnapshot(), {
        workspaceId: "ws-a",
        threadId: "t-1",
      }),
    ).toBe(null);
  });
});

describe("settings:update", () => {
  it("stores validated settings on a snapshot that has none", () => {
    const next = reduce("settings:update", makeSnapshot(), {
      settings: {
        autoDetectRuntimes: false,
        theme: "light",
        fontSize: 18,
        enhancedTerminalCompletion: false,
        terminalPanelHeight: 400,
        runtimeEnabledById: { kimi: false },
        runtimeDefaultModelById: { codex: "gpt-5" },
      },
    });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.settings).toEqual({
      autoDetectRuntimes: false,
      theme: "light",
      fontSize: 18,
      enhancedTerminalCompletion: false,
      terminalPanelHeight: 400,
      runtimeEnabledById: { kimi: false },
      runtimeDefaultModelById: { codex: "gpt-5" },
    });
    expect(normalizeAppStateSnapshotForWrite(snapshot)).not.toBe(null);
  });

  it("shallow-merges over existing settings", () => {
    const snapshot = makeSnapshot({
      settings: { ...DEFAULT_APP_STATE_SETTINGS, theme: "light", fontSize: 20 },
    });

    const next = reduce("settings:update", snapshot, {
      settings: { ...DEFAULT_APP_STATE_SETTINGS, terminalPanelHeight: 500 },
    }) as AppStateSnapshot;

    expect(next.settings?.terminalPanelHeight).toBe(500);
    expect(next.settings?.theme).toBe("dark");
  });

  it("falls back to defaults for missing or invalid fields instead of rejecting", () => {
    const next = reduce("settings:update", makeSnapshot(), {
      settings: { theme: "neon", fontSize: 3, terminalPanelHeight: 10_000, extra: true },
    });

    const snapshot = next as AppStateSnapshot;
    expect(snapshot.settings).toEqual({
      ...DEFAULT_APP_STATE_SETTINGS,
      terminalPanelHeight: 720,
    });
  });

  it("rejects non-object settings payloads", () => {
    expect(reduce("settings:update", makeSnapshot(), { settings: "dark" })).toBe(null);
    expect(reduce("settings:update", makeSnapshot(), {})).toBe(null);
    expect(reduce("settings:update", makeSnapshot(), null)).toBe(null);
  });
});

describe("settings snapshot persistence", () => {
  it("round-trips settings through the snapshot normalizer", () => {
    const snapshot = makeSnapshot({ settings: { ...DEFAULT_APP_STATE_SETTINGS, theme: "light" } });

    const normalized = normalizeAppStateSnapshotForWrite(snapshot);

    expect(normalized?.settings).toEqual({ ...DEFAULT_APP_STATE_SETTINGS, theme: "light" });
  });

  it("keeps snapshots persisted before settings existed unchanged", () => {
    const normalized = normalizeAppStateSnapshotForWrite(makeSnapshot());

    expect(normalized).not.toBe(null);
    expect(normalized?.settings).toBe(undefined);
  });

  it("omits malformed settings instead of rejecting the snapshot", () => {
    const normalized = normalizeAppStateSnapshotForWrite({
      ...makeSnapshot(),
      settings: "not-an-object",
    });

    expect(normalized).not.toBe(null);
    expect(normalized?.settings).toBe(undefined);
  });
});

describe("appStateCommandReducers through createAppStateAuthority", () => {
  function createHarness(initialSnapshot: AppStateSnapshot = makeSnapshot()) {
    const saved: AppStateSnapshot[] = [];
    const authority = createAppStateAuthority({
      store: createAppStateStoreStub({
        saveAppStateSnapshot: async (snapshot) => {
          saved.push(snapshot);
        },
      }),
      initialResult: { status: "ready", snapshot: initialSnapshot },
      reducers: appStateCommandReducers,
      publish: () => {},
    });
    return { authority, saved };
  }

  function command(partial: Partial<AppStateCommand>): AppStateCommand {
    return { commandId: "cmd-1", type: "workspace:rename", ...partial };
  }

  it("accepts exactly one of two concurrent workspace:create commands with the same name", async () => {
    const { authority, saved } = createHarness();
    const payload = (id: string) => ({
      workspace: makeWorkspace(id, "Gamma", 2),
    });

    const [first, second] = await Promise.all([
      authority.submit(
        1,
        command({ commandId: "cmd-a", type: "workspace:create", payload: payload("ws-c") }),
      ),
      authority.submit(
        2,
        command({ commandId: "cmd-b", type: "workspace:create", payload: payload("ws-d") }),
      ),
    ]);

    expect(first).toEqual({ status: "accepted", revision: 1 });
    expect(second).toEqual({ status: "rejected", reason: "invalid", revision: 1 });
    expect(authority.getState().snapshot.workspaces.map((workspace) => workspace.id)).toEqual([
      "ws-a",
      "ws-b",
      "ws-c",
    ]);
    expect(saved).toHaveLength(1);
  });

  it("rejects a thread:update-config for a thread removed by a preceding association:remove", async () => {
    const { authority } = createHarness();

    const removed = await authority.submit(
      1,
      command({
        commandId: "cmd-remove",
        type: "association:remove",
        payload: { workspaceId: "ws-a", projectId: "proj-1" },
      }),
    );
    const updated = await authority.submit(
      2,
      command({
        commandId: "cmd-update",
        type: "thread:update-config",
        payload: { threadId: "t-1", config: { planMode: true } },
      }),
    );

    expect(removed).toEqual({ status: "accepted", revision: 1 });
    expect(updated).toEqual({ status: "rejected", reason: "invalid", revision: 1 });
  });

  it("rejects a workspace:rename with a stale base revision", async () => {
    const { authority } = createHarness();
    await authority.submit(
      1,
      command({
        commandId: "cmd-create",
        type: "workspace:create",
        payload: { workspace: makeWorkspace("ws-c", "Gamma", 2) },
      }),
    );

    const stale = await authority.submit(
      2,
      command({
        commandId: "cmd-rename",
        type: "workspace:rename",
        payload: { workspaceId: "ws-a", name: "Renamed" },
        baseRevision: 0,
      }),
    );

    expect(stale).toEqual({ status: "rejected", reason: "stale", revision: 1 });
    expect(
      authority.getState().snapshot.workspaces.find((workspace) => workspace.id === "ws-a")?.name,
    ).toBe("Alpha");
  });

  it("round-trips settings:update through the authority and persists it", async () => {
    const { authority, saved } = createHarness();

    const result = await authority.submit(
      1,
      command({
        commandId: "cmd-settings",
        type: "settings:update",
        payload: { settings: { ...DEFAULT_APP_STATE_SETTINGS, theme: "light", fontSize: 16 } },
      }),
    );

    expect(result).toEqual({ status: "accepted", revision: 1 });
    const expected = { ...DEFAULT_APP_STATE_SETTINGS, theme: "light", fontSize: 16 };
    expect(authority.getState().snapshot.settings).toEqual(expected);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.settings).toEqual(expected);
  });

  it("persists a workspace:delete cascade in a form the normalizer accepts", async () => {
    const { authority, saved } = createHarness();

    const result = await authority.submit(
      1,
      command({
        commandId: "cmd-delete",
        type: "workspace:delete",
        payload: { workspaceId: "ws-a" },
      }),
    );

    expect(result).toEqual({ status: "accepted", revision: 1 });
    expect(saved[0]?.workspaces).toEqual([makeWorkspace("ws-b", "Beta", 0)]);
    expect(saved[0]?.activeWorkspaceId).toBe("ws-b");
  });
});
